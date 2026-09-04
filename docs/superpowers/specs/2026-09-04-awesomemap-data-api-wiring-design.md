# awesomemap: wire the build to awesomemap-data's read API (Part A)

## Context

`awesomemap` (this repo, public) used to own its full data pipeline:
`data/domains/*.json` + `data/projects/**/*.json` on disk, populated by
scheduled/event-driven GitHub Actions (`discovery.yml`,
`snapshot-history.yml`, `social-digest.yml`, `submit-project.yml`) running
scripts in `scripts/`.

That pipeline has been split out into a separate private repo,
[`awesomemap-data`](https://github.com/haggaishachar/awesomemap-data): a
Cloudflare Worker (`src/`) backed by D1, exposing a public unauthenticated
read API and a token-gated internal write API, with its own ported copies
of the collection/snapshot/aggregation scripts and its own equivalents of
`discovery.yml`, `snapshot-history.yml`, and `social-digest.yml` already
running on schedule against D1.

`awesomemap-data`'s own README documents three "known gaps" it deliberately
left for this repo to close:

1. This repo's build still reads local `data/` files instead of calling the
   deployed API.
2. `social-digest`'s README-risers update needs a cross-repo path (the
   README lives here, the leaderboard math lives there).
3. `process-submission`'s trigger needs a cross-repo path (the "Suggest a
   project" issue lives here, the processing script lives there).

This spec covers gap 1 only — **Part A: core read-API wiring** — plus
retiring the GitHub Actions workflows that are now fully redundant or newly
broken as a result. Gaps 2 and 3 are **Part B**, a follow-up spec, because
both need a cross-repo auth design (PAT vs. `repository_dispatch`) that
doesn't fall out of Part A's changes.

The live deployed Worker is `https://awesomemap-data.haggai-shachar.workers.dev`
(public read routes confirmed responding). This repo's GitHub Actions
secrets already include `AWESOMEMAP_DATA_API_URL` and
`AWESOMEMAP_DATA_INTERNAL_TOKEN` (set ahead of this work).

## Goals

- `npm run generate` (and therefore `npm run dev`, `pr-check.yml`, and
  `deploy.yml`) builds the site from `awesomemap-data`'s API instead of
  local `data/` files.
