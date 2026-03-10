async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({ error: 'Invalid response' }));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  return data;
}

export const api = {
  auth: {
    status:     ()             => request('GET',  '/api/auth/status'),
    login:      (u, p)         => request('POST', '/api/auth/login',       { username: u, password: p }),
    steamGuard: (code)         => request('POST', '/api/auth/steam-guard', { code }),
    startQR:    ()             => request('POST', '/api/auth/qr'),
    qrStatus:   ()             => request('GET',  '/api/auth/qr/status'),
    token:      (token, id, name) => request('POST', '/api/auth/token',     { token, steamId: id, accountName: name }),
    logout:     ()             => request('POST', '/api/auth/logout'),
  },
  inventory: {
    get: () => request('GET', '/api/inventory'),
  },
  caskets: {
    contents: (id)             => request('GET',  `/api/caskets/${id}/contents`),
    add:      (casketId, itemId) => request('POST', `/api/caskets/${casketId}/add`,    { itemId }),
    remove:   (casketId, itemId) => request('POST', `/api/caskets/${casketId}/remove`, { itemId }),
  },
};
