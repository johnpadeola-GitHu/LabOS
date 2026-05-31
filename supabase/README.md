# Connecting LabOS to Supabase

LabOS ships ready for a Supabase backend. The app already calls a single
`window.LabOSApi` interface for all backend work, and falls back to local
demo/offline mode when no backend is configured. The Supabase adapter
(`src/core/supabase-adapter.js`) implements that same interface against
Supabase — so turning on a real backend is configuration, not a rewrite.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> and create a new project.
2. Note your **Project URL** (e.g. `https://abcd.supabase.co`) and the
   **anon public key** (Project Settings → API).

## 2. Apply the database schema

The SQL lives in `supabase/migrations/`. Apply it in order, either with the
Supabase CLI or by pasting each file into the SQL editor:

```bash
# Option A — Supabase CLI (recommended)
supabase link --project-ref YOUR_PROJECT_REF
supabase db push

# Option B — SQL editor
# Paste, in order:
#   supabase/migrations/0001_schema.sql      (tables, enums, helpers)
#   supabase/migrations/0002_rls.sql         (row-level security policies)
#   supabase/migrations/0003_functions.sql   (RPCs + new-user trigger)
```

What each migration does:

| File | Purpose |
|------|---------|
| `0001_schema.sql` | Tenants, centres, `app_users` (links Supabase Auth → tenant + role), and every clinical table (patients, requests, samples, results, invoices, appointments, vitals, QC runs, DSARs, audit log, devices). Includes the `has_permission()` function mirroring the frontend RBAC matrix. |
| `0002_rls.sql` | Enables Row-Level Security on all tenant tables and adds policies. **This is the security boundary** — a query can only ever see rows for the caller's own tenant, and writes additionally require the matching RBAC permission. |
| `0003_functions.sql` | Server-authoritative business rules: result lifecycle transitions (`validate_result`, `release_result`), the scoped referral-portal read, hash-chained `write_audit`, NDPR `export_patient_data`, and the trigger that links a new auth user to their tenant. |

## 3. Point the app at your project

Set `window.LABOS_CONFIG` before the app boots. In `src/index.html` there is a
placeholder `<script>` block — fill it in (or inject it at deploy time):

```html
<script>
  window.LABOS_CONFIG = {
    supabaseUrl:     'https://YOUR_PROJECT.supabase.co',
    supabaseAnonKey: 'YOUR_PUBLIC_ANON_KEY'
  };
</script>
```

That's all the app needs. When these values are present the adapter activates
and replaces the local mock; when they're absent the app stays in demo mode.

> **Never put the service-role key in the frontend.** Only the anon public key
> belongs in the browser. The anon key is safe to expose *because* RLS is what
> actually protects the data.

## 4. Create the first tenant and admin

Because LabOS is invite-only, the first tenant is provisioned by a platform
admin. For a quick start you can seed one by hand in the SQL editor:

```sql
-- 1. Create a tenant
insert into tenants (name, plan, status)
values ('Vitalis Diagnostics', 'professional', 'active')
returning id;   -- copy the returned id

-- 2. Create the auth user in Authentication → Users (set email + password),
--    then link them to the tenant as TENANT_ADMIN:
insert into app_users (id, tenant_id, full_name, role)
values (
  'AUTH_USER_UUID_HERE',
  'TENANT_ID_FROM_STEP_1',
  'Dr. Ade Ogundimu',
  'TENANT_ADMIN'
);
```

For the normal flow, the invite/activation path creates the auth user with
`tenant_id` and `role` in their metadata, and the `handle_new_user()` trigger
links them automatically.

## 5. Verify the connection

1. Run `npm run dev`.
2. Open the browser console — you should see no Supabase load errors.
3. Sign in. Data now reads from and writes to Postgres, scoped to your tenant.
4. Try signing in as a non-admin role (e.g. a Phlebotomist) and confirm you
   cannot reach Billing or Staff — RLS plus the frontend RBAC both block it.

---

## How it fits together

```
  App code  ─────────────►  window.LabOSApi  ─────────────►  Supabase
  (renderers, handlers)     (single interface)                (Postgres + Auth)
                                   │
                    ┌──────────────┴───────────────┐
                    │                               │
            mock / offline                  supabase-adapter.js
          (no config present)            (LABOS_CONFIG present)
```

- The app never imports Supabase directly. It only knows `window.LabOSApi`.
- `supabase-adapter.js` lazy-loads `@supabase/supabase-js` from the CDN the
  first time a call is made, so the dependency adds nothing to your bundle and
  costs nothing when unused.
- The **offline outbox** (`OfflineCore`) already queues mutations when offline
  and replays them through `LabOSApi.sync()` when back online — the adapter
  implements `sync()` by replaying each queued op against Supabase.

## Security model

- **Tenant isolation** is enforced by Postgres RLS, not by the client. Even a
  bug in a frontend query cannot return another lab's data.
- **Role permissions** are enforced twice: in the UI (`src/core/rbac.js`,
  hides/blocks actions) and in the database (`has_permission()` in RLS policies
  and RPCs). The database is the authority; the UI is the convenience layer.
- **Audit log** is append-only (no UPDATE/DELETE policy exists) and
  hash-chained, so tampering is detectable.
- **The referral portal** uses a dedicated security-definer RPC
  (`referral_results()`) that returns only released results for patients the
  signed-in clinician referred — referring doctors never get tenant-wide read
  access.

## Real-time (optional)

The adapter exposes the raw client via `await window.LabOSApi.raw()`, so you can
subscribe to Postgres changes for live dashboards:

```js
const c = await window.LabOSApi.raw();
c.channel('requests')
 .on('postgres_changes',
     { event: 'INSERT', schema: 'public', table: 'test_requests' },
     payload => console.log('new request', payload.new))
 .subscribe();
```

## Storage (images, PDFs)

Histopathology slides, specimen photos, and generated PDF reports should go in
Supabase Storage. Create a bucket per tenant (or a shared bucket with
tenant-prefixed paths and a Storage RLS policy) and wire the upload areas — the
UI already routes image uploads to a "production backend" handler that you can
point at `supabase.storage`.
