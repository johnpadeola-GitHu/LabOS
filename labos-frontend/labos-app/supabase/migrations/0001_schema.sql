-- ============================================================================
-- LabOS — Supabase schema (migration 0001)
-- Multi-tenant clinical laboratory operations platform.
--
-- Design principles:
--   * Every tenant-scoped table carries tenant_id and is protected by
--     Row-Level Security (RLS) so one lab can never read another's data.
--   * auth.users (Supabase Auth) is the identity source; app_users links a
--     Supabase user to a tenant and a LabOS role.
--   * Helper functions current_tenant_id() and has_permission() centralise the
--     RLS logic so policies stay short and consistent.
--
-- Apply with:  supabase db push     (or paste into the SQL editor)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type labos_role as enum (
    'PLATFORM_SUPER_ADMIN','TENANT_ADMIN','LAB_DIRECTOR','PATHOLOGIST',
    'RENAL_SPECIALIST','LAB_SCIENTIST','RADIOLOGIST','NURSE','PHLEBOTOMIST',
    'FRONT_DESK','CASHIER','INVENTORY_OFFICER','ACCOUNTANT','BRANCH_MANAGER',
    'REFERRAL_CLINICIAN'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type plan_code as enum ('corecare','standard','professional','enterprise');
exception when duplicate_object then null; end $$;

do $$ begin
  create type request_status as enum (
    'ordered','collected','received','in_progress','entered',
    'validated','released','rejected','cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type result_status as enum ('entered','validated','released','amended');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Tenants & subscription
-- ----------------------------------------------------------------------------
create table if not exists tenants (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  trading_name    text,
  plan            plan_code not null default 'corecare',
  status          text not null default 'trialing',  -- trialing|active|past_due|cancelled
  rc_number       text,
  tax_id          text,
  mlscn_licence   text,
  iso15189        text,
  address         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists centres (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  address     text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Identity: link Supabase auth.users to a tenant + role
-- ----------------------------------------------------------------------------
create table if not exists app_users (
  id            uuid primary key references auth.users(id) on delete cascade,
  tenant_id     uuid references tenants(id) on delete cascade,
  centre_id     uuid references centres(id) on delete set null,
  full_name     text not null,
  role          labos_role not null default 'FRONT_DESK',
  phone         text,
  active        boolean not null default true,
  is_platform   boolean not null default false,  -- platform super-admins span tenants
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Helper functions used by RLS policies
-- ----------------------------------------------------------------------------
-- The tenant the current auth user belongs to.
create or replace function current_tenant_id()
returns uuid language sql stable security definer as $$
  select tenant_id from app_users where id = auth.uid();
$$;

-- The role of the current auth user.
create or replace function current_role_code()
returns labos_role language sql stable security definer as $$
  select role from app_users where id = auth.uid();
$$;

-- Is the current user a platform super-admin (cross-tenant access)?
create or replace function is_platform_admin()
returns boolean language sql stable security definer as $$
  select coalesce((select is_platform from app_users where id = auth.uid()), false);
$$;

-- Permission check mirroring the frontend RBAC matrix (src/core/rbac.js).
-- Returns true if the current user's role grants the named permission.
create or replace function has_permission(perm text)
returns boolean language plpgsql stable security definer as $$
declare
  r labos_role;
begin
  select role into r from app_users where id = auth.uid();
  if r is null then return false; end if;
  -- Full-access roles
  if r in ('PLATFORM_SUPER_ADMIN','TENANT_ADMIN','LAB_DIRECTOR') then
    return true;
  end if;
  -- Role → permission mapping (keep in sync with rbac.js RBAC_MATRIX)
  return case
    when r = 'PATHOLOGIST'       and perm in ('patients.view','requests.view','requests.create','results.enter','results.validate','results.release','histopath.manage','molecular.manage','qc.manage','reports.view','audit.view') then true
    when r = 'RENAL_SPECIALIST'  and perm in ('patients.view','requests.view','requests.create','samples.collect','results.enter','results.validate','renal.manage','qc.manage','reports.view') then true
    when r = 'LAB_SCIENTIST'     and perm in ('patients.view','requests.view','requests.create','samples.collect','results.enter','inventory.manage','qc.manage') then true
    when r = 'RADIOLOGIST'       and perm in ('patients.view','requests.view','imaging.manage','results.enter','results.validate','results.release','reports.view') then true
    when r = 'NURSE'             and perm in ('patients.view','patients.edit','requests.view','requests.create','samples.collect') then true
    when r = 'PHLEBOTOMIST'      and perm in ('patients.view','requests.view','samples.collect') then true
    when r = 'FRONT_DESK'        and perm in ('patients.view','patients.edit','requests.view','requests.create','billing.view') then true
    when r = 'CASHIER'           and perm in ('patients.view','billing.view','billing.manage') then true
    when r = 'INVENTORY_OFFICER' and perm in ('inventory.manage','reports.view') then true
    when r = 'ACCOUNTANT'        and perm in ('billing.view','billing.manage','reports.view','audit.view') then true
    when r = 'BRANCH_MANAGER'    and perm in ('patients.view','patients.edit','requests.view','requests.create','samples.collect','billing.view','billing.manage','inventory.manage','reports.view','staff.manage','audit.view') then true
    else false
  end;
end;
$$;

-- ----------------------------------------------------------------------------
-- Clinical tables (all tenant-scoped)
-- ----------------------------------------------------------------------------
create table if not exists patients (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  hospital_number text,
  name            text not null,
  dob             date,
  gender          text,
  phone           text,
  email           text,
  address         text,
  blood_group     text,
  referring_doctor text,
  referring_doctor_id uuid references app_users(id),
  deletion_requested boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_patients_tenant on patients(tenant_id);
create index if not exists idx_patients_name   on patients(tenant_id, name);

create table if not exists test_requests (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  centre_id    uuid references centres(id),
  patient_id   uuid not null references patients(id) on delete cascade,
  display_id   text,                       -- e.g. REQ-2026-04412
  tests        jsonb not null default '[]',
  status       request_status not null default 'ordered',
  priority     text default 'routine',
  requested_by text,
  requested_by_id uuid references app_users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_requests_tenant on test_requests(tenant_id);
create index if not exists idx_requests_patient on test_requests(patient_id);
create index if not exists idx_requests_status  on test_requests(tenant_id, status);

create table if not exists samples (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  request_id    uuid references test_requests(id) on delete cascade,
  display_id    text,
  barcode       text,
  specimen_type text,
  volume        text,
  collected_at  timestamptz,
  collected_by  text,
  condition     text,
  location      text,
  status        text default 'received',
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_samples_tenant on samples(tenant_id);

-- One row per analyte, with its own validate/release lifecycle.
create table if not exists results (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  request_id   uuid not null references test_requests(id) on delete cascade,
  test_code    text not null,
  test_name    text,
  value        text,
  unit         text,
  ref_range    text,
  flag         text,           -- N | H | L | HH | LL | A
  status       result_status not null default 'entered',
  entered_by   uuid references app_users(id),
  entered_at   timestamptz default now(),
  validated_by uuid references app_users(id),
  validated_at timestamptz,
  released_by  uuid references app_users(id),
  released_at  timestamptz,
  interpretation text
);
create index if not exists idx_results_tenant  on results(tenant_id);
create index if not exists idx_results_request on results(request_id);

create table if not exists invoices (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  patient_id    uuid references patients(id) on delete set null,
  display_id    text,
  date          date not null default current_date,
  amount        numeric(12,2) not null default 0,
  paid          numeric(12,2) not null default 0,
  balance       numeric(12,2) not null default 0,
  method        text,
  hmo           text,
  policy        text,
  line_items    jsonb not null default '[]',
  status        text not null default 'unpaid',  -- paid|partial|unpaid
  created_at    timestamptz not null default now()
);
create index if not exists idx_invoices_tenant on invoices(tenant_id);

create table if not exists appointments (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  patient_id   uuid references patients(id) on delete cascade,
  type         text,
  scheduled_at timestamptz,
  status       text default 'scheduled',
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_appts_tenant on appointments(tenant_id);

create table if not exists vitals (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  patient_id   uuid references patients(id) on delete cascade,
  captured_at  timestamptz default now(),
  data         jsonb not null default '{}'
);
create index if not exists idx_vitals_tenant on vitals(tenant_id);

-- Quality-control runs (Westgard / Levey-Jennings)
create table if not exists qc_runs (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  analyte     text not null,
  result      numeric not null,
  z_score     numeric,
  operator    text,
  run_at      timestamptz not null default now(),
  accepted    boolean
);
create index if not exists idx_qc_tenant on qc_runs(tenant_id, analyte);

-- NDPR data subject access requests
create table if not exists dsar_requests (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  display_id    text,
  type          text not null,        -- access|correction|deletion|portability|restriction|objection
  patient_id    uuid references patients(id) on delete set null,
  notes         text,
  status        text not null default 'received',
  submitted_at  timestamptz not null default now(),
  due_at        timestamptz not null,
  completed_at  timestamptz
);
create index if not exists idx_dsar_tenant on dsar_requests(tenant_id);

-- Append-only audit log (hash-chained at the application layer)
create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  actor_id    uuid references app_users(id),
  actor_name  text,
  action      text not null,
  payload     jsonb,
  prev_hash   text,
  hash        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_tenant on audit_log(tenant_id, created_at desc);

-- Registered devices (licence/seat control)
create table if not exists devices (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  fingerprint  text not null,
  label        text,
  user_agent   text,
  status       text not null default 'active',
  last_seen    timestamptz default now(),
  created_at   timestamptz not null default now(),
  unique (tenant_id, fingerprint)
);
create index if not exists idx_devices_tenant on devices(tenant_id);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['tenants','patients','test_requests'] loop
    execute format('drop trigger if exists trg_touch_%1$s on %1$s', t);
    execute format('create trigger trg_touch_%1$s before update on %1$s for each row execute function touch_updated_at()', t);
  end loop;
end $$;
