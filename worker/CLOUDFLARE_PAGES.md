# Cloudflare Pages API deployment

The existing `news-calendar-api` project uses Cloudflare Pages Advanced Mode: it publishes a Worker bundle named `_worker.js` from the build output directory. Keep that deployment model and its `cloudflare-api` output directory. The previous copy-only command copied a stale `worker/worker-bundle.js` that did not contain the admin login route.

## Pages project settings

Configure the connected Pages project:

- Git repository: `UgiYo/stock-news-calendar`
- Production branch: `main`
- Root directory: leave blank (repository root)
- Build command: `npm ci && node scripts/build_cloudflare_pages.mjs`
- Build output directory: `cloudflare-api`

This command bundles the current `worker/index.js` and its route modules into `cloudflare-api/_worker.js` on every build. Advanced Mode uses this `_worker.js`; the root `functions/` directory is ignored in Advanced Mode. When the commit is merged to `main`, the connected Pages project should start a production deployment automatically.

## Production bindings and settings

In the Pages project's Production settings, bind the existing D1 database using the exact binding name `DB` and select the existing `stock-news-calendar` database. Keep the same database used by the Worker so users, sessions, and management settings are shared.

Copy the runtime variables and secrets that are currently configured on the Worker into the Pages project's Production environment. At minimum:

Variables:
- `APP_URL`: `https://ugiyo.github.io/stock-news-calendar/`
- `GOOGLE_CLIENT_ID`
- `GITHUB_REPO`: `UgiYo/stock-news-calendar`

Secrets:
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `GOOGLE_CLIENT_SECRET`
- `COLLECTOR_SECRET`
- `GITHUB_DISPATCH_TOKEN` (if the API uses it)

Pages and Workers do not share environment bindings automatically. If Google OAuth will use the Pages API hostname, add `https://news-calendar-api.pages.dev/auth/callback` (or the project's actual custom domain callback) to the Google OAuth client's authorized redirect URIs.

After changing Production bindings, trigger a new Pages deployment. A `POST /admin/login` with missing admin credentials should return 503 with a configuration message; invalid credentials return 401; successful credentials return a session token. Do not paste secrets into GitHub Actions variables or commit them to the repository.
