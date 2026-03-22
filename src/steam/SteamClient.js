const SteamUser = require('steam-user');
const GlobalOffensive = require('node-cs2');
const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
const QRCode = require('qrcode');
const Cs2Language = require('node-cs2/language');
const Cs2Protos = require('node-cs2/protobufs/generated/_load');
const {
  buildKeychainDescriptionByName,
  buildStickerDescriptionByName,
  fetchAssetDescriptionsByAssetId,
} = require('./assetDescriptions');
const { fetchMarketDescriptionByHashName } = require('./marketSearch');
const { createMarketCache } = require('./marketCache');

const ASSET_DESCRIPTION_CACHE_TTL_MS = 2 * 60 * 1000;
const WEB_SESSION_TIMEOUT_MS = 15000;
const MARKET_LOOKUP_LIMIT = Number(process.env.CS2_MARKET_LOOKUP_LIMIT ?? 30) || 30;
const MARKET_LOOKUP_CONCURRENCY = Number(process.env.CS2_MARKET_LOOKUP_CONCURRENCY ?? 1) || 1;
const MARKET_REQUEST_MIN_INTERVAL_MS = Number(process.env.CS2_MARKET_REQUEST_MIN_INTERVAL_MS ?? 1250) || 1250;
const MARKET_BACKOFF_BASE_MS = Number(process.env.CS2_MARKET_BACKOFF_BASE_MS ?? 30000) || 30000;
const MARKET_BACKOFF_MAX_MS = Number(process.env.CS2_MARKET_BACKOFF_MAX_MS ?? 10 * 60 * 1000) || 10 * 60 * 1000;
const ARMORY_MAX_BALANCE = Number(process.env.CS2_ARMORY_MAX_BALANCE ?? 5000) || 5000;
const ARMORY_MIN_GENERATION_EPOCH = Date.UTC(2023, 0, 1) / 1000;
const ARMORY_MAX_FUTURE_SECONDS = 365 * 24 * 60 * 60;
const ARMORY_SO_MESSAGE_TYPES = [
  Cs2Language.ClientWelcome,
  Cs2Language.SO_Create,
  Cs2Language.SO_Update,
  Cs2Language.SO_Destroy,
  Cs2Language.SO_UpdateMultiple,
];

class SteamClient {
  constructor() {
    this.steamUser = new SteamUser({ enablePicsCache: false, dataDirectory: null });
    this.csgo = new GlobalOffensive(this.steamUser);
    this.isLoggedIn = false;
    this.isConnectedToGC = false;
    this.steamId = null;
    this.username = null;

    this._qrSession = null;
    this._qrStatus = 'idle';
    this._qrError = null;
    this._credSession = null;
    this._gcResolve = null;
    this._gcReject = null;
    this._gcTimeout = null;
    this._webSessionId = null;
    this._webCookies = [];
    this._webSessionPromise = null;
    this._assetDescriptionsByAssetId = new Map();
    this._assetDescriptionsFetchedAt = 0;
    this._assetDescriptionsPromise = null;
    this._marketDescriptionsByHash = new Map();
    this._marketDescriptionPromisesByHash = new Map();
    this._marketCache = createMarketCache();
    this._marketNextAllowedAt = 0;
    this._marketBackoffMs = 0;
    this.armory = this._createEmptyArmoryState();
    this._armoryTapInstalled = false;

    this._setupEventHandlers();
    this._installArmorySOTap();
  }

  _createEmptyArmoryState() {
    return {
      personalStore: null,
      xpShop: null,
      volatileOffers: [],
    };
  }

  _installArmorySOTap() {
    if (this._armoryTapInstalled || !this.csgo?._handlers) {
      return;
    }

    for (const messageType of ARMORY_SO_MESSAGE_TYPES) {
      const handler = this.csgo._handlers[messageType];
      if (typeof handler !== 'function') {
        continue;
      }

      this.csgo._handlers[messageType] = (payload) => {
        try {
          this._captureArmorySO(messageType, payload);
        } catch (error) {
          console.warn('[armory] failed to decode GC SO payload:', error.message);
        }
        return handler.call(this.csgo, payload);
      };
    }

    this._armoryTapInstalled = true;
  }

