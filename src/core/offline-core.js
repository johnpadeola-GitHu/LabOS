/* ============================================================
   LabOS — Core service layer (split into cohesive units during
   the module migration). Each unit is a self-contained singleton
   that shares the ordered-script global scope with the app layer,
   exactly as before — but now in its own reviewable file, which is
   the prerequisite for a later true-ESM cutover once app.views.js
   is itself split into modules.
   ============================================================ */

/* OfflineCore — offline-first persistence, outbox, sync, connectivity. */

const OfflineCore = (function(){
  const STORAGE_KEY = 'labos:appstate:v1';
  const OUTBOX_KEY  = 'labos:outbox:v1';
  const META_KEY    = 'labos:meta:v1';
  const SCHEMA_VERSION = 2; // bump when APP_STATE shape changes

  // ---- localStorage helpers (defensive — Safari private mode throws,
  //      quota exhaustion throws, some environments block localStorage) ----
  function lsGet(key){ try { return localStorage.getItem(key); } catch(e){ return null; } }
  function lsSet(key, val){
    try {
      localStorage.setItem(key, val);
      return {ok:true};
    } catch(e){
      const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(String(e.message)));
      return {ok:false, quota:isQuota, error:e};
    }
  }
  function lsRemove(key){ try { localStorage.removeItem(key); } catch(e){} }

  // ---- State persistence ----
  // We only persist the keys that change at runtime. Catalogues are baked into
  // the bundle so we don't waste storage on them.
  const PERSISTED_KEYS = [
    'patients','requests','samples','invoices','inventory',
    'vitalsHistory','imagingOrders','dnaOrders','packageOrders',
    'microbiologyResults','tenantPricing','session','currentRoute','dataMode',
    'staff'
  ];
  // Onboarded tenants/centres/subscriptions are persisted SEPARATELY (merged on
  // restore) so a lab created in a prior session survives reload, without the
  // persisted copy clobbering newer seeded tenants on a code update.
  const ONBOARDED_KEY = 'labos:onboarded:v1';

  function snapshot(){
    const out = {};
    for(const k of PERSISTED_KEYS){
      if(APP_STATE[k] !== undefined) out[k] = APP_STATE[k];
    }
    // Wrap in a versioned envelope so future migrations are safe
    return {v: SCHEMA_VERSION, savedAt: new Date().toISOString(), data: out};
  }

  // Migrate older snapshot shapes forward. Returns the migrated data object,
  // or null if migration is impossible.
  function migrate(raw){
    if(!raw || typeof raw !== 'object') return null;
    // v1 = bare object (no envelope) — earlier prototype builds
    if(raw.v === undefined && raw.data === undefined){
      return raw; // treat as v1; keys match v2's data shape
    }
    // v2 = current envelope
    if(raw.v === 2) return raw.data || {};
    // Future versions: add downgrade handling here
    if(raw.v > SCHEMA_VERSION){
      console.warn('[OfflineCore] Snapshot from newer app version (' + raw.v + '). Ignoring to avoid data loss.');
      return null;
    }
    return raw.data || null;
  }

  let persistTimer = null;
  let quotaWarned = false;

  // Persist only the tenant/centre/subscription records that were created at
  // runtime (onboarded labs use tnt_new_* ids). Seeded tenants are never
  // persisted, so a code update that changes the seed still reaches returning
  // users.
  function persistOnboarded(){
    try {
      const onbTenants = (APP_STATE.tenants||[]).filter(t => /^tnt_new_/.test(t.id));
      if(onbTenants.length === 0){ lsRemove(ONBOARDED_KEY); return; }
      const onbIds = new Set(onbTenants.map(t => t.id));
      const blob = {
        v: SCHEMA_VERSION,
        tenants: onbTenants,
        centres: (APP_STATE.centres||[]).filter(c => onbIds.has(c.tenantId)),
        subscriptions: (APP_STATE.subscriptions||[]).filter(s => onbIds.has(s.tenantId))
      };
      lsSet(ONBOARDED_KEY, JSON.stringify(blob));
    } catch(e){ /* non-fatal */ }
  }

  function restoreOnboarded(){
    const raw = lsGet(ONBOARDED_KEY);
    if(!raw) return;
    try {
      const blob = JSON.parse(raw);
      if(!blob || !Array.isArray(blob.tenants)) return;
      const existingTenantIds = new Set((APP_STATE.tenants||[]).map(t => t.id));
      for(const t of blob.tenants){ if(!existingTenantIds.has(t.id)) APP_STATE.tenants.push(t); }
      const existingCentreIds = new Set((APP_STATE.centres||[]).map(c => c.id));
      for(const c of (blob.centres||[])){ if(!existingCentreIds.has(c.id)) APP_STATE.centres.push(c); }
      const existingSubIds = new Set((APP_STATE.subscriptions||[]).map(s => s.id));
      for(const s of (blob.subscriptions||[])){ if(!existingSubIds.has(s.id)) APP_STATE.subscriptions.push(s); }
    } catch(e){ /* non-fatal */ }
  }

  function schedulePersist(){
    if(persistTimer) return;
    persistTimer = setTimeout(()=>{
      persistTimer = null;
      try {
        const snap = JSON.stringify(snapshot());
        const r = lsSet(STORAGE_KEY, snap);
        if(r.ok){
          state.lastSaved = new Date().toISOString();
          state.localBytes = snap.length;
          quotaWarned = false;
        } else if(r.quota && !quotaWarned){
          quotaWarned = true;
          state.quotaExceeded = true;
          notifySubscribers();
          if(typeof toast === 'function'){
            toast('Local storage is full. Clear old records or export them to free space.',
                  {type:'error', title:'Storage limit reached', duration:10000});
          }
        }
        // Persist onboarded tenants separately (merge-on-restore, never clobbers seed)
        persistOnboarded();
      } catch(e){
        console.warn('[OfflineCore] persist failed', e);
      }
    }, 250); // 250ms debounce
  }

  function restore(){
    // Always merge onboarded tenants first, so even if the main snapshot is
    // absent, a previously-onboarded lab still exists.
    restoreOnboarded();
    const raw = lsGet(STORAGE_KEY);
    if(!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      const data = migrate(parsed);
      if(!data) return false;
      for(const k of PERSISTED_KEYS){
        if(data[k] !== undefined) APP_STATE[k] = data[k];
      }
      state.lastRestored = new Date().toISOString();
      state.localBytes = raw.length;
      state.lastSavedAt = parsed.savedAt || null;
      return true;
    } catch(e){
      console.warn('[OfflineCore] restore failed, clearing corrupt state', e);
      lsRemove(STORAGE_KEY);
      return false;
    }
  }

  function clearAll(){
    lsRemove(STORAGE_KEY);
    lsRemove(OUTBOX_KEY);
    lsRemove(META_KEY);
    lsRemove(ONBOARDED_KEY);
    state.outbox = [];
    state.lastSaved = null;
    state.lastRestored = null;
    state.localBytes = 0;
    state.quotaExceeded = false;
  }

  // ---- Outbox: an append-only log of mutations ----
  function loadOutbox(){
    const raw = lsGet(OUTBOX_KEY);
    if(!raw) return [];
    try { return JSON.parse(raw) || []; } catch(e){ return []; }
  }
  function saveOutbox(){
    try { lsSet(OUTBOX_KEY, JSON.stringify(state.outbox)); } catch(e){}
  }

  // Look up the most likely entity id from a payload.
  function entityIdFrom(payload){
    if(!payload) return null;
    return payload.id || payload.sku || payload.patientId || payload.requestId || null;
  }

  // Append a mutation. type = 'patient.register' | 'request.create' | 'invoice.create' | etc.
  // payload should be just enough to reproduce the change.
  // entityId (optional) lets the UI tag a specific record as "pending sync"
  function record(type, payload, summary, entityId){
    const entry = {
      id: 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      type, payload, summary,
      entityId: entityId || entityIdFrom(payload),
      createdAt: new Date().toISOString(),
      status: state.online ? 'pending' : 'queued', // pending: ready to sync; queued: offline
      tenantId: (typeof S === 'function') ? S().activeTenantId : null,
      attempts: 0,
      syncedAt: null
    };
    state.outbox.push(entry);
    saveOutbox();
    schedulePersist();
    notifySubscribers();
    if(state.online) drainOutbox();
    return entry;
  }

  // Look up the sync state of a specific record. Returns 'synced' | 'pending' | 'queued' | 'syncing' | 'failed' | null.
  // Used by list views to show a small indicator next to recently-mutated rows.
  function statusOf(entityId){
    if(!entityId) return null;
    // Most recent op for this entity wins
    for(let i = state.outbox.length - 1; i >= 0; i--){
      const op = state.outbox[i];
      if(op.entityId === entityId) return op.status;
    }
    return null;
  }

  // Simulated sync: just mark items as synced after a brief delay.
  // In a real backend this would POST each operation to the server.
  let syncInFlight = false;
  function drainOutbox(){
    if(!state.online || syncInFlight) return;
    const pending = state.outbox.filter(e => e.status === 'pending' || e.status === 'queued');
    if(pending.length === 0) return;

    // Real-backend path: POST the whole pending batch to /sync. The server is
    // idempotent by (tenant, op.id), so retries are safe. On success we mark
    // the acknowledged ops synced; on network failure we leave them pending.
    if (typeof LabOSApi !== 'undefined' && LabOSApi.isEnabled() && LabOSApi.isAuthed()) {
      syncInFlight = true;
      state.syncing = true;
      notifySubscribers();
      const ops = pending.map(e => ({
        id: e.id, type: e.type, entityId: e.entityId, payload: e.payload, createdAt: e.createdAt
      }));
      LabOSApi.sync(ops)
        .then((r) => {
          if (r.ok && r.data && Array.isArray(r.data.results)) {
            const byId = {};
            for (const res of r.data.results) byId[res.id] = res;
            for (const e of pending) {
              const res = byId[e.id];
              if (res && (res.status === 'applied' || res.status === 'synced' || res.idempotent)) {
                e.status = 'synced';
                e.syncedAt = new Date().toISOString();
              } else if (res && res.status === 'rejected') {
                e.status = 'failed';
                e.lastError = res.reason || 'rejected by server';
              }
            }
          } else {
            // Non-2xx (e.g. auth) → mark failed for retry, don't lose data.
            for (const e of pending) { e.status = 'failed'; e.lastError = 'sync HTTP ' + r.status; }
          }
        })
        .catch(() => {
          // Network error → revert to pending so the next online beat retries.
          for (const e of pending) if (e.status === 'syncing') e.status = 'pending';
        })
        .finally(() => {
          syncInFlight = false;
          state.syncing = false;
          state.lastSyncedAt = new Date().toISOString();
          saveOutbox();
          notifySubscribers();
          if (typeof rerenderCurrentRoute === 'function') { try { rerenderCurrentRoute(); } catch(e){} }
        });
      return;
    }

    // ---- Mock path (no backend configured): simulated staggered sync ----
    syncInFlight = true;
    state.syncing = true;
    notifySubscribers();
    // Stagger sync of each item — simulated latency
    let i = 0;
    function next(){
      if(i >= pending.length){
        syncInFlight = false;
        state.syncing = false;
        state.lastSyncedAt = new Date().toISOString();
        saveOutbox();
        notifySubscribers();
        // Re-render the current route so per-record indicators clear
        if(typeof rerenderCurrentRoute === 'function'){
          try { rerenderCurrentRoute(); } catch(e){}
        }
        return;
      }
      const item = pending[i++];
      item.attempts++;
      item.status = 'syncing';
      notifySubscribers();
      setTimeout(()=>{
        // 95% success rate (simulated). On failure, mark for retry.
        if(Math.random() < 0.95){
          item.status = 'synced';
          item.syncedAt = new Date().toISOString();
        } else {
          item.status = 'failed';
          item.lastError = 'Simulated server error (5%); will retry';
        }
        saveOutbox();
        notifySubscribers();
        next();
      }, 280);
    }
    next();
  }

  function retryFailed(){
    for(const e of state.outbox){
      if(e.status === 'failed') e.status = 'pending';
    }
    saveOutbox();
    drainOutbox();
  }

  // ---- Online / offline tracking ----
  // We layer two signals:
  //   1. navigator.onLine (instant, but can be wrong — "true" with no real internet)
  //   2. periodic connectivity ping to a known endpoint (every 30s when status is uncertain)
  function updateOnlineStatus(){
    const wasOnline = state.online;
    state.online = !(typeof navigator !== 'undefined' && navigator.onLine === false);
    if(state.online !== wasOnline){
      notifySubscribers();
      if(state.online){
        // Just came online — try to drain
        if(typeof toast === 'function'){
          toast('Back online. Syncing pending changes...', {type:'success', title:'Connection restored'});
        }
        drainOutbox();
      } else {
        if(typeof toast === 'function'){
          toast('Working offline. Changes will sync when reconnected.', {type:'warn', title:'Offline mode', duration:6000});
        }
      }
    }
  }

  // Real connectivity check — pings a tiny endpoint. navigator.onLine can lie;
  // this catches "connected to wifi but no internet" cases.
  // Runs only periodically and only when the browser thinks we're online.
  async function pingConnectivity(){
    if(typeof navigator === 'undefined' || !navigator.onLine) return;
    if(typeof fetch === 'undefined') return;
    try {
      // Use HEAD against a cache-busting URL; any 200-range response counts as "online"
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = ctrl ? setTimeout(()=>ctrl.abort(), 4000) : null;
      const url = 'https://www.google.com/generate_204?_=' + Date.now();
      const res = await fetch(url, {method:'HEAD', mode:'no-cors', cache:'no-store', signal: ctrl ? ctrl.signal : undefined});
      if(timer) clearTimeout(timer);
      // no-cors gives opaque response (status 0) — but if no exception, we reached the network
      if(!state.online){ state.online = true; updateOnlineStatus(); }
    } catch(e){
      // Ping failed — we're effectively offline even if navigator.onLine says true
      if(state.online){
        state.online = false;
        notifySubscribers();
        if(typeof toast === 'function'){
          toast('Network reachable but server unreachable. Operating offline.', {type:'warn', title:'Connectivity limited', duration:6000});
        }
      }
    }
  }

  // ---- Subscribers (UI elements that show sync state) ----
  const subscribers = new Set();
  function subscribe(fn){ subscribers.add(fn); return () => subscribers.delete(fn); }
  function notifySubscribers(){
    for(const fn of subscribers){ try { fn(state); } catch(e){} }
  }

  // ---- Public state object ----
  const state = {
    online: !(typeof navigator !== 'undefined' && navigator.onLine === false),
    syncing: false,
    outbox: [],
    lastSaved: null,
    lastRestored: null,
    lastSavedAt: null,
    lastSyncedAt: null,
    localBytes: 0,
    quotaExceeded: false
  };

  // Estimate how many records are in localStorage (just for the UI). Cheap.
  function estimateUsage(){
    try {
      const raw = lsGet(STORAGE_KEY) || '';
      const raw2 = lsGet(OUTBOX_KEY) || '';
      // 5MB is the typical localStorage quota in browsers
      return {bytes: raw.length + raw2.length, percent: Math.min(100, ((raw.length + raw2.length) / (5 * 1024 * 1024)) * 100)};
    } catch(e){ return {bytes: 0, percent: 0}; }
  }

  function init(){
    state.outbox = loadOutbox();
    const restored = restore();
    // Wire native online/offline events
    if(typeof window !== 'undefined' && window.addEventListener){
      window.addEventListener('online',  updateOnlineStatus);
      window.addEventListener('offline', updateOnlineStatus);
    }
    // Poll navigator.onLine every minute (some browsers under-trigger the events)
    setInterval(updateOnlineStatus, 60000);
    // Real connectivity ping every 90 seconds — catches "wifi on, no internet"
    setInterval(pingConnectivity, 90000);
    // Initial drain attempt
    if(state.online && state.outbox.some(e => e.status !== 'synced')){
      setTimeout(drainOutbox, 800);
    }
    return restored;
  }

  return {
    init, record, schedulePersist, drainOutbox, retryFailed, clearAll,
    subscribe, statusOf, pingConnectivity, estimateUsage, SCHEMA_VERSION,
    get state(){ return state; },
    get pendingCount(){ return state.outbox.filter(e => e.status !== 'synced').length; },
    get totalCount(){ return state.outbox.length; },
    get failedCount(){ return state.outbox.filter(e => e.status === 'failed').length; },
    get syncedCount(){ return state.outbox.filter(e => e.status === 'synced').length; }
  };
})();

