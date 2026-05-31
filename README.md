# LabOS — Frontend

LabOS by **AgoroX Technologies** is a multi-tenant laboratory operations
platform (LIMS) for African clinical laboratories, with first-class support for
Nigerian workflows: Naira pricing, NHIS/HMO insurance, Termii SMS, Paystack
billing, and NDPR-aligned audit logging.

This repository contains the **frontend** application. It was migrated from a
single-file interactive prototype into a real project structure (Vite build,
test suite, ordered source layers) while preserving 100% of the prototype's
tested runtime behaviour.

---

## Quick start

```bash
npm install      # install dependencies
npm run dev      # start the dev server at http://localhost:5173
npm run build    # produce an optimised production build in dist/
npm run preview  # preview the production build
npm test         # run the test suite (jsdom + Vitest)
```

> **Node 18+** is required.

---

## Project layout

```
labos-app/
├── package.json            # scripts + dependencies
├── vite.config.js          # dev server + production build config
├── vitest.config.js        # test runner config
├── eslint.config.js        # lint rules
├── scripts/
│   └── build-app.mjs        # bundles the ordered app layers (esbuild)
├── src/
│   ├── index.html           # HTML shell (markup + head)
│   ├── styles/
│   │   └── labos.css         # all application styles (design tokens, layout)
│   ├── app/
│   │   ├── app.views.js      # data seed, ROUTES, page renderers & handlers
│   │   └── bootstrap.js      # bootApp() + service-worker registration
│   └── core/
│       ├── modules.js           # platform module manifest (mirrors labos-api)
│       ├── api.js               # LabOSApi client (real-backend calls + fallback)
│       ├── data-mode.js         # DataMode singleton (demo/real switching)
│       ├── offline-core.js      # OfflineCore singleton (persistence, outbox, sync)
│       ├── license-core.js      # LicenseCore singleton (devices, RS256, grace)
│       ├── service-ui.js        # connection/licence badges, overlay, device panels
│       ├── qc-engine.js         # Westgard QC rules + Levey-Jennings engine (ISO 15189)
│       ├── session-compliance.js # idle timeout, i18n (EN/HA/YO/IG), NDPR, error boundary
│       └── rbac.js              # role-based access control: matrix, can(), route guards
├── public/
│   └── labos.bundle.js       # generated app bundle (git-ignored)
├── tests/
│   ├── harness.js            # boots the bundle in jsdom for tests
│   ├── boot.smoke.test.js       # boot + global wiring smoke test
│   ├── regression.test.js       # data, routing, modals, offline, licence, filters
│   ├── wiring.test.js           # full domain workflows end-to-end
│   ├── appointments.test.js     # appointment modal coverage
│   ├── patient.form.test.js     # patient registration form
│   ├── plan.access.test.js      # 4-tier plan limits and module gating
│   ├── request.patient.test.js  # patient combobox and test request flow
│   ├── onboarding.gate.test.js  # activation gate and provisioning
│   └── enterprise.test.js       # QC engine, NDPR, session, i18n, a11y, referral portal
└── dist/                     # production build output (git-ignored)
```

---

## Architecture (current phase)

The application currently uses an **ordered-script architecture**. The code is
split into cohesive layers that share a controlled global scope, loaded in
dependency order:

1. **`src/app/app.views.js`** — the data seed (`APP_STATE`, catalogues),
   the `ROUTES` table, every page renderer, the modal system, form handlers,
   the command palette, the toast system, and the workspace shell.
