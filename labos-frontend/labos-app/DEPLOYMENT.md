# Deploying LabOS to Cloudflare Pages

LabOS is a static single-page app. Cloudflare Pages serves it globally with
zero servers to manage. There are two ways to deploy: the dashboard (Git
integration, recommended) and the CLI.

> **Before you deploy:** decide whether this is a **demo deployment** (no
> backend — safe, public, no real data) or a **production deployment** (wired to
> Supabase with real patient data). Keep them as two separate Pages projects.
> Do not point a public demo at a live patient database until tenant isolation
> has been verified. See `supabase/README.md`.

---

## Option A — Dashboard (Git integration, recommended)

1. Push this repository to GitHub (or GitLab).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.
3. Select your repository.
4. Set the build configuration:

   | Setting | Value |
   |---|---|
   | Framework preset | None (or Vite) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | `labos-app` *(only if the repo root is one level above this folder)* |

5. Add an environment variable so the build uses Node 22:

   | Variable | Value |
   |---|---|
   | `NODE_VERSION` | `22` |

6. **Save and Deploy.** Cloudflare runs `npm install && npm run build` and
   publishes `dist/`. Every push to your production branch redeploys; pull
   requests get preview URLs automatically.

That's the whole demo deployment. You get a `*.pages.dev` URL immediately, and
can attach a custom domain under **Custom domains**.

## Option B — CLI (one-off or CI)

```bash
cd labos-app
npm install
npm run build
npx wrangler pages deploy dist --project-name labos-frontend
```

`wrangler.toml` already declares `pages_build_output_dir = "dist"`.

---

## What's already configured for you

- **`public/_redirects`** — `/* /index.html 200`. LabOS routes are client-side,
  so every path (and every browser refresh on a deep link) serves `index.html`.
  Without this, a refresh on a sub-route would 404.
- **`public/_headers`** — security headers (HSTS, `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) plus
  cache rules: hashed `/assets/*` are cached for a year (immutable), while the
  app bundle revalidates each load so updates ship instantly.
- **`.nvmrc`** — pins Node 22 for the build.

These files live in `public/` and Vite copies them into `dist/` on every build,
so Cloudflare picks them up automatically.

---

## Turning on the Supabase backend (production)

The demo deployment needs no configuration. To wire a deployment to Supabase:

1. In `src/index.html`, fill in the `window.LABOS_CONFIG` block with your
   project URL and **anon** key (never the service-role key):

   ```html
   <script>
     window.LABOS_CONFIG = {
       supabaseUrl:     'https://YOUR_PROJECT.supabase.co',
       supabaseAnonKey: 'YOUR_PUBLIC_ANON_KEY'
     };
   </script>
   ```

2. Commit and let Cloudflare redeploy.

Because the anon key is safe to expose (Row-Level Security is what actually
protects the data), it can live in the committed HTML. If you prefer to keep it
out of source, inject the `LABOS_CONFIG` script at deploy time instead.

> **Recommended:** use one Pages project for the demo (no config) and a second
> for production (Supabase config), each on its own branch and domain. That way
> a demo can never accidentally touch real patient data.

---

## Post-deploy checklist

- [ ] The `*.pages.dev` URL loads and the onboarding screen appears.
- [ ] A browser refresh on any in-app screen still loads (SPA redirect working).
- [ ] Custom domain attached and HTTPS active.
- [ ] (Production only) Supabase configured, and you have verified — by signing
      in as two different tenants — that neither can see the other's data.
- [ ] (Production only) First tenant + admin created (see `supabase/README.md`).