- Zero-config for external contributors: `npm run dev` and `pr-check.yml`
  (which runs on fork PRs, where repo secrets aren't available) work
  without any env var set, against live public production data.
- No dead or silently-broken code left behind: anything that only makes
  sense against local `data/` files is removed, not left to fail quietly.
- The 4 workflows that either are fully superseded or would now break are
  disabled (`workflow_dispatch`-only), not deleted — Part B picks them back
  up.

## Non-goals

- Re-wiring `social-digest.yml` or `submit-project.yml` to work end-to-end
  again (Part B).
- Any change inside `awesomemap-data` itself.
- API key/auth gating for the public read API (already tracked as a
  separate future item in `awesomemap-data`'s own README).

## Design

### 1. `scripts/data-store.mjs`

Replace the fs-based implementation with a read-only HTTP client, matching
`awesomemap-data/scripts/data-store.mjs`'s exported names/shapes so
callers barely change:

- `loadAllDomains()` → `GET /domains`, sorted by slug (same contract as
  today).
- `loadAllProjectEntities()` → `GET /projects`, returned as a `Map` keyed
  by `id` (same contract as today).
- `joinDomainProjects(domain, entitiesById)` — pure, unchanged.
- `SCHEMA_VERSION` — unchanged.

Both loaders become `async`. No `loadProjectEntity`/`loadDomain`
(single-item reads) or any `save*`/write function — nothing in this repo
writes data anymore, so there's no reason to carry write plumbing or
`AWESOMEMAP_DATA_INTERNAL_TOKEN` handling here at all.

Base URL resolution:

    function baseUrl() {
      return (process.env.AWESOMEMAP_DATA_API_URL ?? "https://awesomemap-data.haggai-shachar.workers.dev").replace(/\/$/, "");
    }

The hardcoded default (rather than requiring the env var) is deliberate:
`pr-check.yml` runs on `pull_request`, including from forks, and GitHub
does not expose repo secrets to fork-PR runs. A contributor's PR check —
and their local `npm run dev` — must work with zero configuration against
real public data.

### 2. `scripts/generate.mjs`

Add `await` to the two Pass 1 calls:

    const rawDomains = await loadAllDomains();
    const projectEntities = await loadAllProjectEntities();

Top-level `await` is fine (this repo is `"type": "module"`, run via
`node scripts/generate.mjs` directly, no bundler).

### 3. Delete now-redundant code

- `data/` (`domains/`, `projects/`, `discovery/`) in its entirety — D1 is
  the source of truth now.
- Scripts whose only job was maintaining `data/` and which
  `awesomemap-data` already has fully HTTP-wired equivalents of:
  `discover-projects.mjs`, `discover-candidates.mjs`,
  `classify-candidates.mjs`, `enrich-domain.mjs`, `apply-discoveries.mjs`,
  `snapshot-history.mjs`, `snapshot-events.mjs`, `process-submission.mjs`,
  `social-digest.mjs` — and their tests (`discover-candidates.test.js`,
  `classify-candidates.test.js`, `enrich-domain.test.js`,
  `apply-discoveries.test.js`, `snapshot-history.test.js`,
  `snapshot-events.test.js`, `process-submission.test.js`,
  `social-digest.test.js`).
  - `process-submission.mjs` and `social-digest.mjs` are included here
    (not just the 7 pure-collection scripts) because both import
    `saveProjectEntity`/`saveDomain` or otherwise depend on the fs-based
    `data-store.mjs` contract the new read-only client won't provide;
    leaving them in place would break `npm test` (an ESM import of a
    removed named export throws at module load, before any test body
    runs) even though their workflows are disabled. Part B rewrites
    whatever cross-repo-trigger-side script this repo ends up needing, if
    any — `awesomemap-data` already owns the actual logic.
- **Not** deleted: `scripts/project-events.mjs` — a pure function
  (`sortedEvents`) that `generate.mjs`/`render-page.mjs` actually calls at
  render time for the project timeline; it never touched `data/` or
  `data-store.mjs` directly. Keeps its test.

### 4. Workflows

Disable (remove the scheduling/event trigger, keep `workflow_dispatch:`,
add an explanatory comment pointing at `awesomemap-data` and this spec) —
do not delete the files:

- `discovery.yml` — fully superseded, `awesomemap-data` runs its own copy.
- `snapshot-history.yml` — fully superseded, `awesomemap-data` runs its
  own copy.
- `social-digest.yml` — its script is deleted (step 3); would fail on
  every run either way until Part B.
- `submit-project.yml` — its script is deleted (step 3); would fail on
  every run either way until Part B.

`workflow_dispatch` is left in place as a harmless placeholder (it won't
actually run successfully post-deletion, but keeps the workflow visible
and easy for Part B to re-populate) rather than stripped to nothing.

Update the 2 workflows that keep running:

- `deploy.yml` — add `AWESOMEMAP_DATA_API_URL: ${{ secrets.AWESOMEMAP_DATA_API_URL }}`
  to the build job's `env`, for explicit control even though it currently
  resolves to the same value as the hardcoded default.
- `pr-check.yml` — no change; relies on the hardcoded default (see §1).

### 5. Docs

**`README.md`**: the "Counts grow daily as the [discovery
workflow](.github/workflows)" line references a now-disabled workflow;
update or remove it.

**`CONTRIBUTING.md`** — several sections describe the now-removed local
pipeline and need rewriting, not just a find/replace:

- **"Develop"**: "Generates `dist/` from `data/domains/` + `data/projects/`"
  → generates from the `awesomemap-data` API (mention the env var and that
  it defaults to live production data, no setup required).
- **"How project data gets added"**: both pipelines it describes
  (automated discovery, on-site submission) are paused as of this change —
  say so plainly, with a pointer to this spec / Part B, rather than
  describing machinery that's currently dark.
- **"Fixing bad data"** (the hand-edited-PR-against-`data/domains/...`
  path) and the entire **"Data layout"** section: this path no longer
  exists in this repo — there's no `data/` here to PR against anymore.
  Replace with a short note that data now lives in the private
  `awesomemap-data` repo and that a public correction path is a known gap
  (tracked for Part B or later, not silently dropped).
- **"Star history & Rising mode"**: references `snapshot-history.yml`/
  `scripts/snapshot-history.mjs` living here and a local manual-trigger
  command; both are gone. Update to say history is collected by
  `awesomemap-data`'s own scheduled job and fetched via the API at build
  time — this repo has no manual-trigger equivalent anymore.
- **"Rising stars leaderboard"**: no `data/`-specific claims, likely
  unaffected — verify during implementation.

## Testing

- `npm test` passes with the 9 dead scripts' tests removed and nothing
  else newly broken (no dangling imports of removed `data-store.mjs`
  exports anywhere in `scripts/`).
- `npm run generate` (no env vars set) succeeds and produces a `dist/`
  whose content matches current production (spot-check a domain page's
  project count/rising numbers against the live site).
- `npm run dev` serves that `dist/` at `localhost:5000` with zero
  configuration.
- `AWESOMEMAP_DATA_API_URL` override still works (point it at a bogus URL
  and confirm the build fails with a clear fetch error, not a silent empty
  build).

## Risks / follow-ups

- Manual data corrections (typo in a description, wrong category) have no
  public contribution path once `data/` is gone, until Part B or later —
  called out in CONTRIBUTING.md rather than silently dropped.
- `discovery.yml`/`snapshot-history.yml`/`social-digest.yml`/
  `submit-project.yml`'s `workflow_dispatch` entry points won't actually
  succeed if manually triggered post-deletion (their scripts are gone) —
  acceptable since they're disabled, but worth knowing if someone goes
  looking.
