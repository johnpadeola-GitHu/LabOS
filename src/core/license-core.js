/* ============================================================
   LabOS — Core service layer (split into cohesive units during
   the module migration). Each unit is a self-contained singleton
   that shares the ordered-script global scope with the app layer,
   exactly as before — but now in its own reviewable file, which is
   the prerequisite for a later true-ESM cutover once app.views.js
   is itself split into modules.
   ============================================================ */

/* LicenseCore — device registration, RS256 licence verify, grace, lockout. */

const LicenseCore = (function(){
  const STORAGE_LICENCE   = 'labos:licence:v1';     // signed licence token
  const STORAGE_DEVICE    = 'labos:device:v1';      // this device's id + fingerprint
  const STORAGE_DEVICES   = 'labos:devices:v1';     // mock server-side device list
  const STORAGE_HEARTBEAT = 'labos:heartbeat:v1';   // last verified at

  // GRACE_DAYS: how long the app keeps working if it can't reach the server.
  // After this, it falls into read-only grace mode.
  // TESTING: grace effectively disabled — set very high so licence/offline
  // state never interrupts testing (no grace banner, no lockout). Restore to
  // 14 / 7 for production.
  const GRACE_OFFLINE_DAYS = 36500;   // ~100 years
  const GRACE_HARD_LOCK_DAYS = 36500; // app never hard-locks during testing

  // HEARTBEAT_INTERVAL_MS: how often the app re-verifies the licence with the
  // server. 6 hours in production. In the prototype we still run on this
  // schedule so the timing behaviour is identical.
  const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;

  // ---- Signature implementation ----
  // PROTOTYPE NOTE: This uses a salted SHA-256 (server-secret || payload) for
  // signing. It is NOT cryptographic HMAC — a proper HMAC uses inner/outer
  // padding to defend against length-extension attacks against bare-hash MACs.
  // For prototype/demo purposes this is fine because:
  //   (a) the secret is hardcoded in the client and visible to anyone who
  //       opens devtools, so the security property we're demonstrating is
  //       tamper *detection*, not unforgeability against the user.
  //   (b) the server-side production implementation MUST replace this with
  //       real HMAC-SHA256 (via crypto.createHmac in Node, or SubtleCrypto in
  //       a service worker). The replacement is one function.
  //
  // PRODUCTION SWAP (when wiring to a real backend):
  //   1. On the server: use crypto.createHmac('sha256', SERVER_SECRET).update(canonicalJson(payload)).digest('hex')
  //   2. In the client: replace this with SubtleCrypto async HMAC verification
  //      (and rework signing-ish calls into proper async). The client never
  //      signs in production — only verifies.
  const DEMO_SECRET = 'labos-prototype-demo-secret-do-not-use-in-production';

  function sha256(msg){
    // Minimal SHA-256 (string in → hex string out). Adapted from the public-
    // domain reference; kept compact and obvious for review.
    function rotr(n,x){return (x>>>n)|(x<<(32-n))}
    const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const bytes=[];
    for(let i=0;i<msg.length;i++){
      let c=msg.charCodeAt(i);
      if(c<0x80){bytes.push(c)}
      else if(c<0x800){bytes.push(0xc0|(c>>6),0x80|(c&0x3f))}
      else if(c<0xd800||c>=0xe000){bytes.push(0xe0|(c>>12),0x80|((c>>6)&0x3f),0x80|(c&0x3f))}
      else{i++;const c2=msg.charCodeAt(i);const cp=0x10000+(((c&0x3ff)<<10)|(c2&0x3ff));bytes.push(0xf0|(cp>>18),0x80|((cp>>12)&0x3f),0x80|((cp>>6)&0x3f),0x80|(cp&0x3f))}
    }
    const len=bytes.length;
    bytes.push(0x80);
    while(bytes.length%64!==56)bytes.push(0);
    const bits=len*8;
    bytes.push(0,0,0,0,(bits>>>24)&0xff,(bits>>>16)&0xff,(bits>>>8)&0xff,bits&0xff);
    for(let i=0;i<bytes.length;i+=64){
      const W=new Array(64);
      for(let t=0;t<16;t++)W[t]=(bytes[i+t*4]<<24)|(bytes[i+t*4+1]<<16)|(bytes[i+t*4+2]<<8)|bytes[i+t*4+3];
      for(let t=16;t<64;t++){const s0=rotr(7,W[t-15])^rotr(18,W[t-15])^(W[t-15]>>>3);const s1=rotr(17,W[t-2])^rotr(19,W[t-2])^(W[t-2]>>>10);W[t]=(W[t-16]+s0+W[t-7]+s1)|0}
      let [a,b,c,d,e,f,g,h]=H;
      for(let t=0;t<64;t++){const S1=rotr(6,e)^rotr(11,e)^rotr(25,e);const ch=(e&f)^(~e&g);const t1=(h+S1+ch+K[t]+W[t])|0;const S0=rotr(2,a)^rotr(13,a)^rotr(22,a);const mj=(a&b)^(a&c)^(b&c);const t2=(S0+mj)|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0}
      H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
    }
    return H.map(n=>('00000000'+(n>>>0).toString(16)).slice(-8)).join('');
  }

  // Salted SHA-256 signature for prototype use. Production replaces with HMAC.
  function signWithSecret(secret, msg){
    // Double-salt: secret || msg || secret. Deterministic, tamper-detecting,
    // not safe against length-extension attacks but irrelevant here because
    // the secret is hardcoded in the client anyway.
    return sha256(secret + '|' + msg + '|' + secret);
  }

  // ---- Device fingerprint ----
  // A stable-per-device hash. In production this would also include hardware
  // signals (canvas/audio fingerprinting via FingerprintJS or similar). For
  // the prototype, userAgent + screen + timezone + a per-install UUID gives a
  // reasonable approximation.
  function computeFingerprint(){
    let installUuid;
    try { installUuid = localStorage.getItem('labos:installUuid:v1'); } catch(e){}
    if(!installUuid){
      installUuid = 'inst_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,12);
      try { localStorage.setItem('labos:installUuid:v1', installUuid); } catch(e){}
    }
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    const screen = (typeof window !== 'undefined' && window.screen) ? `${window.screen.width}x${window.screen.height}` : '';
    const tz = (Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
    const raw = `${installUuid}|${ua}|${screen}|${tz}`;
    return sha256(raw).slice(0, 32);
  }

  // ---- Licence signing/verification ----
  // The server signs the licence with its secret. In production the device
  // only ever *verifies*. We expose signLicence() here for the prototype's
  // simulated server.
  function canonicalJson(obj){
    // Stable key order so signing is deterministic
    const keys = Object.keys(obj).filter(k => k !== 'sig').sort();
    return JSON.stringify(keys.map(k => [k, obj[k]]));
  }

  function signLicence(payload){
    const canonical = canonicalJson(payload);
    const sig = signWithSecret(DEMO_SECRET, canonical);
    return { ...payload, sig };
  }

  function verifyLicence(licence){
    if(!licence || typeof licence !== 'object') return {ok:false, reason:'no_licence'};
    if(!licence.sig) return {ok:false, reason:'unsigned'};
    const expected = signWithSecret(DEMO_SECRET, canonicalJson(licence));
    if(expected !== licence.sig) return {ok:false, reason:'bad_signature'};
    // Time checks
    const now = Date.now();
    const validFrom = licence.validFrom ? Date.parse(licence.validFrom) : 0;
    const validUntil = licence.validUntil ? Date.parse(licence.validUntil) : 0;
    if(now < validFrom) return {ok:false, reason:'not_yet_valid', validFrom: licence.validFrom};
    if(now > validUntil) return {ok:false, reason:'expired', validUntil: licence.validUntil};
    return {ok:true};
  }

  // ---- Mock server ----
  // Replace these with real fetch() calls when the backend is ready.
  // The signatures and return shapes match the documented API contract above.
  function mockServerRegisterDevice(tenantId, fingerprint){
    // Server-side: check this tenant's licence, see how many devices are
    // registered, refuse if at cap. Here we use localStorage to simulate.
    const allDevices = loadDevices();
    const tenantDevices = allDevices.filter(d => d.tenantId === tenantId);
    // Find the tenant's licence to read maxDevices (in prod, the server looks
    // this up in its DB).
    const tenant = (APP_STATE.tenants || []).find(t => t.id === tenantId);
    if(!tenant) return {error:'unknown_tenant'};
    // Tenants reference plans by code ('starter', 'professional', 'enterprise')
    // stored on tenant.plan. Plans are stored with id ('plan_corecare') and code.
    const plan = (APP_STATE.plans || []).find(p => p.code === tenant.plan || p.id === tenant.planId) || {entitlements:{}};
    const rawCap = (plan.entitlements && plan.entitlements.maxDevices);
    const maxDevices = (rawCap === 'unlimited' || rawCap == null) ? Infinity : rawCap;
    // If this fingerprint is already registered, just return it (idempotent)
    const existing = tenantDevices.find(d => d.fingerprint === fingerprint);
    if(existing){
      existing.lastSyncAt = new Date().toISOString();
      saveDevices(allDevices);
      return { device: existing, licence: makeLicence(tenant, plan) };
    }
    if(tenantDevices.length >= maxDevices){
      return { error:'device_cap_reached', maxDevices, currentDevices: tenantDevices.length };
    }
    const newDevice = {
      id: 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8),
      tenantId,
      fingerprint,
      label: deriveDeviceLabel(),
      registeredAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
      revokedAt: null
    };
    allDevices.push(newDevice);
    saveDevices(allDevices);
    return { device: newDevice, licence: makeLicence(tenant, plan) };
  }

  function mockServerHeartbeat(tenantId, deviceId){
    const allDevices = loadDevices();
    const device = allDevices.find(d => d.id === deviceId);
    if(!device) return {error:'device_deregistered'};
    if(device.revokedAt) return {error:'device_revoked'};
    device.lastSyncAt = new Date().toISOString();
    saveDevices(allDevices);
    const tenant = (APP_STATE.tenants || []).find(t => t.id === tenantId);
    if(!tenant) return {error:'unknown_tenant'};
    if(tenant.status === 'CANCELLED' || tenant.status === 'SUSPENDED' || tenant.status === 'SOFT_SUSPENDED') return {error:'licence_revoked'};
    const plan = (APP_STATE.plans || []).find(p => p.code === tenant.plan || p.id === tenant.planId) || {entitlements:{}};
    return { licence: makeLicence(tenant, plan), devices: allDevices.filter(d => d.tenantId === tenantId) };
  }

  function mockServerDeregister(tenantId, deviceId){
    const allDevices = loadDevices();
    const idx = allDevices.findIndex(d => d.id === deviceId && d.tenantId === tenantId);
    if(idx === -1) return {error:'not_found'};
    allDevices[idx].revokedAt = new Date().toISOString();
    saveDevices(allDevices);
    return {ok:true};
  }

  // Build a signed licence for a tenant. In production the server does this
  // server-side with its private signing key.
  function makeLicence(tenant, plan){
    const now = new Date();
    const sub = (APP_STATE.subscriptions || []).find(s => s.tenantId === tenant.id);
    // Derive validUntil: if there's a subscription with renewalDate, use that.
    // Otherwise, 1 year from now (so the demo doesn't expire immediately).
    let validUntil = sub && sub.renewalDate ? new Date(sub.renewalDate) : new Date(now.getTime() + 365*24*60*60*1000);
    // If the tenant is PAST_DUE, validUntil is in the past
    if(tenant.status === 'PAST_DUE'){
      validUntil = new Date(now.getTime() - 1*24*60*60*1000);
    }
    const ents = plan.entitlements || {};
    const payload = {
      tenantId: tenant.id,
      legalName: tenant.legalName || tenant.name,
      regNumber: tenant.regNumber || '',
      tin: tenant.tin || '',
      plan: plan.code || plan.id || tenant.plan || tenant.planId || 'starter',
      planName: plan.name || '',
      entitlements: {
        maxDevices: ents.maxDevices || 5,
        maxUsers: ents.maxUsers || ents.maxStaff || 10,
        maxPatientsPerMonth: ents.maxPatientsPerMonth || 0,
        maxCentres: ents.maxCentres || 1,
        modules: ents.modules || {}
      },
      validFrom: (sub && sub.startedAt) || now.toISOString(),
      validUntil: validUntil.toISOString(),
      issuedAt: now.toISOString(),
      nonce: Math.random().toString(36).slice(2,12)
    };
    return signLicence(payload);
  }

  function deriveDeviceLabel(){
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    let os = 'Unknown';
    if(/Windows NT 10/.test(ua)) os = 'Windows 10/11';
    else if(/Windows NT/.test(ua)) os = 'Windows';
    else if(/Mac OS X/.test(ua)) os = 'macOS';
    else if(/Android/.test(ua)) os = 'Android';
    else if(/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
    else if(/Linux/.test(ua)) os = 'Linux';
    let browser = 'Browser';
    if(/Edg\//.test(ua)) browser = 'Edge';
    else if(/Chrome/.test(ua)) browser = 'Chrome';
    else if(/Firefox/.test(ua)) browser = 'Firefox';
    else if(/Safari/.test(ua)) browser = 'Safari';
    return `${os} · ${browser}`;
  }

  // ---- Local storage helpers ----
  function loadDevices(){
    try { return JSON.parse(localStorage.getItem(STORAGE_DEVICES) || '[]'); } catch(e){ return []; }
  }
  function saveDevices(list){
    try { localStorage.setItem(STORAGE_DEVICES, JSON.stringify(list)); } catch(e){}
  }
  function loadLicence(){
    try { return JSON.parse(localStorage.getItem(STORAGE_LICENCE) || 'null'); } catch(e){ return null; }
  }
  function saveLicence(lic){
    try { localStorage.setItem(STORAGE_LICENCE, JSON.stringify(lic)); } catch(e){}
  }
  function loadDeviceRecord(){
    try { return JSON.parse(localStorage.getItem(STORAGE_DEVICE) || 'null'); } catch(e){ return null; }
  }
  function saveDeviceRecord(d){
    try { localStorage.setItem(STORAGE_DEVICE, JSON.stringify(d)); } catch(e){}
  }
  function loadHeartbeat(){
    try { return JSON.parse(localStorage.getItem(STORAGE_HEARTBEAT) || 'null'); } catch(e){ return null; }
  }
  function saveHeartbeat(h){
    try { localStorage.setItem(STORAGE_HEARTBEAT, JSON.stringify(h)); } catch(e){}
  }

  // ---- Public state ----
  const state = {
    licence: null,           // The signed licence token
    device: null,            // This device's registration record
    status: 'unknown',       // 'valid' | 'grace' | 'lockout' | 'unregistered' | 'unknown'
    lastVerifiedAt: null,    // When we last successfully heartbeat
    lastError: null,         // Last verification error reason
    daysOfflineGrace: 0,     // How many days since last successful heartbeat
    daysUntilLockout: null   // How many days until hard lock (if in grace)
  };

  const subscribers = new Set();
  function subscribe(fn){ subscribers.add(fn); return () => subscribers.delete(fn); }
  function notify(){ for(const fn of subscribers){ try { fn(state); } catch(e){} } }

  // ---- Core operations ----

  // Register this device with the server. Called on first run for a tenant,
  // or after a tenant switch. Idempotent — calling it twice for the same
  // fingerprint just returns the existing device record.
  function registerDevice(tenantId){
    const fingerprint = computeFingerprint();

    // Real-backend path: if an API is configured and we're authenticated,
    // register against the server (which enforces the device cap and signs the
    // licence with its private key). This runs asynchronously and updates state
    // on completion; the synchronous mock path below provides an immediate
    // optimistic result and the offline fallback.
    if (typeof LabOSApi !== 'undefined' && LabOSApi.isEnabled() && LabOSApi.isAuthed()) {
      LabOSApi.registerDevice(fingerprint, deriveDeviceLabel(), (typeof navigator !== 'undefined' ? navigator.userAgent : ''))
        .then(async (r) => {
          if (r.ok && r.data && r.data.licence) {
            const lic = normaliseServerLicence(r.data.licence);
            state.device = r.data.device;
            state.licence = lic;
            saveDeviceRecord(r.data.device);
            saveLicence(lic);
            state.lastVerifiedAt = new Date().toISOString();
            saveHeartbeat({ at: state.lastVerifiedAt });
            // Verify the server signature with WebCrypto (real RS256).
            const v = await verifyServerLicence(r.data.licence);
            state.status = v.ok ? 'valid' : 'lockout';
            state.lastError = v.ok ? null : v.reason;
            notify();
          } else if (r.data && r.data.error) {
            state.lastError = r.data.error;
            state.status = (r.data.error === 'device_cap_reached') ? 'lockout' : 'unregistered';
            notify();
          }
        })
        .catch(() => { /* offline or network error → keep mock/local result */ });
      // fall through to the mock so there's an immediate, offline-safe result
    }

    const result = mockServerRegisterDevice(tenantId, fingerprint);
    if(result.error){
      state.lastError = result.error;
      state.status = 'unregistered';
      notify();
      return result;
    }
    state.device = result.device;
    state.licence = result.licence;
    saveDeviceRecord(result.device);
    saveLicence(result.licence);
    state.lastVerifiedAt = new Date().toISOString();
    saveHeartbeat({ at: state.lastVerifiedAt });
    state.status = 'valid';
    state.lastError = null;
    notify();
    return result;
  }

  // Send a heartbeat. If online and successful, refresh the licence.
  // If offline, just check the existing licence locally.
  function heartbeat(){
    const dev = state.device || loadDeviceRecord();
    if(!dev){ state.status = 'unregistered'; notify(); return; }
    // If offline, just locally verify
    if(typeof OfflineCore !== 'undefined' && !OfflineCore.state.online){
      const v = verifyLicence(state.licence || loadLicence());
      updateGraceState(v);
      return;
    }

    // Real-backend path: heartbeat against the server, which gates on device +
    // tenant state and returns a fresh signed licence.
    if (typeof LabOSApi !== 'undefined' && LabOSApi.isEnabled() && LabOSApi.isAuthed()) {
      const fingerprint = computeFingerprint();
      LabOSApi.heartbeat(fingerprint)
        .then(async (r) => {
          if (!r.ok || !r.data) return; // leave state; will retry next beat
          const d = r.data;
          if (d.status === 'lockout') {
            state.lastError = d.reason || 'licence_revoked';
            state.status = 'lockout';
            state.licence = null;
            saveLicence(null);
            notify();
            return;
          }
          if (d.status === 'valid' && d.licence) {
            const lic = normaliseServerLicence(d.licence);
            state.licence = lic;
            saveLicence(lic);
            state.lastVerifiedAt = new Date().toISOString();
            saveHeartbeat({ at: state.lastVerifiedAt });
            const v = await verifyServerLicence(d.licence);
            updateGraceState(v.ok ? { ok: true } : { ok: false, reason: v.reason });
          }
        })
        .catch(() => {
          // Network error → treat as offline: verify locally, enter grace if stale.
          const v = verifyLicence(state.licence || loadLicence());
          updateGraceState(v);
        });
      return;
    }

    const result = mockServerHeartbeat(dev.tenantId, dev.id);
    if(result.error){
      state.lastError = result.error;
      if(result.error === 'licence_revoked' || result.error === 'device_revoked' || result.error === 'device_deregistered'){
        state.status = 'lockout';
        state.licence = null;
        saveLicence(null);
        notify();
        return;
      }
    } else if(result.licence){
      state.licence = result.licence;
      saveLicence(result.licence);
      state.lastVerifiedAt = new Date().toISOString();
      saveHeartbeat({ at: state.lastVerifiedAt });
      const v = verifyLicence(result.licence);
      updateGraceState(v);
      return;
    }
    // Fallback to local verification
    const v = verifyLicence(state.licence || loadLicence());
    updateGraceState(v);
  }

  // ---- Server-licence helpers (real backend) ----
  // The server returns { payload, signature }. The local mock uses a flat
  // object with a `sig` field. We normalise the server shape into the flat
  // shape the rest of LicenseCore (and the UI) already understands, copying
  // the validFrom/validUntil/entitlements through so grace logic works.
  function normaliseServerLicence(serverLic){
    if (!serverLic || !serverLic.payload) return serverLic;
    const p = serverLic.payload;
    return {
      ...p,
      // keep the raw server form too, for signature verification
      __server: { payload: p, signature: serverLic.signature }
    };
  }

  // Verify a server-signed (RS256) licence using WebCrypto and the public key
  // fetched from the backend. Falls back to "ok" only if we cannot verify
  // because the key/crypto isn't available AND the licence is unexpired — never
  // for a bad signature.
  async function verifyServerLicence(serverLic){
    try {
      const payload = serverLic.payload || (serverLic.__server && serverLic.__server.payload);
      const signature = serverLic.signature || (serverLic.__server && serverLic.__server.signature);
      if (!payload || !signature) return { ok:false, reason:'unsigned' };

      // Time checks first (cheap, deterministic).
      const now = Date.now();
      if (payload.validFrom && now < Date.parse(payload.validFrom)) return { ok:false, reason:'not_yet_valid' };
      if (payload.validUntil && now > Date.parse(payload.validUntil)) return { ok:false, reason:'expired' };

      const pem = (typeof LabOSApi !== 'undefined') ? LabOSApi.getPublicKey() : null;
      if (!pem || typeof crypto === 'undefined' || !crypto.subtle) {
        // Can't cryptographically verify here; rely on time checks + the fact
        // that the licence came over an authenticated TLS channel.
        return { ok:true, unverifiedSignature:true };
      }
      const key = await importSpkiPublicKey(pem);
      const data = new TextEncoder().encode(canonicalServer(payload));
      const sig = base64ToBytes(signature);
      const ok = await crypto.subtle.verify(
        { name:'RSASSA-PKCS1-v1_5' }, key, sig, data
      );
      return ok ? { ok:true } : { ok:false, reason:'bad_signature' };
    } catch (e) {
      return { ok:false, reason:'verify_error' };
    }
  }

  // Canonical serialisation MUST match the server's (services/licence.js):
  // recursively sort object keys, JSON-encode.
  function canonicalServer(value){
    if (Array.isArray(value)) return '[' + value.map(canonicalServer).join(',') + ']';
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalServer(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  async function importSpkiPublicKey(pem){
    const b64 = pem.replace(/-----BEGIN PUBLIC KEY-----/, '')
                   .replace(/-----END PUBLIC KEY-----/, '')
                   .replace(/\s+/g, '');
    const der = base64ToBytes(b64);
    return crypto.subtle.importKey(
      'spki', der,
      { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
      false, ['verify']
    );
  }

  function base64ToBytes(b64){
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function updateGraceState(verifyResult){
    // TESTING / demo: when there is no real licensing backend configured, never
    // enter grace or lockout — the app stays fully usable. Restore/remove this
    // guard for production where a real backend issues signed licences.
    const hasRealBackend = (typeof window !== 'undefined' && window.LABOS_CONFIG && window.LABOS_CONFIG.apiBase);
    if(!hasRealBackend){
      state.status = 'valid';
      state.lastError = null;
      state.daysUntilLockout = null;
      notify();
      return;
    }
    const hb = loadHeartbeat();
    const lastAt = hb && hb.at ? Date.parse(hb.at) : 0;
    const daysSince = lastAt ? Math.floor((Date.now() - lastAt) / (24*60*60*1000)) : 999;
    state.daysOfflineGrace = daysSince;
    if(verifyResult.ok){
      if(daysSince > GRACE_OFFLINE_DAYS){
        // Local licence still valid but we've been offline too long
        state.status = (daysSince > GRACE_OFFLINE_DAYS + GRACE_HARD_LOCK_DAYS) ? 'lockout' : 'grace';
        state.daysUntilLockout = Math.max(0, (GRACE_OFFLINE_DAYS + GRACE_HARD_LOCK_DAYS) - daysSince);
        state.lastError = 'heartbeat_timeout';
      } else {
        state.status = 'valid';
        state.lastError = null;
        state.daysUntilLockout = null;
      }
    } else {
      // Signature failed, expired, etc.
      state.lastError = verifyResult.reason;
      if(verifyResult.reason === 'expired'){
        // Past validUntil — go to grace for a week, then hard lock
        const expiredAt = Date.parse(verifyResult.validUntil);
        const daysExpired = Math.floor((Date.now() - expiredAt) / (24*60*60*1000));
        state.status = daysExpired > GRACE_HARD_LOCK_DAYS ? 'lockout' : 'grace';
        state.daysUntilLockout = Math.max(0, GRACE_HARD_LOCK_DAYS - daysExpired);
      } else {
        // Bad signature, not yet valid, missing — hard lock immediately
        state.status = 'lockout';
        state.daysUntilLockout = 0;
      }
    }
    notify();
  }

  // Block a server-required action if not in valid state.
  // Returns true if the action should proceed.
  function canMutate(){
    // TESTING: allow mutations in any non-lockout state (grace no longer blocks).
    // Restore to `state.status === 'valid'` for production.
    return state.status !== 'lockout';
  }

  // Init: load state from storage and decide where we stand
  function init(){
    state.device = loadDeviceRecord();
    state.licence = loadLicence();
    const hb = loadHeartbeat();
    state.lastVerifiedAt = hb ? hb.at : null;
    if(!state.device){
      state.status = 'unregistered';
      notify();
      return;
    }
    // Re-verify the current licence; this also computes grace state
    const v = verifyLicence(state.licence);
    updateGraceState(v);
    // Schedule heartbeats
    if(typeof setInterval !== 'undefined'){
      setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
      // Also heartbeat once on init after a short delay (let the rest of the
      // app finish booting first)
      setTimeout(heartbeat, 2000);
    }
  }

  function listDevices(tenantId){
    return loadDevices().filter(d => d.tenantId === tenantId && !d.revokedAt);
  }

  function deregisterDevice(tenantId, deviceId){
    const result = mockServerDeregister(tenantId, deviceId);
    if(result.ok && state.device && state.device.id === deviceId){
      // This device just deregistered itself — clear local licence
      state.device = null;
      state.licence = null;
      saveDeviceRecord(null);
      saveLicence(null);
      state.status = 'unregistered';
      notify();
    } else {
      notify();
    }
    return result;
  }

  // For the prototype's demo overlay: simulate revocation by another admin
  function _demoRevokeThisDevice(){
    if(!state.device) return;
    const all = loadDevices();
    const me = all.find(d => d.id === state.device.id);
    if(me){ me.revokedAt = new Date().toISOString(); saveDevices(all); }
    heartbeat();
  }

  // ---- Invite-only activation ----
  // LabOS is invite-only: a platform super-admin provisions the tenant and the
  // tenant carries an `activationCode`. The lab admin redeems that code here.
  //
  // Production: when an apiBase is configured, defer to the backend
  // (LabOSApi.validateActivation) which is the real authority. Offline / demo:
  // fall back to checking the code against provisioned tenants in APP_STATE.
  // This client check is for UX clarity only — it is NOT a security boundary;
  // a determined user can edit client state. Real isolation is server-side.
  function mockValidateActivation(code, email){
    const norm = String(code || '').trim().toUpperCase();
    if(!norm) return { ok:false, reason:'missing_code' };
    const tenant = (APP_STATE.tenants || []).find(t =>
      t.activationCode && String(t.activationCode).toUpperCase() === norm);
    if(!tenant) return { ok:false, reason:'invalid_code' };
    if(tenant.status === 'CANCELLED' || tenant.status === 'SUSPENDED'){
      return { ok:false, reason:'tenant_inactive', status: tenant.status };
    }
    if(tenant.activationUsedAt){
      return { ok:false, reason:'code_already_used', tenantId: tenant.id };
    }
    return { ok:true, tenant, email: email || null };
  }

  // Returns a Promise so the caller can await the backend in production while
  // the offline path resolves synchronously-fast.
  async function validateActivation(code, email, password){
    if(typeof LabOSApi !== 'undefined' && LabOSApi.isEnabled && LabOSApi.isEnabled()){
      try {
        const r = await LabOSApi.validateActivation(code, email, password);
        if(r.ok) return { ok:true, tenant:r.tenant, backend:true };
        return { ok:false, reason:r.error || 'activation_failed', backend:true, status:r.status };
      } catch(e){
        // Backend unreachable — fall through to the offline mock so a lab with
        // a valid provisioned code can still get to work offline.
        const m = mockValidateActivation(code, email);
        return { ...m, backend:false, offlineFallback:true };
      }
    }
    return { ...mockValidateActivation(code, email), backend:false };
  }

  // Mark a provisioned code as redeemed (offline mock bookkeeping only).
  function markActivationUsed(tenantId){
    const t = (APP_STATE.tenants || []).find(x => x.id === tenantId);
    if(t) t.activationUsedAt = new Date().toISOString();
  }

  // Generate a human-readable, one-time activation code for a tenant. Format:
  // PREFIX-XXXX-YEAR (e.g. HAUWA-7F3K-2026). The PREFIX derives from the lab
  // name so the operator can eyeball which lab a code belongs to. In production
  // the *backend* mints and stores these; here we mint client-side for the
  // simulated platform. Avoids ambiguous characters (0/O, 1/I).
  function generateActivationCode(labName){
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const prefix = String(labName || 'LAB')
      .toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'LAB';
    let mid = '';
    for(let i = 0; i < 4; i++){
      mid += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    const year = new Date().getFullYear();
    return `${prefix}-${mid}-${year}`;
  }

  return {
    init, registerDevice, deregisterDevice, heartbeat, listDevices,
    verifyLicence, signLicence, computeFingerprint, canMutate, subscribe,
    validateActivation, markActivationUsed, generateActivationCode,
    _demoRevokeThisDevice,
    get state(){ return state; },
    get GRACE_OFFLINE_DAYS(){ return GRACE_OFFLINE_DAYS; },
    get GRACE_HARD_LOCK_DAYS(){ return GRACE_HARD_LOCK_DAYS; }
  };
})();
