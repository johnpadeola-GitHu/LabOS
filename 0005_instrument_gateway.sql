/* ============================================================
   LabOS — Supabase adapter (classic script, not ES module)
   Loaded as part of labos.bundle.js — always available when
   the app boots. No async module race condition.

   Initialises when window.LABOS_CONFIG has real credentials.
   Falls back to demo/mock mode when credentials are absent.
   ============================================================ */
(function () {
  const cfg = window.LABOS_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return; // demo mode

  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
  let client  = null;
  let loading = false;
  let queue   = []; // callbacks waiting for client

  // Load supabase-js UMD build via a <script> tag (works in classic scripts).
  function loadSDK(cb) {
    if (client)   { cb(client); return; }
    if (loading)  { queue.push(cb); return; }
    loading = true;
    queue.push(cb);
    const s = document.createElement('script');
    s.src = SUPABASE_CDN;
    s.onload = function () {
      try {
        const createClient = window.supabase
          ? window.supabase.createClient
          : (window.Supabase ? window.Supabase.createClient : null);
        if (!createClient) throw new Error('supabase.createClient not found after SDK load');
        client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true }
        });
        // Store tenant id for subsequent calls
        cfg.tenantId = cfg.tenantId || null;
        queue.forEach(function (fn) { try { fn(client); } catch (e) {} });
        queue = [];
      } catch (e) {
        console.warn('[LabOS] Supabase init failed:', e.message);
        queue.forEach(function (fn) { try { fn(null); } catch (_) {} });
        queue = [];
      }
    };
    s.onerror = function () {
      console.warn('[LabOS] Failed to load Supabase SDK from CDN');
      queue.forEach(function (fn) { try { fn(null); } catch (_) {} });
      queue = [];
      loading = false;
    };
    document.head.appendChild(s);
  }

  // Promisified helper
  function sb() {
    return new Promise(function (resolve) { loadSDK(resolve); });
  }

  // Map helpers
  function mapPatient(r) {
    return r && { id:r.id, hospitalNumber:r.hospital_number, name:r.name, dob:r.dob,
      gender:r.gender, phone:r.phone, email:r.email, address:r.address,
      bloodGroup:r.blood_group, referringDoctor:r.referring_doctor };
  }
  function mapRequest(r) {
    return r && { id:r.id, displayId:r.display_id, patientId:r.patient_id,
      tests:r.tests||[], status:r.status, priority:r.priority,
      requestedBy:r.requested_by, requestedAt:r.created_at };
  }
  function mapResult(r) {
    return r && { id:r.id, requestId:r.request_id, test:r.test_name, code:r.test_code,
      value:r.value, unit:r.unit, refRange:r.ref_range, flag:r.flag, status:r.status };
  }
  function wrap(res, mapper) {
    if (res.error) return { ok:false, status:res.status||400, data:{ error:res.error.message } };
    var d = Array.isArray(res.data) && mapper ? res.data.map(mapper)
           : (mapper && res.data ? mapper(res.data) : res.data);
    return { ok:true, status:200, data:d };
  }

  var Api = {
    isEnabled: function () { return true; },
    apiBase:   function () { return cfg.supabaseUrl; },

    login: async function (email, password) {
      var c = await sb();
      if (!c) return { ok:false, error:'Could not connect to backend.' };
      var r = await c.auth.signInWithPassword({ email:email, password:password });
      if (r.error) return { ok:false, error:r.error.message };
      var prof = await c.from('app_users').select('*').eq('id', r.data.user.id).single();
      if (prof.data && prof.data.tenant_id) cfg.tenantId = prof.data.tenant_id;
      return { ok:true, user:r.data.user, profile:prof.data };
    },

    logout: async function () {
      var c = await sb();
      if (c) await c.auth.signOut();
    },

    isAuthed: async function () {
      var c = await sb();
      if (!c) return false;
      var r = await c.auth.getSession();
      return !!(r.data && r.data.session);
    },

    validateActivation: async function (code, email, password) {
      var c = await sb();
      if (!c) return { ok:false, error:'Could not connect to backend.' };
      var r = await c.functions.invoke('activate', { body:{ code:code, email:email, password:password } });
      if (r.error) return { ok:false, error:'activation_error' };
      if (!r.data || !r.data.ok) return { ok:false, error:(r.data&&r.data.error)||'activation_failed' };
      if (r.data.session) {
        await c.auth.setSession({ access_token:r.data.session.access_token, refresh_token:r.data.session.refresh_token });
        cfg.tenantId = r.data.tenant.id;
      }
      return { ok:true, tenant:r.data.tenant, user:r.data.user };
    },

    listPatients: async function (params) {
      var c = await sb(); if (!c) return { ok:false };
      var q = c.from('patients').select('*').order('created_at', { ascending:false });
      if (params && params.search) q = q.ilike('name', '%'+params.search+'%');
      if (params && params.limit)  q = q.limit(params.limit);
      return wrap(await q, mapPatient);
    },

    createPatient: async function (p) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.from('patients').insert({
        tenant_id:cfg.tenantId, name:p.name, dob:p.dob, gender:p.gender,
        phone:p.phone, email:p.email, address:p.address,
        hospital_number:p.hospitalNumber, blood_group:p.bloodGroup,
        referring_doctor:p.referringDoctor
      }).select().single(), mapPatient);
    },

    listRequests: async function (params) {
      var c = await sb(); if (!c) return { ok:false };
      var q = c.from('test_requests').select('*').order('created_at', { ascending:false });
      if (params && params.status)    q = q.eq('status', params.status);
      if (params && params.patientId) q = q.eq('patient_id', params.patientId);
      return wrap(await q, mapRequest);
    },

    getRequest: async function (id) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.from('test_requests').select('*').eq('id', id).single(), mapRequest);
    },

    createRequest: async function (r) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.from('test_requests').insert({
        tenant_id:cfg.tenantId, patient_id:r.patientId, display_id:r.displayId,
        tests:r.tests||[], priority:r.priority||'routine', requested_by:r.requestedBy
      }).select().single(), mapRequest);
    },

    advanceRequest: async function (id, status) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.from('test_requests').update({ status:status }).eq('id', id).select().single(), mapRequest);
    },

    listResults: async function (requestId) {
      var c = await sb(); if (!c) return { ok:false };
      var q = c.from('results').select('*');
      if (requestId) q = q.eq('request_id', requestId);
      return wrap(await q, mapResult);
    },

    enterResult: async function (payload) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.from('results').insert({
        tenant_id:cfg.tenantId, request_id:payload.requestId,
        test_code:payload.code, test_name:payload.test, value:payload.value,
        unit:payload.unit, ref_range:payload.refRange, flag:payload.flag
      }).select().single(), mapResult);
    },

    validateResultRow: async function (id) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.rpc('validate_result', { p_result_id:id }), mapResult);
    },

    releaseResultRow: async function (id) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.rpc('release_result', { p_result_id:id }), mapResult);
    },

    referralResults: async function () {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.rpc('referral_results'), null);
    },

    logQcRun: async function (run) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.from('qc_runs').insert({
        tenant_id:cfg.tenantId, analyte:run.analyte, result:run.result,
        z_score:run.z, operator:run.operator, accepted:run.accepted
      }).select().single(), null);
    },

    submitDsar: async function (d) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.from('dsar_requests').insert({
        tenant_id:cfg.tenantId, type:d.type, patient_id:d.patientId,
        notes:d.notes, due_at:new Date(Date.now()+30*864e5).toISOString()
      }).select().single(), null);
    },

    exportPatientData: async function (patientId) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.rpc('export_patient_data', { p_patient_id:patientId }), null);
    },

    writeAudit: async function (action, payload) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.rpc('write_audit', { p_action:action, p_payload:payload||{} }), null);
    },

    createInvoice: async function (inv) {
      var c = await sb(); if (!c) return { ok:false };
      return wrap(await c.from('invoices').insert({
        tenant_id:cfg.tenantId, patient_id:inv.patientId, display_id:inv.id,
        amount:inv.amount, paid:inv.paid, balance:inv.balance, method:inv.method,
        hmo:inv.hmo, policy:inv.policy, line_items:inv.lineItems||[], status:inv.status
      }).select().single(), null);
    },

    sync: async function (ops) {
      var results = [];
      for (var i = 0; i < (ops||[]).length; i++) {
        var op = ops[i];
        try {
          var r = { ok:true };
          if      (op.type==='patient.create') r = await this.createPatient(op.payload);
          else if (op.type==='request.create') r = await this.createRequest(op.payload);
          else if (op.type==='result.enter')   r = await this.enterResult(op.payload);
          else if (op.type==='invoice.create') r = await this.createInvoice(op.payload);
          results.push({ id:op.id, ok:r.ok });
        } catch(e) {
          results.push({ id:op.id, ok:false, error:String(e) });
        }
      }
      return { ok:true, status:200, data:{ results:results } };
    },

    raw: async function () { return sb(); }
  };

  // Override the mock LabOSApi immediately
  window.LabOSApi = Object.assign(window.LabOSApi || {}, Api);

  // Expose init for external use
  window.LabOSSupabase = {
    init: function () { return sb(); },
    client: function () { return client; }
  };

  // Start loading the SDK in the background so it's ready when needed
  loadSDK(function () {});
})();
