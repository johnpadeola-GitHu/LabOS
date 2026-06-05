-- ============================================================================
-- LabOS — Row-Level Security policies (migration 0002)
--
-- This is the security boundary. Every tenant-scoped table denies all access
-- by default once RLS is enabled, then grants narrowly:
--   * a row is visible only if its tenant_id matches the caller's tenant
--     (or the caller is a platform super-admin);
--   * writes additionally require the matching RBAC permission via
--     has_permission(), mirroring src/core/rbac.js.
--
-- Without these policies a bug in any query could leak another lab's patient
-- data. With them, the database itself refuses cross-tenant access.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enable RLS on every tenant-scoped table
-- ----------------------------------------------------------------------------
alter table tenants        enable row level security;
alter table centres        enable row level security;
alter table app_users      enable row level security;
alter table patients       enable row level security;
alter table test_requests  enable row level security;
alter table samples        enable row level security;
alter table results        enable row level security;
alter table invoices       enable row level security;
alter table appointments   enable row level security;
alter table vitals         enable row level security;
alter table qc_runs        enable row level security;
alter table dsar_requests  enable row level security;
alter table audit_log      enable row level security;
alter table devices        enable row level security;

-- ----------------------------------------------------------------------------
-- tenants — a user sees only their own tenant; platform admins see all
-- ----------------------------------------------------------------------------
drop policy if exists tenants_select on tenants;
create policy tenants_select on tenants for select
  using (id = current_tenant_id() or is_platform_admin());

drop policy if exists tenants_update on tenants;
create policy tenants_update on tenants for update
  using ((id = current_tenant_id() and has_permission('settings.manage')) or is_platform_admin());

drop policy if exists tenants_insert on tenants;
create policy tenants_insert on tenants for insert
  with check (is_platform_admin());

-- ----------------------------------------------------------------------------
-- centres
-- ----------------------------------------------------------------------------
drop policy if exists centres_all on centres;
create policy centres_all on centres for all
  using (tenant_id = current_tenant_id() or is_platform_admin())
  with check (tenant_id = current_tenant_id() and has_permission('settings.manage'));

-- ----------------------------------------------------------------------------
-- app_users — users see colleagues in their tenant; only admins manage them
-- ----------------------------------------------------------------------------
drop policy if exists app_users_select on app_users;
create policy app_users_select on app_users for select
  using (tenant_id = current_tenant_id() or id = auth.uid() or is_platform_admin());

drop policy if exists app_users_write on app_users;
create policy app_users_write on app_users for all
  using ((tenant_id = current_tenant_id() and has_permission('staff.manage')) or is_platform_admin())
  with check ((tenant_id = current_tenant_id() and has_permission('staff.manage')) or is_platform_admin());

-- ----------------------------------------------------------------------------
-- Generic pattern for clinical tables:
--   SELECT  : same tenant (read perm implied by tenancy)
--   INSERT/UPDATE/DELETE : same tenant AND the relevant RBAC permission
-- ----------------------------------------------------------------------------

-- patients
drop policy if exists patients_select on patients;
create policy patients_select on patients for select
  using (tenant_id = current_tenant_id() or is_platform_admin());
drop policy if exists patients_insert on patients;
create policy patients_insert on patients for insert
  with check (tenant_id = current_tenant_id() and has_permission('patients.edit'));
drop policy if exists patients_update on patients;
create policy patients_update on patients for update
  using (tenant_id = current_tenant_id() and has_permission('patients.edit'));

-- test_requests
drop policy if exists requests_select on test_requests;
create policy requests_select on test_requests for select
  using (tenant_id = current_tenant_id() or is_platform_admin());
drop policy if exists requests_insert on test_requests;
create policy requests_insert on test_requests for insert
  with check (tenant_id = current_tenant_id() and has_permission('requests.create'));
drop policy if exists requests_update on test_requests;
create policy requests_update on test_requests for update
  using (tenant_id = current_tenant_id() and has_permission('requests.create'));

-- samples
drop policy if exists samples_select on samples;
create policy samples_select on samples for select
  using (tenant_id = current_tenant_id() or is_platform_admin());
