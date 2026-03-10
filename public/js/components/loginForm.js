import { api } from '../api.js';
import { showToast } from '../app.js';

let qrPollInterval = null;

export function initLoginForm(onSuccess) {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
      btn.classList.add('active');
      const panel = document.getElementById(`tab-${btn.dataset.tab}`);
      panel.classList.remove('hidden');
      panel.classList.add('active');
      clearError();
    });
  });

  // Token link — open in default browser
  document.getElementById('token-link').addEventListener('click', (e) => {
    e.preventDefault();
    window.open('https://steamcommunity.com/chat/clientjstoken', '_blank');
  });

  // QR login
  document.getElementById('btn-load-qr').addEventListener('click', startQRLogin);
  document.getElementById('btn-refresh-qr').addEventListener('click', startQRLogin);

  // Credential login
  document.getElementById('form-credentials').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-credential-login');
    const username = document.getElementById('input-username').value.trim();
    const password = document.getElementById('input-password').value;
    setLoading(btn, true);
    clearError();
    try {
      const result = await api.auth.login(username, password);
      if (result.requiresGuard) {
        showGuardSection(result);
      } else {
        onSuccess(result);
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(btn, false);
    }
  });

  // Steam Guard
  document.getElementById('form-guard').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('input-guard').value.trim();
    const btn = e.target.querySelector('button[type=submit]');
    setLoading(btn, true);
    clearError();
    try {
      const result = await api.auth.steamGuard(code);
      onSuccess(result);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(btn, false);
    }
  });

  // Token login
  document.getElementById('form-token').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    setLoading(btn, true);
    clearError();
    let parsed;
    try {
      parsed = JSON.parse(document.getElementById('input-token-json').value.trim());
    } catch {
      showError('Invalid JSON — paste the full response from steamcommunity.com/chat/clientjstoken');
      setLoading(btn, false);
      return;
    }
    const { token, steamid: steamId, account_name: accountName } = parsed;
    if (!token || !steamId || !accountName) {
      showError('JSON is missing token, steamid, or account_name');
      setLoading(btn, false);
      return;
    }
    try {
      const result = await api.auth.token(token, steamId, accountName);
      onSuccess(result);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(btn, false);
    }
  });
}

async function startQRLogin() {
  stopQRPoll();
  const img = document.getElementById('qr-image');
  const placeholder = document.getElementById('qr-placeholder');
  const statusText = document.getElementById('qr-status-text');
  const refreshBtn = document.getElementById('btn-refresh-qr');

  img.classList.add('hidden');
  placeholder.classList.remove('hidden');
  placeholder.innerHTML = '<span style="color:var(--text-muted);font-size:13px">Generating...</span>';
  refreshBtn.classList.add('hidden');
  statusText.textContent = '';
  statusText.className = 'qr-status';
  clearError();

  try {
    const { qrDataUrl } = await api.auth.startQR();
    img.src = qrDataUrl;
    img.classList.remove('hidden');
    placeholder.classList.add('hidden');
    placeholder.innerHTML = '';
    statusText.textContent = 'Open Steam → tap your account icon → sign in via QR code';

    // Poll for status
    qrPollInterval = setInterval(async () => {
      try {
        const s = await api.auth.qrStatus();
        if (s.status === 'scanned') {
          statusText.textContent = '✓ Scanned — waiting for approval in the Steam app...';
          statusText.className = 'qr-status scanned';
        } else if (s.status === 'authenticated' && s.connectedToGC) {
          stopQRPoll();
          statusText.textContent = '✓ Authenticated!';
          statusText.className = 'qr-status success';
          // Trigger success via app
          window.__qrAuthSuccess?.({ success: true, steamId: s.steamId, username: s.username });
        } else if (s.status === 'error') {
          stopQRPoll();
          statusText.textContent = s.error || 'QR code expired.';
          refreshBtn.classList.remove('hidden');
        }
      } catch (_) {}
    }, 2000);
  } catch (err) {
    placeholder.classList.remove('hidden');
    placeholder.innerHTML = '<span style="color:var(--danger);font-size:13px">Failed to generate QR code</span>';
    showError(err.message);
  }
}

function stopQRPoll() {
  if (qrPollInterval) { clearInterval(qrPollInterval); qrPollInterval = null; }
}

function showGuardSection(result) {
  document.getElementById('guard-section').classList.remove('hidden');
  document.getElementById('form-credentials').classList.add('hidden');
  const typeLabels = {
    EmailCode: 'A Steam Guard code was sent to your email address.',
    DeviceCode: 'Enter the Steam Guard code from your authenticator app.',
    DeviceConfirmation: 'Approve the login request in your Steam mobile app.',
    unknown: 'Enter your Steam Guard code.',
  };
  document.getElementById('guard-desc').textContent = typeLabels[result.guardType] ?? typeLabels.unknown;
  document.getElementById('input-guard').focus();
}

function showError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError() {
  const el = document.getElementById('login-error');
  el.textContent = '';
  el.classList.add('hidden');
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.textContent = loading ? 'Connecting...' : btn.dataset.label || btn.textContent;
}