/* ==========================================================
   LICENSE ENFORCEMENT
   ==========================================================
   This module is the client-side half of license enforcement. It is designed
   so that swapping the simulated server calls below for real HTTPS calls to
   your backend is a mechanical change — the verification logic, grace mode,
   lockout, device binding, and UI surfaces all stay the same.

   The server contract this client expects:

   POST /licence/register-device
     body: { tenantId, deviceFingerprint, installInfo }
     200:  { device: { id, registeredAt, lastSyncAt }, licence: <signed token> }
     409:  { error: 'device_cap_reached', maxDevices, currentDevices }

   POST /licence/heartbeat
     body: { tenantId, deviceId, signature }
     200:  { licence: <signed token>, devices: [...] }
     401:  { error: 'licence_revoked' | 'device_deregistered' }

   POST /licence/deregister-device  (admin auth required)
     body: { tenantId, deviceId }
     200:  { ok: true }

   The signed licence token shape:
     { tenantId, legalName, plan, entitlements, validFrom, validUntil,
       maxDevices, maxUsers, issuedAt, nonce, sig }
   `sig` is an HMAC-SHA256 of the canonical JSON of all other fields, using
   a secret known only to the server. In the prototype we use a fixed demo
   secret so signing+verifying both work; in production the device only
   *verifies* (the server signs).

   Misuse paths this defends against (in the prototype, against casual edits;
   in production, against real attackers with the server backing it up):

   1. Copying the install to another device  → new fingerprint → registers
      as a new device → eventually hits maxDevices cap → refused.
   2. Editing licence in localStorage         → HMAC won't verify → lockout.
   3. Past validUntil                          → fails check → grace then lockout.
   4. Renaming the tenant to resell            → legal name is in the signed
      licence, can't be edited locally without invalidating the signature.
   5. Reaching cap and re-installing           → server tracks all devices;
      admin must deregister an existing one first.

   What this module does NOT defend against (and what only the real backend can):
   - A determined attacker who decompiles the JS and replaces the verifier
     (you need code obfuscation + native wrapper to mitigate this, out of scope)
   - Shared logins across two physical sites (you need per-user session
     tracking on the server, which is a separate concern)
   - Time-travel attacks via system clock (the heartbeat compares server time
     to client time and flags drift > 24h)
*/
