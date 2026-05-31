/* ============================================================
   LabOS — API client
   A thin wrapper over fetch() for talking to the LabOS backend.

   Design goals:
   * Offline-first preserved. If no API base is configured, or a call fails
     because we're offline, callers fall back to the existing local/mock path.
     The app must keep working with no backend (demo mode) exactly as before.
   * Single source of config. window.LABOS_CONFIG.apiBase (set at deploy time)
     enables real-backend mode. Absent → mock mode.
   * Auth token + verification public key are cached in localStorage.

   This layer is intentionally dependency-free and attaches to window so the
   classic-script services layer can call it (window.LabOSApi).
   ============================================================ */
(function () {
  const TOKEN_KEY = 'labos:authToken:v1';
  const PUBKEY_KEY = 'labos:licencePubKey:v1';

  function apiBase() {
    // Configured at deploy time, e.g. <script>window.LABOS_CONFIG={apiBase:'https://api.labos.africa'}</script>
    const cfg = (typeof window !== 'undefined' && window.LABOS_CONFIG) || {};
    return cfg.apiBase || null;
  }

  // Real-backend mode is on only when an apiBase is configured.
  function isEnabled() {
    return !!apiBase();
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t) {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }
  function getPublicKey() {
    try { return localStorage.getItem(PUBKEY_KEY); } catch (e) { return null; }
  }
  function setPublicKey(pem) {
    try { if (pem) localStorage.setItem(PUBKEY_KEY, pem); } catch (e) {}
  }

  // Core request helper. Returns { ok, status, data } and never throws for
  // HTTP errors — callers decide how to handle non-2xx (and may fall back to
  // the mock path). Network failures reject so callers can catch → offline.
  async function request(method, path, body, opts = {}) {
    const base = apiBase();
    if (!base) throw new Error('api_disabled');
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token && !opts.noAuth) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(base.replace(/\/$/, '') + path, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      // A short timeout via AbortController so a dead backend doesn't hang the UI.
      signal: opts.signal
    });

    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
    return { ok: res.ok, status: res.status, data };
  }

  // Convenience verbs
  const get = (p, opts) => request('GET', p, null, opts);
  const post = (p, b, opts) => request('POST', p, b, opts);
  const patch = (p, b, opts) => request('PATCH', p, b, opts);
  const del = (p, opts) => request('DELETE', p, null, opts);

  // ---- Auth ----
  async function login(email, password, tenantId) {
    const r = await post('/auth/login', { email, password, tenantId }, { noAuth: true });
    if (r.ok && r.data?.token) {
      setToken(r.data.token);
      return { ok: true, user: r.data.user };
    }
    return { ok: false, error: r.data?.error || 'login_failed', status: r.status };
  }
  function logout() { setToken(null); }
  function isAuthed() { return !!getToken(); }

  // ---- Invite-only activation ----
  // LabOS is invite-only: the platform super-admin provisions a tenant, which
  // issues a one-time activation code to the lab admin. The admin redeems it
  // here with their work email + password. On success the backend returns the
  // tenant + a session token. Real enforcement lives server-side; the client
  // gate is a usability/clarity layer, not a security boundary.
  async function validateActivation(code, email, password) {
    const r = await post('/auth/activate', { code, email, password }, { noAuth: true });
    if (r.ok && r.data?.token) {
      setToken(r.data.token);
      return { ok: true, tenant: r.data.tenant, user: r.data.user };
    }
    return { ok: false, error: r.data?.error || 'activation_failed', status: r.status };
  }

  // ---- Licence public key (for WebCrypto verification) ----
  async function fetchPublicKey() {
    const r = await get('/licence/public-key', { noAuth: true });
    if (r.ok && typeof r.data === 'string') { setPublicKey(r.data); return r.data; }
    return null;
  }

  // ---- Devices / licensing ----
  const registerDevice = (fingerprint, label, userAgent) =>
    post('/devices/register', { fingerprint, label, userAgent });
  const heartbeat = (fingerprint) => post('/devices/heartbeat', { fingerprint });
  const listDevices = () => get('/devices');
  const deregisterDevice = (id) => del(`/devices/${encodeURIComponent(id)}`);

  // ---- Sync (drain the offline outbox) ----
  const sync = (ops) => post('/sync', { ops });

  // ---- Clinical Laboratory: requests + results ----
  // The backend stores ONE results row per analyte (test_code/value/unit/range/
  // flag), with a per-row lifecycle entered → validated → released, role-gated.
  const listRequests = (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get('/requests' + (qs ? `?${qs}` : ''));
  };
  const getRequest = (id) => get(`/requests/${encodeURIComponent(id)}`);
  const advanceRequest = (id) => post(`/requests/${encodeURIComponent(id)}/advance`, {});
  const rejectRequest = (id, reason, note) => post(`/requests/${encodeURIComponent(id)}/reject`, { reason, note });

  const listResults = (requestId) => get('/results' + (requestId ? `?requestId=${encodeURIComponent(requestId)}` : ''));
  // Enter one analyte result row. Returns { result } with the server-computed flag.
  const enterResult = (payload) => post('/results', payload);
  const validateResultRow = (resultId) => post(`/results/${encodeURIComponent(resultId)}/validate`, {});
  const releaseResultRow = (resultId) => post(`/results/${encodeURIComponent(resultId)}/release`, {});

  // expose
  window.LabOSApi = {
    isEnabled, apiBase,
    getToken, setToken, getPublicKey, setPublicKey,
    request, get, post, patch, del,
    login, logout, isAuthed, fetchPublicKey,
    validateActivation,
    registerDevice, heartbeat, listDevices, deregisterDevice,
    sync,
    listRequests, getRequest, advanceRequest, rejectRequest,
    listResults, enterResult, validateResultRow, releaseResultRow
  };
})();
