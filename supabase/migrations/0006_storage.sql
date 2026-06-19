-- ============================================================================
-- LabOS — Supabase Storage setup (migration 0006)
--
-- Creates a private bucket for histopathology gross images, specimen photos,
-- and other clinical images. Files are organised by tenant to enforce
-- isolation: {tenant_id}/{case_id}/{filename}
--
-- RLS on storage.objects mirrors the same tenant-isolation pattern used
-- throughout the rest of the schema — a user can only read/write files
-- inside their own tenant's folder.
-- ============================================================================

-- Create the bucket (private — not publicly readable; access via signed URLs)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinical-images',
  'clinical-images',
  false,
  10485760, -- 10 MB per file
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Grant base storage access to authenticated users (RLS policies below
-- control which specific files/folders they can actually reach)
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- ── RLS policies on storage.objects ──────────────────────────────────────────
-- Files are stored with path: {tenant_id}/{case_id}/{filename}
-- storage.foldername(name) returns an array of path segments, so
-- (storage.foldername(name))[1] is the tenant_id segment.

drop policy if exists "Users can view own tenant images" on storage.objects;
create policy "Users can view own tenant images"
on storage.objects for select
to authenticated
using (
  bucket_id = 'clinical-images'
  and (
    (storage.foldername(name))[1] = (
      select tenant_id::text from app_users where id = auth.uid()
    )
    or exists (select 1 from app_users where id = auth.uid() and is_platform = true)
  )
);

drop policy if exists "Users can upload to own tenant folder" on storage.objects;
create policy "Users can upload to own tenant folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'clinical-images'
  and (storage.foldername(name))[1] = (
    select tenant_id::text from app_users where id = auth.uid()
  )
);

drop policy if exists "Users can update own tenant images" on storage.objects;
create policy "Users can update own tenant images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'clinical-images'
  and (storage.foldername(name))[1] = (
    select tenant_id::text from app_users where id = auth.uid()
  )
);

drop policy if exists "Users can delete own tenant images" on storage.objects;
create policy "Users can delete own tenant images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'clinical-images'
  and (storage.foldername(name))[1] = (
    select tenant_id::text from app_users where id = auth.uid()
  )
);

-- ── Track uploaded images in a regular table for easy querying ──────────────
-- (Storage itself doesn't give us rich metadata querying, so we mirror
-- key info here — linked to the histopath case, sample, or patient.)
create table if not exists clinical_images (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  storage_path text not null,              -- e.g. {tenant_id}/{case_id}/img1.jpg
  case_id      text,                       -- histopath case ID, sample ID, etc.
  patient_id   uuid references patients(id) on delete set null,
  category     text not null default 'gross', -- gross | microscopy | specimen | other
  label        text,                       -- e.g. "Specimen overview", "Cut surface"
  uploaded_by  uuid references app_users(id),
  file_size    integer,
  mime_type    text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_clinical_images_tenant on clinical_images(tenant_id);
create index if not exists idx_clinical_images_case    on clinical_images(case_id);
create index if not exists idx_clinical_images_patient on clinical_images(patient_id);

alter table clinical_images enable row level security;
grant select, insert, update, delete on public.clinical_images to authenticated;

drop policy if exists clinical_images_select on clinical_images;
create policy clinical_images_select on clinical_images for select
  using (tenant_id = current_tenant_id() or is_platform_admin());

drop policy if exists clinical_images_write on clinical_images;
create policy clinical_images_write on clinical_images for all
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());