2. **`src/core/` service layer** — the three core service singletons, now in
   one cohesive file each (split from the former monolithic `services.js`):
   - **`offline-core.js`** (`OfflineCore`) — offline-first persistence, the
     mutation outbox, sync, and online/offline tracking.
   - **`license-core.js`** (`LicenseCore`) — device registration, licence
     signing/verification, heartbeats, grace mode, and lockout.
   - **`data-mode.js`** (`DataMode`) — demo/real data switching.
   - **`service-ui.js`** — the connection/licence badges, the licence overlay,
     and the device + sync panels that render those services' state.
   - **`api.js`** (`LabOSApi`) — the real-backend client, with offline fallback.
   - **`modules.js`** — the platform module manifest (mirrors `labos-api`).
   - **`qc-engine.js`** (`QC`) — Westgard multi-rule QC evaluation and
     Levey-Jennings data for ISO 15189-aligned quality control.
   - **`session-compliance.js`** — idle-session timeout, internationalisation
     (English, Hausa, Yoruba, Igbo), NDPR data-subject-rights helpers, and the
     global error boundary.
   - **`rbac.js`** — role-based access control: the enforced role→permission
     matrix, `can()` / `canAccessRoute()` / `requirePermission()` guards.
3. **`src/app/bootstrap.js`** — `bootApp()` and the inline service worker.

`scripts/build-app.mjs` concatenates these layers in order and minifies them
with esbuild into `public/labos.bundle.js`, which `src/index.html` loads as a
single classic `<script>`. This preserves the prototype's global function
declarations and inline `onclick` handlers exactly, while giving us a real dev
server, an optimised production build, sourcemaps, and a test harness.

### Why ordered scripts and not ES modules (yet)?

The prototype relied on hundreds of implicit cross-references between global
functions and on inline `onclick="fn()"` handlers in rendered HTML. Converting
all of that to `import`/`export` in one step would touch thousands of call
sites and risk regressions. The ordered-script approach is a **safe migration
checkpoint**: it gives us project structure, build tooling, and tests now,
and lets us convert individual layers to true ES modules incrementally,
behind the test suite.

Splitting `services.js` into one file per service is the first step on that
path: each singleton now lives in its own reviewable unit with clear
responsibilities, which is the prerequisite for a true-ESM cutover. That
cutover is deferred until `app.views.js` is itself split, because the services
and the view layer are **bidirectionally coupled** through the shared global
scope (the services call `APP_STATE`, `toast`, `esc`, `LabOSApi`, and the view
layer calls the services in ~190 places). Converting only the services to ESM
today would force circular imports into a not-yet-modular 14.8k-line file.

### Planned next steps

- Split `app.views.js` into per-route modules under `src/app/routes/`. This is
  the gating prerequisite for the ESM cutover.
- Once the view layer is modular, convert `OfflineCore`, `LicenseCore`,
  `DataMode`, and `LabOSApi` to true ES modules with explicit exports, behind
  the test suite (they are already self-contained, single-file IIFEs).
- Replace the in-bundle mock server in `LicenseCore` with real API calls once
  the backend exists (see the backend project).

---

## Connecting to the backend

The frontend is **offline-first with graceful fallback**. By default (no config)
it runs entirely on `localStorage` with the in-bundle mock server — the demo
experience is unchanged. To point it at the real LabOS API, set a config object
before the app bundle loads, e.g. in `index.html`:

```html
<script>window.LABOS_CONFIG = { apiBase: 'https://api.labos.africa' };</script>
```

When `apiBase` is set **and** a user is authenticated (`LabOSApi.login(...)`):

- **`LicenseCore.registerDevice` / `heartbeat`** call `POST /devices/register`
  and `POST /devices/heartbeat`. Licences returned by the server are **verified
  with WebCrypto (RS256)** against the public key from `GET /licence/public-key`
  — not the in-bundle demo salt. Tampering (renamed lab, extended expiry, raised
  device cap) fails verification. Interop is proven end-to-end in
  `tests/wiring.test.js` and against the live backend signer.
- **`OfflineCore.drainOutbox`** batches the pending outbox to `POST /sync`,
  which is idempotent by `(tenant, op.id)`. Acknowledged ops are marked synced;
  network failures leave them pending for the next online beat. **No data is
  lost on a flaky connection.**

