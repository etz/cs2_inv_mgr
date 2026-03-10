const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');
const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
const QRCode = require('qrcode');

class SteamClient {
  constructor() {
    this.steamUser = new SteamUser({ enablePicsCache: false, dataDirectory: null });
    this.csgo = new GlobalOffensive(this.steamUser);
    this.isLoggedIn = false;
    this.isConnectedToGC = false;
    this.steamId = null;
    this.username = null;

    // QR login state
    this._qrSession = null;
    this._qrStatus = 'idle'; // 'idle' | 'waiting' | 'scanned' | 'authenticated' | 'error'
    this._qrError = null;

    // Credential login state
    this._credSession = null;

    // GC connection promise resolver
    this._gcResolve = null;
    this._gcReject = null;
    this._gcTimeout = null;

    // Web session (for community inventory)
    this._webCookies = null;

    // Steam Web API access token (JWT from steam-session, used for
    // IEconService endpoints that return the full inventory including
    // trade-holded items — only available for QR/credential logins)
    this._accessToken = null;

    this._setupEventHandlers();
  }

  _setupEventHandlers() {
    this.steamUser.on('loggedOn', () => {
      this.isLoggedIn = true;
      this.steamId = this.steamUser.steamID.getSteamID64();
      this.steamUser.setPersona(SteamUser.EPersonaState.Online);
      this.steamUser.gamesPlayed([730]);
    });

    this.steamUser.on('webSession', (sessionId, cookies) => {
      this._webCookies = cookies;
    });

    this.steamUser.on('error', (err) => {
      console.error('Steam user error:', err.message);
      this.isLoggedIn = false;
      this.isConnectedToGC = false;
      if (this._gcReject) {
        this._gcReject(err);
        this._gcResolve = null;
        this._gcReject = null;
      }
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

    this.csgo.on('itemAcquired', () => {});
    this.csgo.on('itemChanged', () => {});
    this.csgo.on('itemRemoved', () => {});
  }

  // ── Common GC connection wait ──────────────────────────────────────────────

  _waitForGC(timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      if (this.isConnectedToGC) {
        return resolve({ success: true, steamId: this.steamId, username: this.username });
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
    // Request web session for community inventory
    this.steamUser.once('loggedOn', () => {
      this.steamUser.webLogOn();
    });
    return this._waitForGC();
  }

  // ── Method 1: QR Code ─────────────────────────────────────────────────────

  async startQRLogin() {
    // Clean up any existing session
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
      this._accessToken = session.accessToken ?? null; // save for IEconService calls
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

  // ── Method 2: Username/Password + Steam Guard ──────────────────────────────

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

    // No guard needed — complete immediately
    this.username = username;
    this._accessToken = session.accessToken ?? null; // save for IEconService calls
    await this._completeLoginWithRefreshToken(session.refreshToken, username);
    return { success: true, steamId: this.steamId, username: this.username };
  }

  async submitGuardCode(code) {
    if (!this._credSession) throw new Error('No active login session');
    const session = this._credSession;
    await new Promise((resolve, reject) => {
      session.once('authenticated', resolve);
      session.once('error', reject);
      session.submitSteamGuardCode(code).catch(reject);
    });
    const refreshToken = session.refreshToken;
    const username = session.accountName;
    this._accessToken = session.accessToken ?? null; // save for IEconService calls
    this._credSession = null;
    return this._completeLoginWithRefreshToken(refreshToken, username);
  }

  // ── Method 3: Browser Token ────────────────────────────────────────────────

  startTokenLogin(token, steamId, accountName) {
    this.steamId = steamId;
    this.steamUser.logOn({ accountName, steamID: steamId, webLogonToken: token });
    // webLogOn() requires a refresh token which webLogonToken auth doesn't provide;
    // webSession may still fire automatically — the handler above saves the cookies.
    return this._waitForGC();
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

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
    this._webCookies = null;
    this._accessToken = null;
  }
}

module.exports = SteamClient;