  _captureArmorySO(messageType, payload) {
    if (!payload) {
      return;
    }

    if (messageType === Cs2Language.ClientWelcome) {
      const msg = this._decodeProto(Cs2Protos.CMsgClientWelcome, payload);
      const caches = msg?.outofdate_subscribed_caches ?? [];
      for (const cacheSet of caches) {
        for (const object of cacheSet.objects ?? []) {
          this._captureArmoryFromSingleSO(object);
        }
      }
      return;
    }

    if (messageType === Cs2Language.SO_UpdateMultiple) {
      const msg = this._decodeProto(Cs2Protos.CMsgSOMultipleObjects, payload);
      for (const object of msg?.objects_added ?? []) {
        this._captureArmoryFromSingleSO(object);
      }
      for (const object of msg?.objects_modified ?? []) {
        this._captureArmoryFromSingleSO(object);
      }
      for (const object of msg?.objects_removed ?? []) {
        this._clearArmoryFromSOType(object?.type_id);
      }
      return;
    }

    const msg = this._decodeProto(Cs2Protos.CMsgSOSingleObject, payload);
    if (messageType === Cs2Language.SO_Destroy) {
      this._clearArmoryFromSOType(msg?.type_id);
      return;
    }

    this._captureArmoryFromSingleSO(msg);
  }

  _captureArmoryFromSingleSO(soObject) {
    if (!soObject?.object_data) {
      return;
    }

    const objectDataList = Array.isArray(soObject.object_data)
      ? soObject.object_data
      : [soObject.object_data];

    for (const objectData of objectDataList) {
      const personalStore = this._tryDecodeProto(Cs2Protos.CSOAccountItemPersonalStore, objectData);
      if (personalStore && (
        personalStore.generation_time !== undefined
        || personalStore.redeemable_balance !== undefined
        || personalStore.items?.length
      )) {
        const normalized = this._normalizePersonalStore(personalStore);
        if (!this._isLikelyValidPersonalStore(normalized)) {
          continue;
        }
        if (this._shouldIgnoreOlderPersonalStore(normalized)) {
          continue;
        }

        this.armory.personalStore = normalized;
        console.log(
          '[armory] personal store updated:',
          `generation=${this.armory.personalStore.generation_time},`,
          `balance=${this.armory.personalStore.redeemable_balance},`,
          `items=${this.armory.personalStore.items.length}`
        );
        continue;
      }

      const volatileOffer = this._tryDecodeProto(Cs2Protos.CSOVolatileItemOffer, objectData);
      if (volatileOffer && (volatileOffer.defidx || volatileOffer.faux_itemid?.length || volatileOffer.generation_time?.length)) {
        this._upsertVolatileOffer(this._normalizeVolatileOffer(volatileOffer));
        console.log('[armory] volatile offer updated:', `defidx=${volatileOffer.defidx}`);
        continue;
      }

    }
  }

  _clearArmoryFromSOType(typeId) {
    if (!Number.isFinite(Number(typeId))) {
      return;
    }

    // node-cs2 handles type_id 6 as XP shop; we only clear optional armory-derived SOs.
    // We don't know exact type IDs for personal store/volatile offers in all builds, so
    // this method intentionally avoids aggressive clears.
  }

  _upsertVolatileOffer(offer) {
    if (!offer) {
      return;
    }

    const existingIndex = this.armory.volatileOffers.findIndex((entry) => {
      if (entry.defidx !== offer.defidx) {
        return false;
      }
      return JSON.stringify(entry.faux_itemid) === JSON.stringify(offer.faux_itemid);
    });

    if (existingIndex === -1) {
      this.armory.volatileOffers = [...this.armory.volatileOffers, offer];
      return;
    }

    const next = [...this.armory.volatileOffers];
    next[existingIndex] = offer;
    this.armory.volatileOffers = next;
  }

