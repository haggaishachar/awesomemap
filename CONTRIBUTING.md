# Contributing to awesomemap

Local development and contribution guide for awesomemap.

**Contributions here are code/platform contributions, not data
submissions.** Adding a project to a map is normally fully automated —
currently paused, see "How project data gets added" below — and a human
PR was never the way that happened, so please don't open one just to add
or nominate a project. If
you want to help, pick something from [`MVP.md`](MVP.md) (the current
priority shortlist) or [`product.md`](product.md) (the fuller backlog):
a feature, a bug fix, better test coverage, or a design/UX improvement.

## Contributing code

- Pick an item from `MVP.md`/`product.md`, or open an issue first if
  you're proposing something not already listed.
- `npm install && npm run dev` for local development (see "Develop"
  below); `npm test` before opening a PR.
- Open a PR against `master`. [`pr-check.yml`](.github/workflows/pr-check.yml)
  runs the test suite and a full site build automatically; a maintainer
  reviews once CI is green.

## Develop

    npm install
    npm run dev

Generates `dist/` from [awesomemap-data](https://github.com/haggaishachar/awesomemap-data)'s
public read API and serves it at http://localhost:5000. No setup required
— `AWESOMEMAP_DATA_API_URL` defaults to the live production API
(`https://awesomemap-data.haggai-shachar.workers.dev`); set it yourself to
point at a different deployment (e.g. a local `wrangler dev` instance of
that repo). Re-run `npm run dev` (or just `npm run generate`) to pick up
new upstream data or a local code change.

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
  `npm run generate` use — the local server serves `dist/` from `/`. The
  production site is served from the custom domain root
  (`https://awesomemap.dev/`, via the `CNAME` file described below), so
  the deploy workflow also leaves this `""`. If the site is ever moved
  back to a GitHub Pages *project* URL (`https://<user>.github.io/<repo>/`)
  instead, this must be set to `/<repo>` (case-sensitive to the repo's
  exact name) to match.
- `SITE_URL` — the absolute **origin only** (e.g. `https://awesomemap.dev`,
  no trailing slash), combined with `BASE_PATH` to build absolute URLs
  for `og:image`/`og:url`, which link-preview scrapers require. If
  `BASE_PATH` is ever non-empty (see above), don't also fold its path
  into `SITE_URL` — that would double it up (e.g.
  `/awesomemap/awesomemap/...`). Unset locally (relative URLs are fine
  for local dev); set by the deploy workflow in production.
- `CNAME` — when set, written verbatim into `dist/CNAME` so GitHub Pages
  keeps the custom domain configured on every deploy. Actions-based Pages
  publishing (as opposed to publishing from a branch) doesn't persist a
  custom domain any other way — GitHub reads it back out of the deployed
  artifact each time. Unset locally; set to `awesomemap.dev` by the
  deploy workflow.

This is an explicit, documented choice, not a hidden assumption — if you
fork this repo or serve it from a different path, set these env vars to
match your own deployment.

## How project data gets added

Project data (discovery, submissions, star-history snapshots) moved to a
separate private repo, [awesomemap-data](https://github.com/haggaishachar/awesomemap-data)
— this repo now only builds the site from its public API (see "Develop"
above). As part of that move, both automated pipelines that used to run
here are **currently paused**:

- **Automated discovery** now runs inside `awesomemap-data` on its own
  schedule, writing straight to its database — nothing left to wire up on
  this side.
- **On-site submission** (the [/submit/](https://awesomemap.dev/submit/)
  page → GitHub issue flow) is paused: the issue template and page still
  live here, but the workflow that used to process the resulting issue
  (`.github/workflows/submit-project.yml`) is disabled until a cross-repo
  trigger into `awesomemap-data` is designed. An opened "Suggest a
  project" issue currently sits unprocessed — this is tracked as a
  follow-up, not silently dropped.

**Fixing bad data** (a wrong category, a stale description, a typo) has
no public contribution path right now either — the data lives in
`awesomemap-data`, which is private. Open an issue describing the problem
in the meantime; a maintainer can fix it directly in that repo.

**Proposing a brand-new domain map** still goes through a
[New domain proposal](../../issues/new?template=new-domain-proposal.md)
issue — that's a structural/design decision, unaffected by any of the
above.

## Star history & Rising mode

Every domain map has a second sizing mode, "Rising," that sizes tiles by
star-growth velocity (7/30/90-day windows) instead of total star count.
This is entirely generated data — nothing here is hand-authored:

- Each project entity's `history` array is its star-count snapshot log —
  an array of `{ date, stars, forks, openIssues }` entries, pruned to the
  last 120 days — collected daily by `awesomemap-data`'s own scheduled
  workflow and fetched from its API at build time (see "Develop" above).
  There's no local snapshot job or manual-trigger command in this repo
  anymore.
- `scripts/generate.mjs` reads that history at build time and computes
  each project's `sizes` (`popular`, `rising7`, `rising30`, `rising90`),
  `hasEnoughHistory`, and `growth` fields via `scripts/velocity.mjs` —
  these never need to be set by hand.
- A brand-new project (or a brand-new domain) simply has no history yet;
  it renders in Rising mode with a "not enough history" marker until
  `awesomemap-data`'s daily snapshot job has run long enough to cover the
  selected window.

## Rising stars leaderboard

Every domain's Rising leaderboard is live on the site at `/rising/`
(global list plus one per domain), with short teasers on the landing page
and each domain page — the whole point of "Rising" is surfacing genuine
momentum a star count alone won't show yet.

One thing to expect: a newly-added project needs `windowDays + 1` days of
accumulated daily star snapshots (up to 91 days for the 90-day window)
before it can appear on any leaderboard — see "Star history & Rising
mode" above for how snapshots accumulate.
