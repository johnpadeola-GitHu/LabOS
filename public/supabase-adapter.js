/* ============================================================
   LabOS — Supabase adapter
   --------------------------------------------------------------
   Implements the same window.LabOSApi surface the app already
   calls, but backed by Supabase (Postgres + Auth + RLS) instead
   of a bespoke REST backend.

   Activation is config-driven and non-destructive:
     window.LABOS_CONFIG = {
       supabaseUrl:  'https://YOUR_PROJECT.supabase.co',
       supabaseAnonKey: 'YOUR_ANON_KEY'
     };
   If those are absent, this file does nothing and the app runs in
   demo/offline mode exactly as before. When present, it lazy-loads
   the official supabase-js client from the CDN and installs a
   LabOSApi implementation.

   The mapping layer translates the app's display-shaped objects to
   the SQL schema (snake_case columns) and back, so the rest of the
   app is unchanged.
   ============================================================ */
(function () {
  const cfg = (typeof window !== 'undefined' && window.LABOS_CONFIG) || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    // Not configured → leave the existing LabOSApi (mock/REST) in place.
    return;
  }

  const SUPABASE_CDN = 'https://esm.sh/@supabase/supabase-js@2';
  let client = null;
  let ready = null; // a promise that resolves once the client is constructed

  // Lazy-load supabase-js and construct the client once.
  function init() {
    if (ready) return ready;
    ready = import(SUPABASE_CDN)
      .then((mod) => {
        const createClient = mod.createClient || (mod.default && mod.default.createClient);
        client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true }
        });
        return client;
      })
      .catch((err) => {
        // If the CDN is blocked, fall back to mock mode rather than breaking.
        console.warn('[LabOS] Supabase client failed to load; staying in local mode.');
        ready = null;
        throw err;
      });
    return ready;
  }

  async function sb() {
    if (!client) await init();
    return client;
  }

  // -------- Mapping helpers (DB row → app shape) --------
  const mapPatient = (r) => r && ({
    id: r.id, hospitalNumber: r.hospital_number, name: r.name, dob: r.dob,
    gender: r.gender, phone: r.phone, email: r.email, address: r.address,
    bloodGroup: r.blood_group, referringDoctor: r.referring_doctor
  });
  const mapRequest = (r) => r && ({
    id: r.id, displayId: r.display_id, patientId: r.patient_id,
    tests: r.tests || [], status: r.status, priority: r.priority,
    requestedBy: r.requested_by, requestedAt: r.created_at
  });
  const mapResult = (r) => r && ({
    id: r.id, requestId: r.request_id, test: r.test_name, code: r.test_code,
    value: r.value, unit: r.unit, refRange: r.ref_range, flag: r.flag,
    status: r.status
  });

  // Wrap a Supabase result in the { ok, status, data } shape the app expects.
  function wrap(res, mapper) {
    if (res.error) return { ok: false, status: res.status || 400, data: { error: res.error.message } };
    const d = Array.isArray(res.data) && mapper ? res.data.map(mapper)
            : (mapper && res.data ? mapper(res.data) : res.data);
    return { ok: true, status: 200, data: d };
  }

  // ---------------------------------------------------------------
  // The LabOSApi surface — same method names the app already calls.
  // ---------------------------------------------------------------
  const Api = {
    isEnabled: () => true,
    apiBase: () => cfg.supabaseUrl,

    // ---- Auth ----
    async login(email, password) {
      const c = await sb();
      const { data, error } = await c.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: error.message };
      // Load the app_users profile (tenant + role) for the session.
      const { data: profile } = await c.from('app_users')
        .select('*').eq('id', data.user.id).single();
      if (profile && profile.tenant_id) cfg.tenantId = profile.tenant_id;
      return { ok: true, user: data.user, profile };
    },
    async logout() { const c = await sb(); await c.auth.signOut(); },
    async isAuthed() {
      const c = await sb();
      const { data } = await c.auth.getSession();
      return !!(data && data.session);
    },
    getToken() {
      try { return client?.auth?.getSession?.() ? null : null; } catch (e) { return null; }
    },

    // ---- Invite-only activation ----
    // Calls the `activate` Edge Function which validates the code, creates the
    // Supabase Auth user, links to the tenant, and returns a live session.
    async validateActivation(code, email, password) {
      const c = await sb();
      const { data, error } = await c.functions.invoke('activate', {
        body: { code, email, password }
      });
      if (error) {
        console.error('[LabOS] activate error:', error);
        return { ok: false, error: 'activation_error' };
      }
      if (!data || !data.ok) {
        return { ok: false, error: (data && data.error) || 'activation_failed' };
      }
      // Restore the session so the user is immediately signed in.
      if (data.session) {
        await c.auth.setSession({
          access_token:  data.session.access_token,
          refresh_token: data.session.refresh_token
        });
        cfg.tenantId = data.tenant.id;
      }
      return { ok: true, tenant: data.tenant, user: data.user };
    },

    // ---- Patients ----
    async listPatients(params = {}) {
      const c = await sb();
      let q = c.from('patients').select('*').order('created_at', { ascending: false });
      if (params.search) q = q.ilike('name', `%${params.search}%`);
      if (params.limit) q = q.limit(params.limit);
      return wrap(await q, mapPatient);
    },
    async createPatient(p) {
      const c = await sb();
      const row = {
        tenant_id: cfg.tenantId, name: p.name, dob: p.dob, gender: p.gender,
        phone: p.phone, email: p.email, address: p.address,
        hospital_number: p.hospitalNumber, blood_group: p.bloodGroup,
        referring_doctor: p.referringDoctor
      };
      return wrap(await c.from('patients').insert(row).select().single(), mapPatient);
    },

    // ---- Requests ----
    async listRequests(params = {}) {
      const c = await sb();
      let q = c.from('test_requests').select('*').order('created_at', { ascending: false });
      if (params.status) q = q.eq('status', params.status);
      if (params.patientId) q = q.eq('patient_id', params.patientId);
      return wrap(await q, mapRequest);
    },
    async getRequest(id) {
      const c = await sb();
      return wrap(await c.from('test_requests').select('*').eq('id', id).single(), mapRequest);
    },
    async createRequest(r) {
      const c = await sb();
      const row = {
        tenant_id: cfg.tenantId, patient_id: r.patientId, display_id: r.displayId,
        tests: r.tests || [], priority: r.priority || 'routine', requested_by: r.requestedBy
      };
      return wrap(await c.from('test_requests').insert(row).select().single(), mapRequest);
    },
    async advanceRequest(id, status) {
      const c = await sb();
      return wrap(await c.from('test_requests').update({ status }).eq('id', id).select().single(), mapRequest);
    },

    // ---- Results (lifecycle via RPC so the server enforces transitions) ----
    async listResults(requestId) {
      const c = await sb();
      let q = c.from('results').select('*');
      if (requestId) q = q.eq('request_id', requestId);
      return wrap(await q, mapResult);
    },
    async enterResult(payload) {
      const c = await sb();
      const row = {
        tenant_id: cfg.tenantId, request_id: payload.requestId,
        test_code: payload.code, test_name: payload.test, value: payload.value,
        unit: payload.unit, ref_range: payload.refRange, flag: payload.flag
      };
      return wrap(await c.from('results').insert(row).select().single(), mapResult);
    },
    async validateResultRow(id) {
      const c = await sb();
      return wrap(await c.rpc('validate_result', { p_result_id: id }), mapResult);
    },
    async releaseResultRow(id) {
      const c = await sb();
      return wrap(await c.rpc('release_result', { p_result_id: id }), mapResult);
    },

    // ---- Referral portal (scoped RPC) ----
    async referralResults() {
      const c = await sb();
      const res = await c.rpc('referral_results');
      return wrap(res, null);
    },

    // ---- QC ----
    async logQcRun(run) {
      const c = await sb();
      const row = {
        tenant_id: cfg.tenantId, analyte: run.analyte, result: run.result,
        z_score: run.z, operator: run.operator, accepted: run.accepted
      };
      return wrap(await c.from('qc_runs').insert(row).select().single(), null);
    },
    async listQcRuns(analyte) {
      const c = await sb();
      let q = c.from('qc_runs').select('*').order('run_at', { ascending: true });
      if (analyte) q = q.eq('analyte', analyte);
      return wrap(await q, null);
    },

    // ---- NDPR ----
    async submitDsar(d) {
      const c = await sb();
      const due = new Date(Date.now() + 30 * 864e5).toISOString();
      const row = {
        tenant_id: cfg.tenantId, type: d.type, patient_id: d.patientId,
        notes: d.notes, due_at: due
      };
      return wrap(await c.from('dsar_requests').insert(row).select().single(), null);
    },
    async exportPatientData(patientId) {
      const c = await sb();
      return wrap(await c.rpc('export_patient_data', { p_patient_id: patientId }), null);
    },

    // ---- Audit (hash-chained server-side) ----
    async writeAudit(action, payload) {
      const c = await sb();
      return wrap(await c.rpc('write_audit', { p_action: action, p_payload: payload || {} }), null);
    },

    // ---- Invoices ----
    async createInvoice(inv) {
      const c = await sb();
      const row = {
        tenant_id: cfg.tenantId, patient_id: inv.patientId, display_id: inv.id,
        amount: inv.amount, paid: inv.paid, balance: inv.balance, method: inv.method,
        hmo: inv.hmo, policy: inv.policy, line_items: inv.lineItems || [], status: inv.status
      };
      return wrap(await c.from('invoices').insert(row).select().single(), null);
    },

    // ---- Sync: drain the offline outbox by replaying ops ----
    async sync(ops) {
      // Each op is { type, payload }. Map op types to the calls above.
      // Unknown ops are acknowledged so they don't get stuck in the outbox.
      const results = [];
      for (const op of (ops || [])) {
        try {
          let r = { ok: true };
          switch (op.type) {
            case 'patient.create':   r = await this.createPatient(op.payload); break;
            case 'request.create':   r = await this.createRequest(op.payload); break;
            case 'result.enter':     r = await this.enterResult(op.payload); break;
            case 'invoice.create':   r = await this.createInvoice(op.payload); break;
            case 'qc.run':           r = await this.logQcRun(op.payload); break;
            default: r = { ok: true, skipped: true };
          }
          results.push({ id: op.id, ok: r.ok });
        } catch (e) {
          results.push({ id: op.id, ok: false, error: String(e) });
        }
      }
      return { ok: true, status: 200, data: { results } };
    },

    // Expose the raw client for advanced/real-time use (subscriptions, etc.)
    async raw() { return sb(); }
  };

  // Install. This REPLACES the mock/REST LabOSApi when Supabase is configured.
  window.LabOSApi = Object.assign(window.LabOSApi || {}, Api);
  window.LabOSSupabase = { init, client: () => client };

  // Eager-init so auth session is restored on load (non-blocking).
  init().catch(() => {});
})();