  _normalizePersonalStore(value) {
    return {
      generation_time: Number(value.generation_time ?? 0) || 0,
      redeemable_balance: Number(value.redeemable_balance ?? 0) || 0,
      items: (value.items ?? [])
        .map((id) => String(id))
        .filter((id) => /^\d+$/.test(id)),
    };
  }

  _normalizeVolatileOffer(value) {
    return {
      defidx: Number(value.defidx ?? 0) || 0,
      faux_itemid: (value.faux_itemid ?? []).map((id) => String(id)),
      generation_time: (value.generation_time ?? []).map((time) => Number(time) || 0),
    };
  }

  _decodeProto(messageType, payload, options = {}) {
    const { defaults = true } = options;
    const source = payload && typeof payload.toBuffer === 'function'
      ? payload.toBuffer()
      : payload;
    const decoded = messageType.decode(source);
    return messageType.toObject(decoded, {
      longs: String,
      defaults,
      arrays: true,
      objects: true,
    });
  }

  _tryDecodeProto(messageType, payload) {
    try {
      return this._decodeProto(messageType, payload, { defaults: false });
    } catch (_) {
      return null;
    }
  }

  _isLikelyValidPersonalStore(store) {
    if (!store) {
      return false;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(store.generation_time)) {
      return false;
    }
    if (store.generation_time < ARMORY_MIN_GENERATION_EPOCH) {
      return false;
    }
    if (store.generation_time > nowSeconds + ARMORY_MAX_FUTURE_SECONDS) {
      return false;
    }
    if (!Number.isFinite(store.redeemable_balance) || store.redeemable_balance < 0 || store.redeemable_balance > ARMORY_MAX_BALANCE) {
      return false;
    }
    if (!Array.isArray(store.items) || store.items.length === 0 || store.items.length > 32) {
      return false;
    }
    if (!store.items.every((id) => /^\d{6,}$/.test(id))) {
      return false;
    }

    return true;
  }

  _shouldIgnoreOlderPersonalStore(nextStore) {
    const current = this.armory.personalStore;
    if (!current) {
      return false;
    }

    return Number(nextStore.generation_time) < Number(current.generation_time);
  }

  _setupEventHandlers() {
    this.steamUser.on('loggedOn', () => {
      this.isLoggedIn = true;
      this.steamId = this.steamUser.steamID.getSteamID64();
      this.steamUser.setPersona(SteamUser.EPersonaState.Online);
      this.steamUser.gamesPlayed([730]);
      this._clearWebSession();
      this._assetDescriptionsByAssetId = new Map();
      this._invalidateAssetDescriptions();
      this._marketDescriptionsByHash = new Map();
      this._marketDescriptionPromisesByHash = new Map();
      this._marketNextAllowedAt = 0;
      this._marketBackoffMs = 0;
      this.armory = this._createEmptyArmoryState();
      this._refreshWebSession().catch((error) => {
        console.warn('[steam] failed to initialize web session:', error.message);
      });
    });

    this.steamUser.on('error', (err) => {
      console.error('Steam user error:', err.message);
      this.isLoggedIn = false;
      this.isConnectedToGC = false;
      this._clearWebSession();
      this._invalidateAssetDescriptions();
      this.armory = this._createEmptyArmoryState();
      if (this._gcReject) {
        this._gcReject(err);
        this._gcResolve = null;
        this._gcReject = null;
      }
    });

    this.steamUser.on('webSession', (sessionId, cookies) => {
      this._webSessionId = sessionId;
      this._webCookies = cookies ?? [];
    });

    this.csgo.on('connectedToGC', () => {
      this.isConnectedToGC = true;
      this.armory.volatileOffers = [];
      clearTimeout(this._gcTimeout);
      if (this._gcResolve) {
        this._gcResolve({ success: true, steamId: this.steamId, username: this.username });
        this._gcResolve = null;
        this._gcReject = null;
      }
    });

    this.csgo.on('disconnectedFromGC', (reason) => {
      this.isConnectedToGC = false;
      this.armory = this._createEmptyArmoryState();
      console.warn('Disconnected from GC, reason:', reason);
    });

    this.csgo.on('xpShopNotification', (data) => {
      this.armory.xpShop = data ?? null;
    });
    this.csgo.on('xpShopUpdate', (data) => {
      this.armory.xpShop = data ?? null;
    });

    this.csgo.on('itemAcquired', () => this._invalidateAssetDescriptions());
    this.csgo.on('itemChanged', () => this._invalidateAssetDescriptions());
    this.csgo.on('itemRemoved', () => this._invalidateAssetDescriptions());
  }

