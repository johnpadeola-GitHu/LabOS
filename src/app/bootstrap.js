/* ============================================================
   LabOS — Bootstrap & service-worker registration
   Auto-extracted from the prototype during the frontend
   restructure. Loaded as an ordered classic script; shares the
   global scope with the other layers (see vite.config.js notes).
   ============================================================ */

function bootApp(){
  // Initialise the offline core BEFORE the UI is rendered so any restored
  // state (patients added in a previous offline session, etc.) is in place.
  const restored = OfflineCore.init();

  // Update the connection badge live as state changes.
  OfflineCore.subscribe(renderConnectionBadge);

  // Initialise the licence enforcement layer. This:
  //   1. Loads the locally-cached signed licence + device registration
  //   2. Verifies the licence signature and expiry
  //   3. Schedules heartbeats every 6 hours
  //   4. Computes the grace state if the device has been offline too long
  // The result is reflected in LicenseCore.state.status: 'valid' | 'grace' |
  // 'lockout' | 'unregistered'.
  LicenseCore.init();

  // Device registration is deferred to an explicit entry decision. On a fresh
  // install we do NOT silently bind a licence to any tenant — that would let a
  // user reach a "valid" state without going through the invite-only gate.
  // Instead:
  //   • Activation success → completeOnboarding()/enterTenantMode() registers
  //     the device against the provisioned tenant.
  //   • "Explore demo" → onbExploreDemo()/enterTenantMode(realTenantId).
  //   • Returning session (state restored below) → re-register the cached tenant.
  // Only auto-register here when we are NOT about to show the gate, i.e. a prior
  // session is being restored.
  const hasRestoredSession = !!(restored && APP_STATE.session && APP_STATE.session.activeTenantId);
  if(LicenseCore.state.status === 'unregistered' && hasRestoredSession){
    const tenantId = APP_STATE.session.activeTenantId;
    LicenseCore.registerDevice(tenantId);
    // If registration fails (device cap reached, etc.), the badge will show
    // 'Not registered' and the overlay will appear.
  }

  // Keep the licence badge + overlay live as the status changes (heartbeats,
  // revocations, etc.)
  LicenseCore.subscribe(renderLicenceBadge);

  // Show the onboarding wizard, unless we restored state from a prior session
  // (in which case skip straight to the workspace so returning users don't
  // re-onboard on every page reload).
  if(restored && APP_STATE.session && APP_STATE.session.activeTenantId){
    // Returning session — go straight in
    document.getElementById('onboarding-root').innerHTML = '';
    document.getElementById('app').style.display = '';
    renderShell();
    // Validate the restored route — a persisted pointer to a route that no
    // longer exists (e.g. a removed module) should fall back silently to the
    // dashboard rather than warn.
    const savedRoute = APP_STATE.currentRoute;
    const startRoute = (savedRoute && typeof ROUTES !== 'undefined' && ROUTES[savedRoute]) ? savedRoute : 'dashboard';
    if(startRoute !== savedRoute) APP_STATE.currentRoute = 'dashboard';
    navigate(startRoute);
    renderConnectionBadge();
    renderLicenceBadge();
    // Start the idle-session watchdog only once inside a real tenant session.
    if(typeof SESSION !== 'undefined') SESSION.start();
    if(typeof toast === 'function'){
      const pending = OfflineCore.pendingCount;
      if(pending > 0){
        toast(`Welcome back. ${pending} pending change${pending===1?'':'s'} will sync now.`, {type:'info', duration:5000});
      } else {
        toast('Welcome back. Local state restored.', {type:'success', duration:3500});
      }
    }
  } else {
    startOnboarding();
    // Render the badges initially even on first run so they're visible
    setTimeout(()=>{ renderConnectionBadge(); renderLicenceBadge(); }, 100);
  }

  // Register an inline Service Worker for true app-shell caching.
  // This means the HTML, CSS, JS, fonts, and Chart.js library will be
  // available offline after the first successful load.
  registerInlineServiceWorker();

  // Render the demo-mode banner (hidden if user is in real-data mode)
  renderDataModeBanner();
}

/* ==========================================================
   INLINE SERVICE WORKER
   Caches the HTML page + external assets (fonts, Chart.js) so
   the app loads even with zero connectivity after first visit.
   The SW is built as a Blob URL so we stay single-file.
   ========================================================== */
function registerInlineServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  // SW must be served from same origin. Blob URLs satisfy this in modern browsers.
  // The SW code itself, as a string:
  const swCode = `
    const CACHE_NAME = 'labos-shell-v1';
    const PRECACHE_URLS = [
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
      'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
    ];

    self.addEventListener('install', (event) => {
      event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
          // Best-effort pre-cache; failures are non-fatal
          return Promise.allSettled(PRECACHE_URLS.map(u => cache.add(u).catch(() => {})));
        }).then(() => self.skipWaiting())
      );
    });

    self.addEventListener('activate', (event) => {
      event.waitUntil(
        caches.keys().then((names) => Promise.all(
          names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
        )).then(() => self.clients.claim())
      );
    });

    self.addEventListener('fetch', (event) => {
      const req = event.request;
      if(req.method !== 'GET') return;
      const url = new URL(req.url);
      // Skip non-http(s) (e.g. chrome-extension)
      if(!/^https?:/.test(url.protocol)) return;

      // Navigations (HTML): network-first, cache fallback
      if(req.mode === 'navigate' || req.destination === 'document'){
        event.respondWith(
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
            return res;
          }).catch(() => caches.match(req).then(r => r || caches.match('/')))
        );
        return;
      }

      // Fonts and external scripts: cache-first
      if(url.host === 'fonts.googleapis.com' ||
         url.host === 'fonts.gstatic.com' ||
         url.host === 'cdn.jsdelivr.net'){
        event.respondWith(
          caches.match(req).then(cached => cached || fetch(req).then(res => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
            return res;
          }).catch(() => cached))
        );
        return;
      }
      // Same-origin assets (anything else): cache-first
      if(url.origin === self.location.origin){
        event.respondWith(
          caches.match(req).then(cached => cached || fetch(req).then(res => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
            return res;
          }))
        );
      }
    });
  `;
  try {
    const blob = new Blob([swCode], {type: 'application/javascript'});
    const swUrl = URL.createObjectURL(blob);
    navigator.serviceWorker.register(swUrl).then(reg => {
      // SW registered. The first load will populate the cache.
      // Subsequent loads will work offline.
    }).catch(() => {
      // Some environments (file://, certain iframes) block SW registration.
      // The app still works; only the app-shell caching benefit is lost.
      // Intentionally silent — do not call console.* here as it may not
      // exist in all execution contexts and would create a secondary error.
    });
  } catch(e){
    // Blob/URL.createObjectURL not available — skip silently
  }
}


bootApp();
