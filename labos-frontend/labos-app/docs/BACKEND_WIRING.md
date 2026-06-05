# Running the Clinical Laboratory slice against real PostgreSQL

The frontend now talks to the real backend for the result lifecycle. To run it
live end-to-end:

## 1. Bring up the backend + database

```bash
cd labos-api
npm install
createdb labos                      # or your managed Postgres
export DATABASE_URL=postgres://labos_app:secret@localhost:5432/labos
npm run keygen ./keys               # licence signing keypair
cp .env.example .env                # set DATABASE_URL, JWT_SECRET, key paths
npm run migrate                     # applies migrations/001..005
npm run seed                        # plans + demo tenant tnt_vitalis + admin
npm start                           # API on :8080
```

Seeded admin login: `ade@vitalisdiagnostics.com` / `ChangeMe123!`.

## 2. Point the frontend at the API

Set the API base before the bundle loads (e.g. in `src/index.html`, or inject
at deploy time):

```html
<script>window.LABOS_CONFIG = { apiBase: 'http://localhost:8080' };</script>
```

Then authenticate so `LabOSApi.isAuthed()` is true:

```js
await LabOSApi.login('ade@vitalisdiagnostics.com', 'ChangeMe123!', 'tnt_vitalis');
```

## 3. What happens when you release results

With `apiBase` set and a logged-in user, `validateResult` / `releaseResult`
call `pushResultsToBackend`, which for each analyte:

1. `POST /results` — enters the row (server computes/stores the flag).
2. `POST /results/:id/validate` — second-person validation (role-gated:
   MED_LAB_SCIENTIST / PATHOLOGIST / LAB_DIRECTOR).
3. `POST /results/:id/release` — releases the row (PATHOLOGIST / LAB_DIRECTOR).

If the network is down or the API is unreachable, the local result is still
saved and the op stays in the OfflineCore outbox for retry — the UI never
blocks. This is the same offline-first contract the rest of the app uses.

## Contract guarantee

The field names the frontend sends (`requestId`, `testCode`, `value`, `unit`,
`referenceLow`, `referenceHigh`) match the backend's `POST /results` handler
exactly. This is locked by the test
`tests/wiring.test.js → "wires release to the real backend with the correct
request shapes"`, so a future rename on either side breaks the test rather than
silently breaking production.

## Note on this sandbox

The wiring code and contract tests are complete, but a live Postgres run could
not be performed in the build sandbox (no database available, and Postgres is
not installable there). Run the steps above in your environment to exercise the
full INSERT/UPDATE path against a real database.
