/* ============================================================
   LabOS — Session, i18n, and Compliance utilities
   Loaded after bootstrap; shares the ordered-script global scope.
   ============================================================ */

/* ── Internationalisation (i18n) ─────────────────────────────────
   Framework stub: key → translated string lookup.
   Add languages by extending window.LANG_STRINGS.
   Call L('key') anywhere in the UI.
   ────────────────────────────────────────────────────────────── */
window.CURRENT_LANG = localStorage.getItem('labos_lang') || 'en';

window.LANG_STRINGS = {
  en: {
    'app.name': 'LabOS',
    'nav.patients': 'Patients',
    'nav.requests': 'Clinical Laboratory',
    'nav.appointments': 'Appointments',
    'nav.billing': 'Billing & Invoicing',
    'nav.inventory': 'Inventory & Consumables',
    'nav.notifications': 'Notifications',
    'nav.qc': 'Quality Control',
    'nav.help': 'Help & Documentation',
    'action.save': 'Save',
    'action.cancel': 'Cancel',
    'action.submit': 'Submit',
    'action.register': 'Register',
    'action.close': 'Close',
    'label.patient': 'Patient',
    'label.date': 'Date',
    'label.status': 'Status',
    'label.required': 'Required',
    'session.expiring': 'Your session will expire in 5 minutes due to inactivity.',
    'session.expired': 'Your session has expired. Please sign in again.',
    'session.continue': 'Stay signed in',
    'session.logout': 'Sign out now',
    'error.generic': 'Something went wrong. Our team has been notified.',
    'error.offline': 'You are offline. Changes will sync when reconnected.',
    'ndpr.title': 'Privacy & Data Rights',
    'ndpr.subtitle': 'Your rights under the Nigerian Data Protection Regulation (NDPR)',
  },
  ha: { // Hausa — priority language for northern Nigeria
    'app.name': 'LabOS',
    'nav.patients': 'Marasa',
    'nav.requests': 'Dakin Gwaje-Gwaje',
    'nav.appointments': 'Alƙawura',
    'nav.billing': 'Biyan Kuɗi',
    'nav.inventory': 'Kayan Aiki',
    'nav.notifications': 'Sanarwa',
    'nav.qc': 'Ingancin Gwaje-Gwaje',
    'nav.help': 'Taimako',
    'action.save': 'Ajiye',
    'action.cancel': 'Soke',
    'action.submit': 'Aika',
    'action.register': 'Yi Rijista',
    'action.close': 'Rufe',
    'label.patient': 'Marasa',
    'label.date': 'Kwanan Wata',
    'label.status': 'Yanayi',
    'label.required': 'Ana Bukata',
    'session.expiring': 'Zaman ku zai ƙare a cikin minti 5 saboda rashin aiki.',
    'session.expired': 'Zaman ku ya ƙare. Da fatan za ku shiga da sabon bayani.',
    'session.continue': 'Ci gaba da zaman',
    'session.logout': 'Fita yanzu',
    'error.generic': 'Wani abu ya ɓaci. An sanar da ƙungiyar mu.',
    'error.offline': 'Ba ku da haɗi. Canje-canje za su haɗa da aka sake haɗa.',
    'ndpr.title': 'Sirri da Haƙƙoƙin Bayanan ku',
    'ndpr.subtitle': 'Haƙƙoƙin ku ƙarƙashin NDPR',
  },
  yo: { // Yoruba
    'app.name': 'LabOS',
    'nav.patients': 'Awọn Alaisan',
    'nav.requests': 'Yara Idanwo',
    'nav.appointments': 'Awọn Ipinnu',
    'action.save': 'Fi pamọ',
    'action.cancel': 'Fagilee',
    'label.patient': 'Alaisan',
    'session.expiring': 'Igba rẹ yoo pari ni iṣẹju 5 nitori aainṣe.',
    'session.expired': 'Igba rẹ ti pari. Jọwọ wọle lẹẹkansi.',
    'session.continue': 'Tẹsiwaju ni wiwọle',
  },
  ig: { // Igbo
    'app.name': 'LabOS',
    'nav.patients': 'Ndị Ọrịa',
    'nav.requests': 'Ụlọ Nyocha',
    'action.save': 'Chekwaa',
    'action.cancel': 'Kagbuo',
    'label.patient': 'Onye Ọrịa',
    'session.expiring': 'Oge gị ga-akwụsị n\'ime nkeji 5 n\'ihi enweghị ọrụ.',
    'session.expired': 'Oge gị agwụla. Biko banye ọzọ.',
    'session.continue': 'Nọgide na-abanye',
  }
};

window.L = function(key) {
  const lang = window.CURRENT_LANG || 'en';
  const strings = window.LANG_STRINGS[lang] || window.LANG_STRINGS.en;
  return strings[key] || window.LANG_STRINGS.en[key] || key;
};

window.setLanguage = function(lang) {
  if(!window.LANG_STRINGS[lang]) return;
  window.CURRENT_LANG = lang;
  localStorage.setItem('labos_lang', lang);
  if(typeof renderShell === 'function') renderShell();
  if(typeof navigate === 'function' && window.APP_STATE && APP_STATE.currentRoute) {
    navigate(APP_STATE.currentRoute);
  }
};