  _waitForGC(timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      if (this.isConnectedToGC) {
        resolve({ success: true, steamId: this.steamId, username: this.username });
        return;
      }

      this._gcResolve = resolve;
      this._gcReject = reject;
      this._gcTimeout = setTimeout(() => {
        this._gcResolve = null;
        this._gcReject = null;
        reject(new Error('Timed out waiting for CS2 Game Coordinator connection'));
      }, timeoutMs);
    });
  }

  _completeLoginWithRefreshToken(refreshToken, username) {
    this.username = username || null;
    this.steamUser.logOn({ refreshToken });
    return this._waitForGC();
  }

  async startQRLogin() {
    if (this._qrSession) {
      this._qrSession.cancelLoginAttempt();
      this._qrSession = null;
    }

    this._qrStatus = 'waiting';
    this._qrError = null;

    const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
    this._qrSession = session;

    session.on('remoteInteraction', () => {
      this._qrStatus = 'scanned';
    });

    session.on('authenticated', async () => {
      this._qrStatus = 'authenticated';
      this.username = session.accountName;
      try {
        await this._completeLoginWithRefreshToken(session.refreshToken, session.accountName);
      } catch (err) {
        this._qrStatus = 'error';
        this._qrError = err.message;
      }
    });

    session.on('timeout', () => {
      if (this._qrStatus === 'waiting' || this._qrStatus === 'scanned') {
        this._qrStatus = 'error';
        this._qrError = 'QR code expired';
      }
    });

    session.on('error', (err) => {
      this._qrStatus = 'error';
      this._qrError = err.message;
    });

    const result = await session.startWithQR();
    const qrDataUrl = await QRCode.toDataURL(result.qrChallengeUrl, {
      width: 256,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    return { qrDataUrl };
  }

  getQRStatus() {
    return {
      status: this._qrStatus,
      error: this._qrError,
      loggedIn: this.isLoggedIn,
      connectedToGC: this.isConnectedToGC,
      steamId: this.steamId,
      username: this.username,
    };
  }

  async startCredentialLogin(username, password) {
    if (this._credSession) {
      this._credSession.cancelLoginAttempt();
      this._credSession = null;
    }

    const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
    this._credSession = session;

    const result = await session.startWithCredentials({ accountName: username, password });

    if (result.actionRequired) {
      const validAction = result.validActions?.[0];
      return {
        requiresGuard: true,
        guardType: validAction?.type ?? 'unknown',
        detail: validAction?.detail ?? null,
      };
    }

    this.username = username;
    await this._completeLoginWithRefreshToken(session.refreshToken, username);
    return { success: true, steamId: this.steamId, username: this.username };
  }

  async submitGuardCode(code) {
    if (!this._credSession) {
      throw new Error('No active login session');
    }

    const session = this._credSession;
    await new Promise((resolve, reject) => {
      session.once('authenticated', resolve);
      session.once('error', reject);
      session.submitSteamGuardCode(code).catch(reject);
    });

    const refreshToken = session.refreshToken;
    const username = session.accountName;
    this._credSession = null;
    return this._completeLoginWithRefreshToken(refreshToken, username);
  }

  startTokenLogin(token, steamId, accountName) {
    this.steamId = steamId;
    this._clearWebSession();
    this._invalidateAssetDescriptions();
    this.steamUser.logOn({ accountName, steamID: steamId, webLogonToken: token });
    return this._waitForGC();
  }

  async getAssetDescriptions(options = {}) {
    if (!this.isLoggedIn || !this.steamId) {
      return new Map();
    }

    const { force = false } = options;
    const cacheAge = Date.now() - this._assetDescriptionsFetchedAt;
    if (!force && this._assetDescriptionsByAssetId.size > 0 && cacheAge < ASSET_DESCRIPTION_CACHE_TTL_MS) {
      return this._assetDescriptionsByAssetId;
    }

    if (this._assetDescriptionsPromise) {
      return this._assetDescriptionsPromise;
    }

    this._assetDescriptionsPromise = this._loadAssetDescriptions();
    try {
      return await this._assetDescriptionsPromise;
    } finally {
      this._assetDescriptionsPromise = null;
    }
  }

  buildKeychainDescriptionByName(assetDescriptionsByAssetId) {
    return buildKeychainDescriptionByName(assetDescriptionsByAssetId);
  }

  buildStickerDescriptionByName(assetDescriptionsByAssetId) {
    return buildStickerDescriptionByName(assetDescriptionsByAssetId);
  }

  async getMarketDescriptionsByHash(hashNames, options = {}) {
    const limit = Number.isFinite(Number(options.limit))
      ? Math.max(0, Math.floor(Number(options.limit)))
      : MARKET_LOOKUP_LIMIT;
    const unique = [...new Set(
      (hashNames ?? [])
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
    )];
    const target = unique.slice(0, limit);

    // Seed in-memory cache with on-disk values so we don't re-hit Steam Market across runs.
    for (const hashName of target) {
      if (!this._marketDescriptionsByHash.has(hashName) && this._marketCache.has(hashName)) {
        this._marketDescriptionsByHash.set(hashName, this._marketCache.get(hashName) ?? null);
      }
    }

    const missing = target.filter((hashName) => !this._marketDescriptionsByHash.has(hashName) && !this._marketCache.has(hashName));

    if (missing.length > 0) {
      await this._loadMarketDescriptions(missing);
    }

    const resolved = new Map();
    for (const hashName of target) {
      const value = this._marketDescriptionsByHash.get(hashName);
      if (value) {
        resolved.set(hashName, value);
      }
    }

    return resolved;
  }

  async _loadMarketDescriptions(hashNames) {
    const queue = [...hashNames];
    const workers = [];
    const concurrency = Math.min(MARKET_LOOKUP_CONCURRENCY, queue.length);

    for (let i = 0; i < concurrency; i += 1) {
      workers.push((async () => {
        while (queue.length > 0) {
          const hashName = queue.shift();
          if (!hashName) {
            continue;
          }

          if (this._marketDescriptionsByHash.has(hashName)) {
            continue;
          }

          const pending = this._marketDescriptionPromisesByHash.get(hashName);
          if (pending) {
            await pending;
            continue;
          }

          const lookupPromise = (async () => {
            try {
              await this._waitForMarketRateLimit();
              const description = await fetchMarketDescriptionByHashName(hashName);
              this._marketDescriptionsByHash.set(hashName, description ?? null);
              this._marketCache.set(hashName, description ?? null);
              this._marketBackoffMs = 0;
            } catch (error) {
              if (error?.statusCode === 429) {
                this._applyMarketBackoff();
                console.warn('[market] rate limited (429); backing off', Math.round(this._marketBackoffMs / 1000), 's');
              } else {
                console.warn('[market] failed to resolve hash', hashName, error.message);
              }
              this._marketDescriptionsByHash.set(hashName, null);
              this._marketCache.set(hashName, null);
            } finally {
              this._marketDescriptionPromisesByHash.delete(hashName);
            }
          })();

          this._marketDescriptionPromisesByHash.set(hashName, lookupPromise);
          await lookupPromise;
        }
      })());
    }

    await Promise.all(workers);
  }

  async _waitForMarketRateLimit() {
    const now = Date.now();
    const delayMs = Math.max(0, this._marketNextAllowedAt - now);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    this._marketNextAllowedAt = Date.now() + MARKET_REQUEST_MIN_INTERVAL_MS;
  }

  _applyMarketBackoff() {
    const next = this._marketBackoffMs > 0 ? this._marketBackoffMs * 2 : MARKET_BACKOFF_BASE_MS;
    this._marketBackoffMs = Math.min(MARKET_BACKOFF_MAX_MS, next);
    this._marketNextAllowedAt = Math.max(this._marketNextAllowedAt, Date.now() + this._marketBackoffMs);
  }

  async _loadAssetDescriptions() {
    try {
      let cookies = this._webCookies;
      try {
        await this._ensureWebSession();
        cookies = this._webCookies;
      } catch (error) {
        console.warn('[steam] continuing without authenticated web cookies:', error.message);
        cookies = [];
      }

      const descriptions = await fetchAssetDescriptionsByAssetId({
        steamId: this.steamId,
        cookies,
      });

      this._assetDescriptionsByAssetId = descriptions;
      this._assetDescriptionsFetchedAt = Date.now();
      return this._assetDescriptionsByAssetId;
    } catch (error) {
      if (this._assetDescriptionsByAssetId.size > 0) {
        console.warn('[steam] reusing stale asset description cache:', error.message);
        return this._assetDescriptionsByAssetId;
      }

      console.warn('[steam] unable to load asset descriptions:', error.message);
      return new Map();
    }
  }

  async _ensureWebSession() {
    if (this._webCookies.length > 0) {
      return this._webCookies;
    }

    return this._refreshWebSession();
  }

  async _refreshWebSession() {
    if (this._webSessionPromise) {
      return this._webSessionPromise;
    }

    this._webSessionPromise = new Promise((resolve, reject) => {
      let timeout = null;

      const onSession = (_sessionId, cookies) => {
        cleanup();
        this._webCookies = cookies ?? [];
        resolve(this._webCookies);
      };

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        this.steamUser.off('webSession', onSession);
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for Steam web session'));
      }, WEB_SESSION_TIMEOUT_MS);

      this.steamUser.on('webSession', onSession);
      try {
        this.steamUser.webLogOn();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    try {
      return await this._webSessionPromise;
    } finally {
      this._webSessionPromise = null;
    }
  }

  _invalidateAssetDescriptions() {
    this._assetDescriptionsFetchedAt = 0;
  }

  _clearWebSession() {
    this._webSessionId = null;
    this._webCookies = [];
    this._webSessionPromise = null;
  }

  logout() {
    if (this._qrSession) {
      this._qrSession.cancelLoginAttempt();
      this._qrSession = null;
    }

    if (this._credSession) {
      this._credSession.cancelLoginAttempt();
      this._credSession = null;
    }

    this.steamUser.logOff();
    this.isLoggedIn = false;
    this.isConnectedToGC = false;
    this.steamId = null;
    this.username = null;
    this._qrStatus = 'idle';
    this._clearWebSession();
    this._assetDescriptionsByAssetId = new Map();
    this._invalidateAssetDescriptions();
    this._marketDescriptionsByHash = new Map();
    this._marketDescriptionPromisesByHash = new Map();
    this.armory = this._createEmptyArmoryState();
  }
}

module.exports = SteamClient;
