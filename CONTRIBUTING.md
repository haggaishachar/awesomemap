# Contributing to awesomemap

Local development and contribution guide for awesomemap.

## Develop

    npm install
    npm run dev

Generates `dist/` from `data/*.json` and serves it at
http://localhost:5000. Re-run `npm run dev` (or just `npm run generate`)
after editing any data file to regenerate.

## Test

    npm test

## Deploy

Deployment is automatic: pushing to `master` triggers
`.github/workflows/deploy.yml`, which runs the generator and publishes
`dist/` to GitHub Pages. The repository's Pages source must be set to
"GitHub Actions" in Settings → Pages (one-time setup, not part of the
workflow file).

Generated pages emit their own URLs (stylesheet, scripts, image paths,
inter-page links, `og:image`/`og:url`), so the generator needs to know
where the site is actually served from:

- `BASE_PATH` — the path prefix under which the site is served. Defaults
  to `""` (the domain root), which is what local `npm run dev`/
  `npm run generate` use — the local server serves `dist/` from `/`.
  `haggaishachar/awesomemap` is a GitHub Pages *project* site, so it's
  served at `https://haggaishachar.github.io/awesomemap/`, not at the
  domain root — the deploy workflow sets `BASE_PATH=/awesomemap` to
  match. GitHub Pages project-site paths are case-sensitive to the
  repo's exact name, so this must match the repo name's casing exactly
  if the repo is ever renamed again.
- `SITE_URL` — the absolute **origin only** (e.g.
  `https://haggaishachar.github.io`, no `/awesomemap` suffix and no
  trailing slash), combined with `BASE_PATH` to build absolute URLs for
  `og:image`/`og:url`, which link-preview scrapers require. Don't
  include the `/awesomemap` path in `SITE_URL` itself — it's already
  added via `BASE_PATH`, and including it in both would produce a
  doubled `/awesomemap/awesomemap/...` URL. Unset locally (relative
  URLs are fine for local dev); set by the deploy workflow in
  production.

This is an explicit, documented choice, not a hidden assumption — if you
fork this repo or serve it from a different path, set these env vars to
match your own deployment.

## Adding a new map

Add `data/<slug>.json`:

    {
      "slug": "<slug>",
      "name": "Display Name",
      "description": "One-line description shown on the landing page.",
      "tools": [
        {
          "id": "owner/repo",
          "path": ["Category Name"],
          "name": "Some Tool",
          "link": "https://example.com",
          "desc": "What it does.",
          "weight": 1000
        }
      ]
    }

- `id` and `path` are required on every tool, and `id` doubles as the
  tool's GitHub repo — it's always `owner/repo` (github.com only, so the
  host isn't repeated per tool), no full URL. For a tool with no public
  GitHub repo, use any other unique string as `id`; it just won't be
  enriched (see below), so give it `weight` yourself. `path` is the
  breadcrumb of category names from root to the tool (a single-level
  category is a one-element array; deeper nesting is a longer array).
- `name`, `desc`, `link`, and `weight` may be omitted.
- Logos aren't stored in this repo. Set `image` on the tool to a direct
  URL into its source (e.g. a `raw.githubusercontent.com` link) and it's
  hotlinked as-is; `node scripts/enrich-domain.mjs data/<slug>.json` fills
  this in automatically from the repo's logo file, when `id` is an
  owner/repo shorthand.

Run `npm run generate` to confirm it builds before opening a PR.