If the API is unreachable, every path falls back to the local/mock behaviour, so
the app keeps working offline. The client lives in `src/core/api.js`
(`window.LabOSApi`).

### Supabase backend

A ready-to-use **Supabase** backend ships in `supabase/`. Because the app only
ever calls `window.LabOSApi`, switching to Supabase is configuration, not a
rewrite: `src/core/supabase-adapter.js` implements the same interface against
Supabase (Postgres + Auth + Row-Level Security). Set:

```html
<script>
  window.LABOS_CONFIG = {
    supabaseUrl:     'https://YOUR_PROJECT.supabase.co',
    supabaseAnonKey: 'YOUR_PUBLIC_ANON_KEY'
  };
</script>
```

then apply the SQL in `supabase/migrations/` (tables, RLS policies, RPCs). The
full walkthrough — schema, multi-tenant isolation, role enforcement, the
referral-portal RPC, real-time, and storage — is in **`supabase/README.md`**.
With no config present the adapter is inert and the app stays in demo mode.

## Testing

Tests boot the **built bundle** inside jsdom (see `tests/harness.js`) and assert
real behaviour — this catches load-order, scope, and runtime errors a syntax
check cannot. Run them with `npm test`.

**245 tests passing** as of the latest build.

Coverage includes:

- **Boot smoke test** — the bundle loads, core globals are wired, the shell
  renders.
- **Regression** — tenant/catalogue data integrity, 79 help articles, all
  routes render, key modals open, offline outbox records/queues, licence
  sign/verify/tamper-rejection + device registration, patient filters, and
  section-icon lockstep.

---

## Important notes

- This is a **frontend with a simulated backend**. Persistence is in
  `localStorage`; multi-tenancy, sync, licence signing, and Paystack are
  mocked in the `src/core/` service layer. It is **not** production-secure on
  its own — a real
  backend (separate project) is required before handling real patient data.
- **Access is invite-only.** A user reaching the app for the first time lands
  on an activation gate (`renderOnboarding` step 1) offering three paths:
  1. **Redeem an activation code** — a lab admin enters the one-time code
     issued when their tenant was provisioned, plus a valid work email and a
     12+ character password. The wizard will not advance, and
     `completeOnboarding()` will not enter a tenant, until activation succeeds.
  2. **Explore the interactive demo** — loads the sample tenant and flags the
     session with `isDemoSession = true`. No code needed.
  3. **Sign in as platform administrator** — drops the operator into the
     platform super-admin view (`enterPlatformMode`). This is where codes come
     from (see below).
  The device licence is **no longer auto-registered on first run** — it binds
  only after an explicit entry decision (activation or demo).
- **Where activation codes come from (provisioning).** In the platform
  super-admin view, **Tenants → "+ Provision laboratory"** (`openProvisionTenant`)
  creates a tenant record and mints a one-time code via
  `LicenseCore.generateActivationCode()` (format `PREFIX-XXXX-YEAR`, e.g.
  `SUNRI-7F3K-2026`). The operator copies that code and hands it to the lab
  admin, who redeems it at the gate. Each tenant's code and its redemption
  status (`pending` / `Redeemed`) are shown in the tenants table. This closes
  the loop: provision → issue code → redeem → enter tenant (one-time code is
  then marked used).
  - **This client gate is a usability/clarity layer, not a security boundary.**
    All of it runs in the browser and can be bypassed with dev tools. Real
    authentication, activation-code minting/validation, and row-level tenant
    isolation **must** be enforced server-side (`labos-api`). The client calls
    `LabOSApi.validateActivation()` when a backend is configured and only falls
    back to the in-bundle mock (checking provisioned tenants in `APP_STATE`)
    when offline. The "Sign in as platform administrator" button is likewise an
    explicit door, not real auth — production would gate it behind a
    server-authenticated admin login.
- Chart.js is currently loaded from a CDN in `index.html`. It can be moved to
  the npm dependency and bundled when the module migration progresses.

© AgoroX Technologies. All rights reserved.
