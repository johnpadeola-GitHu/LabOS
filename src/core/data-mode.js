/* ============================================================
   LabOS — Core service layer (split into cohesive units during
   the module migration). Each unit is a self-contained singleton
   that shares the ordered-script global scope with the app layer,
   exactly as before — but now in its own reviewable file, which is
   the prerequisite for a later true-ESM cutover once app.views.js
   is itself split into modules.
   ============================================================ */

/* DataMode — demo/real data switching. */

const DataMode = (function(){
  // Keys whose seeded contents constitute the "demo" transactional bundle.
  // Switching to real mode resets these to empty; restoring demo brings them back.
  const DEMO_KEYS = [
    'patients','requests','samples','invoices','vitalsHistory',
    'imagingOrders','dnaOrders','packageOrders','microbiologyResults'
  ];

  // Snapshot the initial seed values BEFORE any user action runs.
  // We deep-clone via JSON to avoid sharing references.
  const DEMO_SNAPSHOT = {};
  for(const k of DEMO_KEYS){
    DEMO_SNAPSHOT[k] = JSON.parse(JSON.stringify(APP_STATE[k] || []));
  }

  function currentMode(){
    return APP_STATE.dataMode === 'real' ? 'real' : 'demo';
  }

  // Wipe the demo transactional data — only call after user confirmation.
  // Keeps catalogues, plans, tenants, pricing, session, currentRoute.
  function clearDemoData(){
    for(const k of DEMO_KEYS){
      APP_STATE[k] = [];
    }
    APP_STATE.dataMode = 'real';
    if(typeof OfflineCore !== 'undefined'){
      OfflineCore.schedulePersist();
      OfflineCore.record('data.mode', {to:'real'}, 'Switched to real data — demo cleared');
    }
  }

  // Bring back the original seeded data so demo mode resumes.
  // Any work done in real mode WILL be lost — caller must confirm.
  function restoreDemoData(){
    for(const k of DEMO_KEYS){
      APP_STATE[k] = JSON.parse(JSON.stringify(DEMO_SNAPSHOT[k]));
    }
    APP_STATE.dataMode = 'demo';
    if(typeof OfflineCore !== 'undefined'){
      OfflineCore.schedulePersist();
      OfflineCore.record('data.mode', {to:'demo'}, 'Restored demo data');
    }
  }

  // Aggregate counts of current transactional records for the panel
  function counts(){
    const c = {};
    for(const k of DEMO_KEYS){
      c[k] = (APP_STATE[k] || []).length;
    }
    c.total = Object.values(c).reduce((s,n)=>s+n, 0);
    return c;
  }

  return {
    DEMO_KEYS, currentMode, clearDemoData, restoreDemoData, counts,
    get isDemo(){ return currentMode() === 'demo'; },
    get isReal(){ return currentMode() === 'real'; }
  };
})();

/* ==========================================================
   OFFLINE-FIRST CORE
   ----------------------------------------------------------
   Three responsibilities:
   1. Persist APP_STATE to localStorage so reloads survive.
   2. Maintain an outbox of mutations; drain when back online.
   3. Track and broadcast online/offline status visibly.
   ========================================================== */
