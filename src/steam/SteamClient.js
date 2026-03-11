const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');
const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
const QRCode = require('qrcode');
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

    this._setupEventHandlers();
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
      clearTimeout(this._gcTimeout);
      if (this._gcResolve) {
        this._gcResolve({ success: true, steamId: this.steamId, username: this.username });
        this._gcResolve = null;
        this._gcReject = null;
      }
    });

    this.csgo.on('disconnectedFromGC', (reason) => {
      this.isConnectedToGC = false;
      console.warn('Disconnected from GC, reason:', reason);
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
  }
}

module.exports = SteamClient;
