# Deploying GoPickle web to Cloudflare Pages

`web/` is a static Vite SPA, so Cloudflare Pages serves it from the free plan:
unlimited static requests, 100 GB/month bandwidth, 500 builds and 180 build
minutes per month.

The API it talks to is deployed separately — see `../GoPickleAPI/DEPLOY.md`.

## Create the project

Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** →
`adari2007/GoPickle`, then:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `web/dist` |
| Root directory | `/` (repo root) |

The root `package.json` `build` script installs and builds `web/` for you, so
the root directory stays at `/`.

## Environment variables

Under **Settings → Variables and Secrets**, add for the **Production**
environment (and Preview, if you use it):

```
VITE_API_BASE = https://<service>-<org>.koyeb.app
```

Vite inlines this at build time, so changing it requires a redeploy, not just a
restart. `web/.env.production` holds a fallback for local `npm run build`, but
the dashboard value wins on Pages.

`.node-version` at the repo root pins the build image to Node 20.

## Verify

```bash
curl -I https://<project>.pages.dev
```

Then open the site and confirm the network tab shows requests going to the
Koyeb URL, not `localhost:4000`.

## Notes

- `web/public/_redirects` rewrites every path to `index.html` so client-side
  views survive a hard refresh or a deep link.
- The Koyeb free instance sleeps after an hour idle, so the first request after
  a quiet period takes a few seconds. If that's annoying, hit `/health` on a
  schedule or move the API to a paid instance.
- The API sends `Access-Control-Allow-Origin: *` (`cors()` with no options in
  `GoPickleAPI/src/app.ts`), so no CORS config is needed for the Pages domain.
  Tighten it to the Pages origin if you ever add cookie-based auth.

## Mobile

`mobile/` is an Expo app and isn't deployed here. Set `EXPO_PUBLIC_API_BASE` to
the Koyeb URL in `mobile/.env` before building with EAS.
