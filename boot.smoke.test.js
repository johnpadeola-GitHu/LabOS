-- ============================================================================
-- LabOS — RPC functions & triggers (migration 0003)
--
-- These encode the server-authoritative business rules that must not live only
-- in the client: the result lifecycle transitions (with role checks), the
-- scoped referral-portal read, audit hash-chaining, and linking a new Supabase
-- auth user to their tenant on signup.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Result lifecycle transitions
-- Each enforces the correct permission and a valid state transition.
-- ----------------------------------------------------------------------------
create or replace function validate_result(p_result_id uuid)
returns results language plpgsql security definer as $$
declare row results;
begin
  if not has_permission('results.validate') then
    raise exception 'permission_denied: results.validate';
  end if;
  update results
     set status = 'validated', validated_by = auth.uid(), validated_at = now()
   where id = p_result_id
     and tenant_id = current_tenant_id()
     and status = 'entered'
  returning * into row;
  if row.id is null then
    raise exception 'invalid_transition: result not in entered state';
  end if;
  return row;
end; $$;

create or replace function release_result(p_result_id uuid)
returns results language plpgsql security definer as $$
declare row results;
begin
  if not has_permission('results.release') then
    raise exception 'permission_denied: results.release';
  end if;
  update results
     set status = 'released', released_by = auth.uid(), released_at = now()
   where id = p_result_id
     and tenant_id = current_tenant_id()
     and status = 'validated'
  returning * into row;
  if row.id is null then
    raise exception 'invalid_transition: result not in validated state';
  end if;
  return row;
end; $$;

-- ----------------------------------------------------------------------------
-- Referral portal: a referring clinician sees ONLY released results for the
-- patients they referred. security definer so it can read past RLS, but it
-- filters strictly by referring_doctor_id = auth.uid().
-- ----------------------------------------------------------------------------
create or replace function referral_results()
returns table (
  request_id uuid,
  patient_name text,
  test_name text,
  value text,
  unit text,
  ref_range text,
  flag text,
  released_at timestamptz
) language sql stable security definer as $$
  select r.request_id, p.name, r.test_name, r.value, r.unit, r.ref_range, r.flag, r.released_at
    from results r
    join test_requests tr on tr.id = r.request_id
    join patients p       on p.id = tr.patient_id
   where r.status = 'released'
     and p.referring_doctor_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- Audit log with hash chaining. Each entry's hash includes the previous hash,
-- so any tampering or deletion breaks the chain and is detectable.
-- ----------------------------------------------------------------------------
create or replace function write_audit(p_action text, p_payload jsonb)
returns audit_log language plpgsql security definer as $$
declare
  prev text;
  newrow audit_log;
  actor text;
begin
  select hash into prev
    from audit_log
   where tenant_id = current_tenant_id()
   order by id desc limit 1;

  select full_name into actor from app_users where id = auth.uid();

  insert into audit_log (tenant_id, actor_id, actor_name, action, payload, prev_hash, hash)
  values (
    current_tenant_id(), auth.uid(), actor, p_action, p_payload, prev,
    encode(digest(coalesce(prev,'') || p_action || coalesce(p_payload::text,'') || now()::text, 'sha256'), 'hex')
  )
  returning * into newrow;
  return newrow;
end; $$;

-- ----------------------------------------------------------------------------
-- NDPR: export all data held for a patient (access / portability request).
-- Gated to privacy.manage permission and the caller's tenant.
-- ----------------------------------------------------------------------------
create or replace function export_patient_data(p_patient_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare result jsonb;
begin
  if not has_permission('privacy.manage') then
    raise exception 'permission_denied: privacy.manage';
  end if;
  select jsonb_build_object(
    'exported_at', now(),
    'patient',  (select to_jsonb(p) from patients p where p.id = p_patient_id and p.tenant_id = current_tenant_id()),
    'requests', (select coalesce(jsonb_agg(to_jsonb(tr)), '[]') from test_requests tr where tr.patient_id = p_patient_id and tr.tenant_id = current_tenant_id()),
    'results',  (select coalesce(jsonb_agg(to_jsonb(r)), '[]')  from results r join test_requests tr on tr.id = r.request_id where tr.patient_id = p_patient_id and r.tenant_id = current_tenant_id()),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(i)), '[]')  from invoices i where i.patient_id = p_patient_id and i.tenant_id = current_tenant_id()),
    'vitals',   (select coalesce(jsonb_agg(to_jsonb(v)), '[]')  from vitals v where v.patient_id = p_patient_id and v.tenant_id = current_tenant_id())
  ) into result;
  return result;
end; $$;

-- ----------------------------------------------------------------------------
-- Link a newly-confirmed Supabase auth user to an app_users row.
-- Reads tenant_id + role + full_name from the signup metadata
-- (raw_user_meta_data), which the invite/activation flow populates.
-- ----------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into app_users (id, tenant_id, full_name, role, is_platform)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'tenant_id','')::uuid,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::labos_role, 'FRONT_DESK'),
    coalesce((new.raw_user_meta_data->>'is_platform')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