/* ── Session management ──────────────────────────────────────────
   Idle timeout with a 5-minute warning dialog.
   IDLE_TIMEOUT_MS: time before warning (default 25 min)
   WARN_DURATION_MS: warning window before forced logout (5 min)
   ────────────────────────────────────────────────────────────── */
window.SESSION = (function(){
  const IDLE_TIMEOUT_MS  = 25 * 60 * 1000;   // 25 min idle → show warning
  const WARN_DURATION_MS =  5 * 60 * 1000;    // 5 min to respond before forced logout
  const ACTIVITY_EVENTS  = ['mousedown','mousemove','keydown','touchstart','scroll'];

  let idleTimer  = null;
  let warnTimer  = null;
  let warnShown  = false;
  let started    = false;
  let lastActive = Date.now();

  function reset() {
    lastActive = Date.now();
    if(warnShown) dismissWarning();
    clearTimeout(idleTimer);
    clearTimeout(warnTimer);
    idleTimer = setTimeout(showWarning, IDLE_TIMEOUT_MS);
  }

  function showWarning() {
    if(warnShown) return;
    warnShown = true;
    const mr = document.getElementById('modal-root');
    if(!mr) return;
    // Don't clobber an already-open modal that the user is interacting with
    // (check if there's real content in modal-root from a different modal)
    if(mr.innerHTML && !mr.innerHTML.includes('session-warn-modal')) {
      // Queue the warning — the user is active in a modal, give them the full 5 min
      warnTimer = setTimeout(forcedLogout, WARN_DURATION_MS);
      return;
    }
    mr.innerHTML = `
      <div class="modal-backdrop" style="backdrop-filter:blur(2px)"></div>
      <div class="modal session-warn-modal" style="max-width:440px" role="alertdialog" aria-modal="true" aria-labelledby="sw-title" aria-describedby="sw-desc">
        <div class="modal-header">
          <div><div id="sw-title" class="modal-title">Session expiring</div></div>
        </div>
        <div class="modal-body">
          <div class="alert-banner warn" style="margin-bottom:0">
            <span class="icon">⏱</span>
            <div id="sw-desc">
              <b>Your session will expire due to inactivity.</b>
              <div>You will be signed out in <span id="sw-countdown">5:00</span>.</div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" onclick="SESSION.logout()" id="sw-btn-logout">Sign out now</button>
          <button class="btn primary" onclick="SESSION.extend()" id="sw-btn-stay" autofocus>Stay signed in</button>
        </div>
      </div>`;
    // Countdown timer
    let remaining = Math.floor(WARN_DURATION_MS / 1000);
    const tick = setInterval(() => {
      remaining--;
      const el = document.getElementById('sw-countdown');
      if(!el){ clearInterval(tick); return; }
      const m = Math.floor(remaining / 60);
      const s = String(remaining % 60).padStart(2,'0');
      el.textContent = `${m}:${s}`;
      if(remaining <= 0) { clearInterval(tick); forcedLogout(); }
    }, 1000);
    window._swTick = tick;
    warnTimer = setTimeout(forcedLogout, WARN_DURATION_MS);
    // Focus the stay-signed-in button
    setTimeout(() => {
      const btn = document.getElementById('sw-btn-stay');
      if(btn) btn.focus();
    }, 50);
  }

  function dismissWarning() {
    warnShown = false;
    clearTimeout(warnTimer);
    clearInterval(window._swTick);
    const mr = document.getElementById('modal-root');
    if(mr && mr.querySelector('.session-warn-modal')) mr.innerHTML = '';
  }

  function forcedLogout() {
    clearTimeout(idleTimer);
    clearTimeout(warnTimer);
    clearInterval(window._swTick);
    const mr = document.getElementById('modal-root');
    if(mr) mr.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal" style="max-width:400px" role="alertdialog" aria-modal="true" aria-labelledby="sl-title">
        <div class="modal-body" style="text-align:center;padding:32px 24px">
          <div style="font-size:32px;margin-bottom:12px">🔒</div>
          <div id="sl-title" style="font-size:16px;font-weight:600;margin-bottom:8px">Session expired</div>
          <div class="muted-sm">You were signed out due to inactivity. Any unsaved work has been preserved in the outbox.</div>
          <button class="btn primary" style="margin-top:20px;width:100%" onclick="location.reload()">Sign in again</button>
        </div>
      </div>`;
    // In production this would call LabOSApi.logout() to invalidate the server session
    if(typeof LabOSApi !== 'undefined' && LabOSApi.logout) LabOSApi.logout();
    if(typeof OfflineCore !== 'undefined') OfflineCore.schedulePersist();
  }

  return {
    start() {
      if(started) return;
      started = true;
      ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, reset, { passive:true }));
      reset();
    },
    stop() {
      started = false;
      ACTIVITY_EVENTS.forEach(ev => document.removeEventListener(ev, reset));
      clearTimeout(idleTimer);
      clearTimeout(warnTimer);
    },
    extend() { reset(); if(typeof toast === 'function') toast('Session extended.', {type:'success', duration:2500}); },
    logout()  { forcedLogout(); },
    get lastActive() { return lastActive; },
    get isActive()   { return started; }
  };
})();

/* ── Global error boundary ───────────────────────────────────────
   Catches unhandled JS errors and surface them as toasts + an
   in-page error log. In production, forward to Sentry.
   ────────────────────────────────────────────────────────────── */
window.ERROR_LOG = [];

window.addEventListener('error', function(evt) {
  const entry = {
    ts:   new Date().toISOString(),
    msg:  evt.message || String(evt.error),
    file: evt.filename || '',
    line: evt.lineno || 0,
    col:  evt.colno  || 0,
    stack: (evt.error && evt.error.stack) ? evt.error.stack.slice(0, 500) : ''
  };
  window.ERROR_LOG.push(entry);
  if(window.ERROR_LOG.length > 50) window.ERROR_LOG.shift();

  // Forward to Sentry if configured
  if(typeof Sentry !== 'undefined') try { Sentry.captureException(evt.error || new Error(entry.msg)); } catch(_) {}

  // Show a non-intrusive toast for runtime errors
  if(typeof toast === 'function' && !entry.msg.includes('Script error')) {
    toast(
      `An unexpected error occurred. ${entry.msg.slice(0, 80)}`,
      { type:'error', title:'Application error', duration:6000 }
    );
  }
  try { console.error('[LabOS error]', entry); } catch(_) {}
});

window.addEventListener('unhandledrejection', function(evt) {
  const reason = evt.reason;
  const msg = reason ? (reason.message || String(reason)) : 'Unhandled promise rejection';

  // Suppress noisy browser internals that are not real application bugs.
  const SUPPRESS = [
    'console.info is not a function',
    'console.log is not a function',
    'console.debug is not a function',
    'Script error',
    'ResizeObserver loop',
    'ServiceWorker',
    'Failed to fetch',
    'NetworkError',
    'AbortError'
  ];
  if(SUPPRESS.some(s => msg.includes(s))) return;

  window.ERROR_LOG = window.ERROR_LOG || [];
  window.ERROR_LOG.push({ ts: new Date().toISOString(), msg, stack: '' });
  if(window.ERROR_LOG.length > 50) window.ERROR_LOG.shift();

  if(typeof Sentry !== 'undefined') try { Sentry.captureException(reason); } catch(_) {}

  // Guard: console may not exist in every execution context (e.g. SW scope).
  try { console.error('[LabOS unhandledrejection]', msg); } catch(_) {}
});

/* ── NDPR / Data subject rights utilities ────────────────────────
   Helpers for data subject access requests (DSAR), deletion
   requests, and the on-screen privacy centre.
   ────────────────────────────────────────────────────────────── */
window.NDPR = {
  // Log a data subject access/deletion request
  submitDsar(type, patientId, notes) {
    const requests = window.APP_STATE && APP_STATE.dsarRequests
      ? APP_STATE.dsarRequests
      : (window.APP_STATE ? (APP_STATE.dsarRequests = []) : []);
    const id = `DSAR-${new Date().getFullYear()}-${String(requests.length + 1).padStart(4,'0')}`;
    const record = {
      id, type,           // 'access' | 'correction' | 'deletion' | 'portability' | 'restriction'
      patientId, notes,
      submittedAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30-day statutory deadline
      status: 'received',
      completedAt: null
    };
    requests.unshift(record);
    if(typeof OfflineCore !== 'undefined') OfflineCore.schedulePersist();
    return record;
  },

  // Produce a data export payload for a patient (portable JSON)
  exportPatientData(patientId) {
    if(!window.APP_STATE) return null;
    const patient     = (APP_STATE.patients||[]).find(p => p.id === patientId);
    const requests    = (APP_STATE.requests||[]).filter(r => r.patientId === patientId);
    const results     = Object.entries(APP_STATE.labResults||{})
                          .filter(([k]) => requests.find(r => r.id === k))
                          .map(([k,v]) => ({ requestId:k, ...v }));
    const vitals      = (APP_STATE.vitalsHistory||[]).filter(v => v.patientId === patientId);
    const invoices    = (APP_STATE.invoices||[]).filter(i => i.patientId === patientId);
    const appointments= (APP_STATE.appointments||[]).filter(a => a.patientId === patientId);
    return { exportedAt: new Date().toISOString(), patient, requests, results, vitals, invoices, appointments };
  },

  // Delete a patient's data (soft-delete — marks records for backend sweep)
  // Real deletion must be server-side to be enforceable
  markForDeletion(patientId, requestId) {
    if(!window.APP_STATE) return;
    const patient = (APP_STATE.patients||[]).find(p => p.id === patientId);
    if(patient) { patient._deletionRequested = true; patient._dsarId = requestId; }
    const dsar = (APP_STATE.dsarRequests||[]).find(d => d.id === requestId);
    if(dsar) { dsar.status = 'pending_deletion'; }
    if(typeof OfflineCore !== 'undefined') OfflineCore.schedulePersist();
  }
};
