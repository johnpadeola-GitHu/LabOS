-- ============================================================================
-- LabOS — Activation codes (migration 0004)
--
-- One-time codes minted by the platform operator when provisioning a lab.
-- The lab administrator enters this code on first login to claim their tenant.
-- Each code is single-use and expires after 30 days.
-- ============================================================================

create table if not exists activation_codes (
  id           uuid primary key default uuid_generate_v4(),
  code         text not null unique,          -- e.g. VITAL-7F3K-2026
  tenant_id    uuid not null references tenants(id) on delete cascade,
  created_by   uuid references app_users(id), -- platform admin who minted it
  used_by      uuid references auth.users(id),-- set when redeemed
  used_at      timestamptz,
  expires_at   timestamptz not null default (now() + interval '30 days'),
  created_at   timestamptz not null default now()
);

create index if not exists idx_activation_codes_code      on activation_codes(code);
create index if not exists idx_activation_codes_tenant_id on activation_codes(tenant_id);

-- RLS: only platform admins can create/view codes; no one can read them via
-- the anon key (the Edge Function uses the service role key server-side).
alter table activation_codes enable row level security;

create policy activation_codes_platform on activation_codes for all
  using (is_platform_admin())
  with check (is_platform_admin());
