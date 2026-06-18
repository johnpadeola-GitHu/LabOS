// ============================================================================
// LabOS — activate Edge Function
// POST /functions/v1/activate
//
// Body: { code: string, email: string, password: string, fullName?: string }
//
// Flow:
//   1. Validate the activation code (exists, unused, not expired)
//   2. Create the Supabase Auth user with the supplied email + password
//   3. Insert the app_users row linking the new user to the tenant
//   4. Mark the activation code as used
//   5. Sign the user in and return the session + tenant details
//
// Uses the SERVICE ROLE key (server-side only — never exposed to the browser).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code, email, password, fullName } = await req.json();

    // ── Input validation ──────────────────────────────────────────────────────
    if (!code || !email || !password) {
      return respond(400, { error: 'missing_fields', message: 'code, email and password are required' });
    }
    if (password.length < 12) {
      return respond(400, { error: 'weak_password', message: 'Password must be at least 12 characters' });
    }

    // ── Service-role client (bypasses RLS — safe because this is server-side) ─
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── 1. Validate the activation code ──────────────────────────────────────
    const normCode = String(code).trim().toUpperCase();
    const { data: codeRow, error: codeErr } = await supabase
      .from('activation_codes')
      .select('id, code, tenant_id, used_at, expires_at')
      .eq('code', normCode)
      .single();

    if (codeErr || !codeRow) {
      return respond(400, { error: 'invalid_code', message: 'Activation code not recognised' });
    }
    if (codeRow.used_at) {
      return respond(400, { error: 'code_already_used', message: 'This activation code has already been redeemed' });
    }
    if (new Date(codeRow.expires_at) < new Date()) {
      return respond(400, { error: 'code_expired', message: 'This activation code has expired — contact your LabOS administrator' });
    }

    // ── 2. Fetch the tenant ───────────────────────────────────────────────────
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, name, trading_name, plan, status')
      .eq('id', codeRow.tenant_id)
      .single();

    if (tenantErr || !tenant) {
      return respond(400, { error: 'tenant_not_found', message: 'Laboratory not found' });
    }
    if (!['active', 'trialing'].includes(tenant.status)) {
      return respond(400, { error: 'tenant_inactive', message: 'This laboratory account is not active — contact your LabOS administrator' });
    }

    // ── 3. Create the Supabase Auth user ──────────────────────────────────────
    const { data: authData, error: signUpErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,        // skip email confirmation — lab admin is invited by operator
      user_metadata: {
        full_name: fullName || email.split('@')[0],
        tenant_id: tenant.id,
        role: 'TENANT_ADMIN'
      }
    });

    if (signUpErr) {
      // Handle the case where the user already exists (e.g. retry after a
      // partial failure). In that case, link them to the tenant if not linked.
      if (signUpErr.message?.includes('already been registered')) {
        return respond(400, { error: 'email_taken', message: 'An account with this email already exists' });
      }
      console.error('createUser error:', signUpErr);
      return respond(500, { error: 'signup_failed', message: 'Could not create account — please try again' });
    }

    const newUser = authData.user;

    // ── 4. Insert app_users row ───────────────────────────────────────────────
    // The handle_new_user() trigger will have already created a basic row;
    // upsert to set the correct tenant, role, and name.
    const { error: appUserErr } = await supabase
      .from('app_users')
      .upsert({
        id: newUser.id,
        tenant_id: tenant.id,
        full_name: fullName || email.split('@')[0],
        role: 'TENANT_ADMIN',
        active: true,
        is_platform: false
      }, { onConflict: 'id' });

    if (appUserErr) {
      console.error('app_users upsert error:', appUserErr);
      // Non-fatal — the user exists, they can still log in
    }

    // ── 5. Mark the activation code as used ───────────────────────────────────
    await supabase
      .from('activation_codes')
      .update({ used_by: newUser.id, used_at: new Date().toISOString() })
      .eq('id', codeRow.id);

    // ── 6. Sign the user in and return a session ──────────────────────────────
    const { data: sessionData, error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInErr || !sessionData.session) {
      // Account created but sign-in failed — user can sign in manually
      return respond(200, {
        ok: true,
        tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan },
        session: null,
        message: 'Account created. Please sign in.'
      });
    }

    // ── 7. Write audit log entry ───────────────────────────────────────────────
    await supabase.from('audit_log').insert({
      tenant_id: tenant.id,
      actor_id: newUser.id,
      actor_name: fullName || email,
      action: 'tenant.activated',
      payload: { code: normCode, email, plan: tenant.plan }
    });

    return respond(200, {
      ok: true,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        tradingName: tenant.trading_name,
        plan: tenant.plan,
        status: tenant.status
      },
      session: {
        access_token:  sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_in:    sessionData.session.expires_in
      },
      user: {
        id:   newUser.id,
        email: newUser.email,
        role: 'TENANT_ADMIN',
        fullName: fullName || email.split('@')[0]
      }
    });

  } catch (err) {
    console.error('activate function error:', err);
    return respond(500, { error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
