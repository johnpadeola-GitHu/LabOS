-- ============================================================================
-- LabOS Instrument Gateway — Database Schema (migration 0005)
--
-- Tables for the complete Phase 1 implementation:
--   - analyzers            : registered instruments
--   - analyzer_ports       : connection configs (serial/USB/TCP/file)
--   - test_mappings        : analyzer code → LabOS test mapping
--   - gateway_messages     : raw messages received from analyzers
--   - gateway_results      : parsed results awaiting matching/validation
--   - sample_match_log     : audit trail of matching decisions
--   - validation_log       : audit trail of validation decisions
--   - qc_control_materials : QC materials per analyzer
--   - calibration_log      : calibration events
--   - gateway_sync_log     : LabOS sync events
-- ============================================================================

-- ── Analyzer registry ────────────────────────────────────────────────────────
create table if not exists analyzers (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  name            text not null,                    -- "Mindray BC-5000 (Bench 1)"
  model           text not null,                    -- "BC-5000"
  vendor          text not null,                    -- "Mindray"
  serial_number   text,
  department      text,                             -- "Hematology", "Chemistry"
  protocol        text not null default 'ASTM',    -- ASTM | HL7 | CSV | TXT | XML
  driver          text not null default 'generic_astm', -- driver key
  status          text not null default 'offline',  -- online | offline | error | maintenance
  last_seen       timestamptz,
  last_result_at  timestamptz,
  result_count    integer not null default 0,
  error_count     integer not null default 0,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_analyzers_tenant on analyzers(tenant_id);

-- ── Connection configuration ─────────────────────────────────────────────────
create table if not exists analyzer_ports (
  id              uuid primary key default uuid_generate_v4(),
  analyzer_id     uuid not null references analyzers(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  connection_type text not null default 'TCP',  -- TCP | RS232 | USB | FILE
  -- TCP/IP
  ip_address      text,
  port            integer,
  -- RS-232 / USB Serial
  com_port        text,    -- "COM3", "/dev/ttyUSB0"
  baud_rate       integer default 9600,
  data_bits       integer default 8,
  stop_bits       text    default '1',     -- "1", "1.5", "2"
  parity          text    default 'None',  -- None | Even | Odd | Mark | Space
  flow_control    text    default 'None',  -- None | RTS/CTS | XON/XOFF
  -- File watch
  watch_path      text,
  file_pattern    text default '*.txt',
  poll_interval   integer default 5,       -- seconds
  -- Common
  timeout_ms      integer default 5000,
  retry_count     integer default 3,
  retry_delay_ms  integer default 2000,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ports_analyzer on analyzer_ports(analyzer_id);

-- ── Test code → LabOS test mapping ──────────────────────────────────────────
create table if not exists test_mappings (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  analyzer_id     uuid references analyzers(id) on delete cascade,  -- null = global
  analyzer_code   text not null,      -- "WBC", "HGB", "GLU"
  labos_code      text not null,      -- internal test code
  labos_name      text not null,      -- "White Blood Cell Count"
  unit            text,               -- "×10⁹/L"
  ref_low_male    numeric,
  ref_high_male   numeric,
  ref_low_female  numeric,
  ref_high_female numeric,
  ref_low_child   numeric,
  ref_high_child  numeric,
  critical_low    numeric,
  critical_high   numeric,
  decimal_places  integer default 2,
  multiplier      numeric default 1,  -- unit conversion factor
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (tenant_id, analyzer_id, analyzer_code)
);
create index if not exists idx_mappings_tenant   on test_mappings(tenant_id);
create index if not exists idx_mappings_analyzer on test_mappings(analyzer_id);

-- ── Raw gateway messages ─────────────────────────────────────────────────────
create table if not exists gateway_messages (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  analyzer_id     uuid references analyzers(id) on delete set null,
  direction       text not null default 'IN',   -- IN | OUT
  protocol        text,
  raw_data        text,              -- hex or text of raw frame
  parsed          boolean not null default false,
  parse_error     text,
  message_type    text,             -- ASTM/HL7 message type
  received_at     timestamptz not null default now()
);
create index if not exists idx_messages_tenant   on gateway_messages(tenant_id, received_at desc);
create index if not exists idx_messages_analyzer on gateway_messages(analyzer_id, received_at desc);

-- ── Parsed results pending matching & validation ────────────────────────────
create table if not exists gateway_results (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  analyzer_id     uuid references analyzers(id) on delete set null,
  message_id      bigint references gateway_messages(id),

  -- Analyzer-side identifiers (what came in the message)
  analyzer_sample_id  text,
  analyzer_barcode    text,
  analyzer_accession  text,
  analyzer_patient_id text,

  -- Matched LabOS entities
  matched_patient_id  uuid references patients(id) on delete set null,
  matched_request_id  uuid references test_requests(id) on delete set null,
  match_method        text,      -- barcode | sample_id | accession | patient_id | manual
  match_confidence    text,      -- exact | probable | manual
  match_at            timestamptz,

  -- Result data (array of analytes, one row per message batch)
  analytes            jsonb not null default '[]',
  -- [{ code, name, value, unit, flag, ref_range, status }]

  -- Workflow status
  status              text not null default 'pending',
  -- pending | matched | validated | published | rejected | error

  -- Validation
  validated_by        uuid references app_users(id),
  validated_at        timestamptz,
  validation_notes    text,

  -- Published to LabOS results table
  published_at        timestamptz,
  published_result_ids jsonb,

  received_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_gresults_tenant  on gateway_results(tenant_id, received_at desc);
create index if not exists idx_gresults_status  on gateway_results(tenant_id, status);
create index if not exists idx_gresults_request on gateway_results(matched_request_id);

-- ── Sample match audit ────────────────────────────────────────────────────────
create table if not exists sample_match_log (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  gateway_result_id uuid references gateway_results(id),
  method_tried    text,      -- barcode | sample_id | accession | patient_id
  search_value    text,
  candidates      jsonb,     -- array of {id, score, reason}
  selected_id     uuid,
  outcome         text,      -- matched | no_match | ambiguous | manual
  actor_id        uuid references app_users(id),
  logged_at       timestamptz not null default now()
);
create index if not exists idx_matchlog_tenant on sample_match_log(tenant_id);

-- ── Result validation audit ───────────────────────────────────────────────────
create table if not exists validation_log (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  gateway_result_id uuid references gateway_results(id),
  analyte_code    text,
  check_type      text,   -- ref_range | critical | delta | duplicate | analyzer_error
  input_value     text,
  check_params    jsonb,
  outcome         text,   -- pass | warn | fail
  message         text,
  actor_id        uuid references app_users(id),
  logged_at       timestamptz not null default now()
);
create index if not exists idx_vallog_tenant on validation_log(tenant_id);

-- ── QC control materials ──────────────────────────────────────────────────────
create table if not exists qc_control_materials (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  analyzer_id     uuid references analyzers(id) on delete cascade,
  name            text not null,         -- "Bio-Rad Lyphochek L1"
  lot_number      text not null,
  level           text not null,         -- L1 | L2 | L3
  expiry_date     date,
  targets         jsonb not null default '{}',
  -- { "WBC": { "mean": 5.2, "sd": 0.3 }, ... }
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_qc_materials_tenant on qc_control_materials(tenant_id);

-- ── Calibration log ───────────────────────────────────────────────────────────
create table if not exists calibration_log (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  analyzer_id     uuid not null references analyzers(id) on delete cascade,
  calibrated_by   text,
  calibrator_lot  text,
  calibrated_at   timestamptz not null default now(),
  next_due_at     timestamptz,
  passed          boolean not null default true,
  notes           text
);
create index if not exists idx_cal_analyzer on calibration_log(analyzer_id);

-- ── Gateway sync log ──────────────────────────────────────────────────────────
create table if not exists gateway_sync_log (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  sync_type       text,     -- result_publish | status_update | config_pull
  records_sent    integer default 0,
  records_ok      integer default 0,
  records_failed  integer default 0,
  error           text,
  synced_at       timestamptz not null default now()
);
create index if not exists idx_synclog_tenant on gateway_sync_log(tenant_id, synced_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin for t in select unnest(array[
  'analyzers','analyzer_ports','test_mappings','gateway_messages',
  'gateway_results','sample_match_log','validation_log',
  'qc_control_materials','calibration_log','gateway_sync_log'
]) loop
  execute format('alter table %I enable row level security', t);
  execute format('drop policy if exists %1$I_tenant on %1$I', t);
  execute format(
    'create policy %1$I_tenant on %1$I for all
     using (tenant_id = current_tenant_id() or is_platform_admin())
     with check (tenant_id = current_tenant_id())', t);
end loop; end $$;

-- ── updated_at triggers ───────────────────────────────────────────────────────
do $$ declare t text;
begin for t in select unnest(array['analyzers','gateway_results']) loop
  execute format('drop trigger if exists trg_touch_%1$s on %1$I', t);
  execute format(
    'create trigger trg_touch_%1$s before update on %1$I
     for each row execute function touch_updated_at()', t);
end loop; end $$;
