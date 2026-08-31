# Contributing to awesomemap

Local development and contribution guide for awesomemap.

## Contribution flow

Project data is split across two directories (see "Data layout" below):
`data/domains/<slug>.json` (which map(s) a project appears in, and where)
and `data/projects/<owner>/<repo>.json` (the project's own metadata,
one file per project, shared across every domain that references it).

- **Adding a project already curated elsewhere to another map:** open a PR
  adding `{ "id": "owner/repo", "path": [...] }` to the target
  `data/domains/<slug>.json` — no need to touch `data/projects/`, its
  metadata already exists.
- **Adding a brand-new project:** open a PR that both adds the membership
  entry above *and* creates `data/projects/<owner>/<repo>.json` (see
  "Adding a new map" below for its shape).
- **Proposing a brand-new domain map:** open a
  [New domain proposal](../../issues/new?template=new-domain-proposal.md)
  issue first — a two-minute form covering the domain, its rough
  categories, and why it fits. This keeps the site from ending up with a
  pile of overlapping, half-finished maps; most reasonable proposals get
  a quick go-ahead. Once it's green-lit, follow up with a PR adding
  `data/domains/<new-slug>.json`.

[`pr-check.yml`](.github/workflows/pr-check.yml) runs the test suite and a
full site build on every PR automatically — it catches malformed JSON,
missing `id`/`path`, duplicate slugs, a dangling membership reference (no
matching `data/projects/` file), and broken builds before a human ever
needs to look. A maintainer reviews for fit/quality once CI is green.

Either way, the data files are the only thing a contribution PR usually
touches — the site's rendering code, tests, and CI are unaffected by a
data-only PR, so there's no way a project or map submission can break
anything outside its own file(s).

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
  `generate.mjs` fails the build on a dangling reference. A project already
  curated into another domain already has one; a brand-new project needs
  one created (below).

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
  project; the automated discovery job (see below) fills it in from the
  candidate's GitHub topics automatically. For a project with no public
  GitHub repo, use any other unique string as `id`; it just won't be
  enriched (see below), so give it `weight` yourself.
- Logos aren't stored in this repo. Set `image` on the project to a direct
  URL into its source (e.g. a `raw.githubusercontent.com` link) and it's
  hotlinked as-is; `node scripts/enrich-domain.mjs data/domains/<slug>.json`
  fills this in automatically from the repo's logo file, when `id` is an
  owner/repo shorthand — it enriches every project entity that domain's
  membership list references.
- `githubName`/`githubDescription` (GitHub's own current name/description,
  for drift detection against the curated `name`/`desc` above) and
  `history` (the daily star/forks/open-issues snapshot log) are entirely
  generated — see "Star history & Rising mode" below. Leave `history` as
  `[]` for a new project.

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
and each domain page — this is a good reason to add smaller, newer
projects, not just already-popular ones: the whole point of "Rising" is
surfacing genuine momentum a star count alone won't show yet. Keep the
same quality bar as any other addition (real, maintained, fits the
category) — size just isn't a gate.

One thing to expect: a newly-added project needs `windowDays + 1` days of
accumulated daily star snapshots (up to 91 days for the 90-day window)
before it can appear on any leaderboard — see "Star history & Rising
mode" above for how snapshots accumulate. Don't expect immediate results.

## Automated project discovery

A daily scheduled job (`.github/workflows/discovery.yml`, running
`scripts/discover-projects.mjs`) looks for new candidate projects on its
own, using the search topics and awesome-lists configured per domain in
`data/discovery/sources.json`. Every candidate is checked against a
quality bar (500+ stars, not a fork/archived, has a license, pushed
within the last 12 months) before an LLM (OpenRouter, currently
`google/gemini-3.7-flash`) classifies it into that domain's existing
category tree. The candidate's GitHub topics are fetched alongside its
other metadata, both to help the classifier and to populate the
auto-committed entry's `tags` field.

- A candidate the classifier is confident about (an existing category
  fit, ≥80% confidence) is auto-committed directly, up to 3 per domain
  per day — no PR, no human review, unlike every other addition described
  above. This is a deliberate, bounded exception to this doc's normal
  "every addition gets a human-reviewed PR" rule.
- Everything else that passed the quality bar — low confidence, a
  suggested new category, or capped-out overflow — lands in a daily
  "🔍 Discovery review" GitHub issue instead. Nothing is silently
  discarded and no category is ever auto-created; a maintainer turns a
  wanted candidate into a normal contribution PR.
- A candidate is only ever evaluated once (tracked in
  `data/discovery/seen.json`); an ignored review-issue candidate won't
  reappear the next day, so the issue itself is the durable record if you
  want to revisit it later.
