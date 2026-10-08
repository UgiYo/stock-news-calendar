# Cloudflare Pages API deployment

`functions/[[path]].js` is the Cloudflare Pages Functions entry point. It forwards requests to the same module Worker in `worker/index.js`, so the Pages API project supports the existing routes, including `/admin/login`, `/management`, OAuth, podcast, and stock APIs.

## Pages project settings

Configure the `news-calendar-api` Pages project as follows:

- Git repository: `UgiYo/stock-news-calendar`
- Production branch: `main`
- Root directory: repository root (`/`), so Cloudflare detects the root `functions/` directory
- Build command: `npm ci && npm run build`
- Build output directory: `dist`

After the change is merged, the connected Pages project should build a new production deployment from `main`. A `pages.dev` deployment alone is not sufficient if the project root is set to `worker/` or if it does not include this repository's `functions/` directory.

## Production bindings and settings

In the Pages project's Production settings, bind the existing D1 database using the exact binding name `DB` and select the existing `stock-news-calendar` database. Keep the same database used by the Worker so users, sessions, and management settings are shared.

Set the same runtime variables used by the Worker, at minimum:

- `APP_URL`: `https://ugiyo.github.io/stock-news-calendar/`
- `GOOGLE_CLIENT_ID`
- `GITHUB_REPO`: `UgiYo/stock-news-calendar`

Add these as Pages Production secrets (never as plain variables):

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `GOOGLE_CLIENT_SECRET`
- `COLLECTOR_SECRET`

Also copy any other runtime secrets/variables currently configured on the Worker, such as `GITHUB_DISPATCH_TOKEN`, if those API features are used. Pages and Workers do not share environment bindings automatically.

After changing Production bindings, trigger a new Pages deployment. The unauthenticated `GET /health` response reports missing runtime configuration; it should not be used as a credential check. A `POST /admin/login` with no credentials configured should return 503 with the explicit configuration message; invalid credentials return 401, and a successful login returns a session token.