drop policy if exists samples_write on samples;
create policy samples_write on samples for all
  using (tenant_id = current_tenant_id() and has_permission('samples.collect'))
  with check (tenant_id = current_tenant_id() and has_permission('samples.collect'));

-- results — entry, validation, release are all gated; SELECT is tenant-wide.
-- Fine-grained transition checks (only a validator may validate) are enforced
-- in the Edge Function / RPC layer; RLS guarantees tenant + base permission.
drop policy if exists results_select on results;
create policy results_select on results for select
  using (tenant_id = current_tenant_id() or is_platform_admin());
drop policy if exists results_insert on results;
create policy results_insert on results for insert
  with check (tenant_id = current_tenant_id() and has_permission('results.enter'));
drop policy if exists results_update on results;
create policy results_update on results for update
  using (tenant_id = current_tenant_id()
         and (has_permission('results.validate') or has_permission('results.release') or has_permission('results.enter')));

-- invoices
drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices for select
  using ((tenant_id = current_tenant_id() and has_permission('billing.view')) or is_platform_admin());
drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices for all
  using (tenant_id = current_tenant_id() and has_permission('billing.manage'))
  with check (tenant_id = current_tenant_id() and has_permission('billing.manage'));

-- appointments
drop policy if exists appts_select on appointments;
create policy appts_select on appointments for select
  using (tenant_id = current_tenant_id() or is_platform_admin());
drop policy if exists appts_write on appointments;
create policy appts_write on appointments for all
  using (tenant_id = current_tenant_id() and has_permission('requests.create'))
  with check (tenant_id = current_tenant_id() and has_permission('requests.create'));

-- vitals
drop policy if exists vitals_select on vitals;
create policy vitals_select on vitals for select
  using (tenant_id = current_tenant_id() or is_platform_admin());
drop policy if exists vitals_write on vitals;
create policy vitals_write on vitals for all
  using (tenant_id = current_tenant_id() and has_permission('patients.edit'))
  with check (tenant_id = current_tenant_id() and has_permission('patients.edit'));

-- qc_runs
drop policy if exists qc_select on qc_runs;
create policy qc_select on qc_runs for select
  using (tenant_id = current_tenant_id() or is_platform_admin());
drop policy if exists qc_write on qc_runs;
create policy qc_write on qc_runs for all
  using (tenant_id = current_tenant_id() and has_permission('qc.manage'))
  with check (tenant_id = current_tenant_id() and has_permission('qc.manage'));

-- dsar_requests
drop policy if exists dsar_select on dsar_requests;
create policy dsar_select on dsar_requests for select
  using ((tenant_id = current_tenant_id() and has_permission('privacy.manage')) or is_platform_admin());
drop policy if exists dsar_write on dsar_requests;
create policy dsar_write on dsar_requests for all
  using (tenant_id = current_tenant_id() and has_permission('privacy.manage'))
  with check (tenant_id = current_tenant_id() and has_permission('privacy.manage'));

-- audit_log — readable by audit-permitted roles; INSERT only (append-only),
-- never UPDATE or DELETE by anyone (enforced by omitting those policies).
drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select
  using ((tenant_id = current_tenant_id() and has_permission('audit.view')) or is_platform_admin());
drop policy if exists audit_insert on audit_log;
create policy audit_insert on audit_log for insert
  with check (tenant_id = current_tenant_id());

-- devices
drop policy if exists devices_select on devices;
create policy devices_select on devices for select
  using (tenant_id = current_tenant_id() or is_platform_admin());
drop policy if exists devices_write on devices;
create policy devices_write on devices for all
  using (tenant_id = current_tenant_id() and has_permission('settings.manage'))
  with check (tenant_id = current_tenant_id() and has_permission('settings.manage'));

-- ============================================================================
-- NOTE on the referral portal:
-- Referring clinicians (REFERRAL_CLINICIAN) are intentionally NOT given broad
-- patients/results SELECT here. Their read-only access to only their own
-- referred patients' released results is served through a dedicated,
-- security-definer RPC (see 0003_functions.sql: referral_results()), so the
-- base RLS never exposes the whole tenant to them.
-- ============================================================================
