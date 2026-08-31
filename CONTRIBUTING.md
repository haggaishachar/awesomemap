# Contributing to awesomemap

Local development and contribution guide for awesomemap.

**Contributions here are code/platform contributions, not data
submissions.** Adding a project to a map is fully automated (see "How
project data gets added" below) — a human PR is no longer the way that
happens, so please don't open one just to add or nominate a project. If
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

Generates `dist/` from `data/domains/` + `data/projects/` and serves it at
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

There is no manual "add a project" contribution path anymore — every
project on the site arrives through one of two fully automated pipelines,
neither of which waits on a maintainer:

- **Automated discovery.** A daily scheduled job
  (`.github/workflows/discovery.yml`, running `scripts/discover-projects.mjs`)
  looks for new candidates on its own, using the search topics and
  awesome-lists configured per domain in `data/discovery/sources.json`.
- **On-site submission.** Anyone can nominate a specific repo via the
  [/submit/](https://awesomemap.dev/submit/) page — no GitHub account
  gymnastics beyond opening the issue it redirects to. The moment that
  issue is opened (whether via the form or hand-filled from the
  [Suggest a project](.github/ISSUE_TEMPLATE/suggest-a-project.md)
  template), `.github/workflows/submit-project.yml` runs
  `scripts/process-submission.mjs` against it and **always closes the
  issue** with a comment explaining the outcome — committed, already
  present, or rejected and why — regardless of whether the issue was
  opened by the form or typed by hand.

Both pipelines share the same classification and commit logic
(`scripts/classify-candidates.mjs`, `scripts/apply-discoveries.mjs`):

- Every candidate is checked against a hard, objective quality bar first
  (500+ stars, not a fork/archived, has a license, pushed within the last
  12 months) — `scripts/discover-candidates.mjs`'s `passesQualityBar`.
  This runs before any LLM call, so no tokens are spent on a repo that
  wouldn't qualify anyway.
- A candidate that clears the bar is classified (OpenRouter, currently
  `google/gemini-3.7-flash`) into that domain's existing category tree —
  or, if none fits, the classifier's own suggested new category is
  created on the spot. A `fits: true` verdict is committed immediately;
  there is no confidence threshold, no daily cap, and no human-reviewed
  queue in between. A `fits: false` verdict is a real rejection and
  isn't reconsidered.
- A failure in the pipeline itself (an unparseable classification, a
  failed enrichment) is never treated as a rejection — it's simply left
  out of `data/discovery/seen.json` so a later run retries it
  automatically, no human intervention needed either way.
- The candidate's GitHub topics are fetched alongside its other metadata,
  both to help the classifier and to populate the committed entry's
  `tags` field automatically.

**Fixing bad data** (a wrong category, a stale description, a typo) is
still a normal hand-edited PR against `data/domains/<slug>.json` or
`data/projects/<owner>/<repo>.json` — see "Data layout" below for their
shape. **Proposing a brand-new domain map** (not an addition to an
existing one) also still goes through a
[New domain proposal](../../issues/new?template=new-domain-proposal.md)
issue and a follow-up PR, since that's a structural decision the
automated pipelines above never make on their own.

## Data layout

    data/
      domains/
        <slug>.json          # domain metadata + this domain's project membership
      projects/
        <owner>/<repo>.json  # one file per project, shared across every domain that references it

`data/domains/<slug>.json`:

    {
      "schemaVersion": 1,
      "slug": "<slug>",
      "name": "Display Name",
      "shortName": "Short Name",
      "description": "One-line description shown on the landing page.",
      "projects": [
        { "id": "owner/repo", "path": ["Category Name"] }
      ]
    }

- `id` and `path` are required on every membership entry, and `id` doubles
  as the project's GitHub repo — it's always `owner/repo` (github.com only,
  so the host isn't repeated per project). `path` is the breadcrumb of
  category names from root to the project (a single-level category is a
  one-element array; deeper nesting is a longer array).
- `id` must have a matching `data/projects/<owner>/<repo>.json` file —
  `generate.mjs` fails the build on a dangling reference.

`data/projects/<owner>/<repo>.json` — one file per project, holding
everything about the project itself (never duplicated across domains, even
when the same project is referenced from more than one):

    {
      "schemaVersion": 1,
      "id": "owner/repo",
      "link": "https://example.com",
      "name": "Some Project",
      "desc": "What it does.",
      "tags": [],
      "weight": 1000,
      "history": []
    }

- `name`, `desc`, `link`, `weight`, and `tags` may be omitted. `tags` is an
  array of strings (typically the repo's GitHub topics) shown alongside the
  project; the automated pipelines above fill it in from the candidate's
  GitHub topics automatically. For a project with no public GitHub repo,
  use any other unique string as `id`; it just won't be enriched (see
  below), so give it `weight` yourself.
- Logos aren't stored in this repo. Set `image` on the project to a direct
  URL into its source (e.g. a `raw.githubusercontent.com` link) and it's
  hotlinked as-is; `node scripts/enrich-domain.mjs data/domains/<slug>.json`
  fills this in automatically from the repo's logo file, when `id` is an
  owner/repo shorthand — it enriches every project entity that domain's
  membership list references.
- `githubName`/`githubDescription` (GitHub's own current name/description,
  for drift detection against the curated `name`/`desc` above) and
  `history` (the daily star/forks/open-issues snapshot log) are entirely
  generated — see "Star history & Rising mode" below.

Run `npm run generate` to confirm it builds before opening a PR.

## Star history & Rising mode

Every domain map has a second sizing mode, "Rising," that sizes tiles by
star-growth velocity (7/30/90-day windows) instead of total star count.
This is entirely generated data — nothing here is hand-authored:

- Each project entity's `history` array is its star-count snapshot log,
  written daily by `.github/workflows/snapshot-history.yml` (running
  `scripts/snapshot-history.mjs`) — an array of `{ date, stars, forks,
  openIssues }` entries, pruned to the last 120 days. The same run also
  upserts `githubName`/`githubDescription` from GitHub's current API
  response.
- `scripts/generate.mjs` reads that history at build time and computes
  each project's `sizes` (`popular`, `rising7`, `rising30`, `rising90`),
  `hasEnoughHistory`, and `growth` fields via `scripts/velocity.mjs` —
  these never need to be set by hand.
- A brand-new project (or a brand-new domain) simply has no history yet;
  it renders in Rising mode with a "not enough history" marker until the
  daily snapshot job has run long enough to cover the selected window.
- To manually trigger a snapshot run locally: `node
  scripts/snapshot-history.mjs` (requires `gh auth token`, same as
  `enrich-domain.mjs`).

## Rising stars leaderboard

Every domain's Rising leaderboard is live on the site at `/rising/`
(global list plus one per domain), with short teasers on the landing page
and each domain page — the whole point of "Rising" is surfacing genuine
momentum a star count alone won't show yet.

One thing to expect: a newly-added project needs `windowDays + 1` days of
accumulated daily star snapshots (up to 91 days for the 90-day window)
before it can appear on any leaderboard — see "Star history & Rising
mode" above for how snapshots accumulate.
