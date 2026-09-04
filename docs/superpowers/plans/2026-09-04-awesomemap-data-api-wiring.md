# Wire awesomemap's build to awesomemap-data's read API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point this repo's site build at `awesomemap-data`'s deployed HTTP API instead of the local `data/` directory, remove the code that's now fully redundant with that repo, and disable the 4 GitHub Actions workflows that are either superseded or would otherwise start failing.

**Architecture:** `scripts/data-store.mjs` changes from an fs-reader of `data/domains/*.json` + `data/projects/**/*.json` into a small read-only HTTP client against `awesomemap-data`'s public `/domains` and `/projects` routes, defaulting to the live deployed Worker so local dev and fork-PR checks work with zero configuration. `scripts/generate.mjs` awaits the now-async loader calls. Everything that only existed to maintain local `data/` (7 collection/snapshot scripts, plus `process-submission.mjs`/`social-digest.mjs` which depend on the fs write functions being removed) is deleted, along with `data/` itself and their tests. The 4 workflows this breaks or fully supersedes are disabled (trigger removed, `workflow_dispatch` kept as a placeholder), not deleted.

**Tech Stack:** Node.js (`"type": "module"`, ESM, `node --test`), no bundler, static site generator (`scripts/generate.mjs`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-04-awesomemap-data-api-wiring-design.md`

## Global Constraints

- `AWESOMEMAP_DATA_API_URL` default (when unset): `https://awesomemap-data.haggai-shachar.workers.dev` — required so `pr-check.yml` (which runs on fork PRs, where repo secrets aren't available) and local `npm run dev` both work with zero configuration.
- `scripts/data-store.mjs` exports only read functions after this change: `loadAllDomains`, `loadAllProjectEntities`, `joinDomainProjects`, `SCHEMA_VERSION`. No `save*`, no `loadProjectEntity`/`loadDomain`, no `AWESOMEMAP_DATA_INTERNAL_TOKEN` handling.
- The 4 workflows (`discovery.yml`, `snapshot-history.yml`, `social-digest.yml`, `submit-project.yml`) are disabled by removing their `schedule:`/`issues:` trigger and keeping `workflow_dispatch:` — never delete the files.
- `npm test` must pass after every task in this plan.

---

## Task 1: Delete the now-redundant local data pipeline

`awesomemap-data` already has fully HTTP-wired equivalents of every script below (see the spec's §3). Deleting them here — rather than leaving them to break later when `data-store.mjs` loses its write functions in Task 2 — keeps every intermediate commit's `npm test` green.

**Files:**
- Delete: `data/` (entire directory: `domains/`, `projects/`, `discovery/`)
- Delete: `scripts/discover-projects.mjs`, `scripts/discover-candidates.mjs`, `scripts/classify-candidates.mjs`, `scripts/enrich-domain.mjs`, `scripts/apply-discoveries.mjs`, `scripts/snapshot-history.mjs`, `scripts/snapshot-events.mjs`, `scripts/process-submission.mjs`, `scripts/social-digest.mjs`
- Delete: `test/discover-candidates.test.js`, `test/classify-candidates.test.js`, `test/enrich-domain.test.js`, `test/apply-discoveries.test.js`, `test/snapshot-history.test.js`, `test/snapshot-events.test.js`, `test/process-submission.test.js`, `test/social-digest.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a repo where `scripts/data-store.mjs` (still fs-based, unmodified in this task) has exactly one remaining consumer — `scripts/generate.mjs` — which Task 2/3 build on.

- [ ] **Step 1: Confirm nothing outside the files being deleted references them**

Run:
```bash
grep -rln "discover-projects\|discover-candidates\|classify-candidates\|enrich-domain\|apply-discoveries\|snapshot-history\|snapshot-events\|process-submission\|social-digest" scripts/ test/ app/ .github/ --include="*.mjs" --include="*.js" | grep -v -E "scripts/(discover-projects|discover-candidates|classify-candidates|enrich-domain|apply-discoveries|snapshot-history|snapshot-events|process-submission|social-digest)\.mjs|test/(discover-candidates|classify-candidates|enrich-domain|apply-discoveries|snapshot-history|snapshot-events|process-submission|social-digest)\.test\.js"
```
Expected: no output from `scripts/`/`test/`/`app/` (matches in `.github/workflows/*.yml` are expected and handled in Task 4 — this grep excludes `.yml` by only including `.mjs`/`.js`, so ignore those).

- [ ] **Step 2: Delete the data directory and the 9 dead scripts + their 8 tests**

```bash
git rm -r data/
git rm scripts/discover-projects.mjs scripts/discover-candidates.mjs scripts/classify-candidates.mjs scripts/enrich-domain.mjs scripts/apply-discoveries.mjs scripts/snapshot-history.mjs scripts/snapshot-events.mjs scripts/process-submission.mjs scripts/social-digest.mjs
git rm test/discover-candidates.test.js test/classify-candidates.test.js test/enrich-domain.test.js test/apply-discoveries.test.js test/snapshot-history.test.js test/snapshot-events.test.js test/process-submission.test.js test/social-digest.test.js
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — every remaining test file is self-contained or depends only on files that still exist (`scripts/data-store.mjs` itself is untouched in this task, so `test/data-store.test.js`'s existing `projectFilePath`/`joinDomainProjects` tests still pass as-is).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete data/ and the local pipeline scripts moved to awesomemap-data"
```

---

## Task 2: Rewrite `scripts/data-store.mjs` as a read-only HTTP client

**Files:**
- Modify: `scripts/data-store.mjs` (full rewrite)
- Modify: `test/data-store.test.js` (full rewrite)

**Interfaces:**
- Consumes: nothing from other tasks (Task 1 only needed to happen first so no dead script's import breaks).
- Produces: `loadAllDomains({fetchImpl}?) => Promise<Array<Domain>>` (sorted by slug), `loadAllProjectEntities({fetchImpl}?) => Promise<Map<string, ProjectEntity>>`, `joinDomainProjects(domain, entitiesById) => Array<ProjectEntity & {path}>` (sync, pure, unchanged behavior), `SCHEMA_VERSION = 1` — these 4 names are what Task 3's `generate.mjs` change imports.

- [ ] **Step 1: Write the failing test**

Replace `test/data-store.test.js` entirely with:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAllDomains, loadAllProjectEntities, joinDomainProjects, SCHEMA_VERSION } from "../scripts/data-store.mjs";

process.env.AWESOMEMAP_DATA_API_URL = "http://example.test";

/** Records every call and replays canned responses in order. */
function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url) => {
    calls.push({ url });
    const next = queue.shift();
    if (!next) throw new Error(`fakeFetch: no response queued for ${url}`);
    return { ok: next.status < 400, status: next.status, statusText: next.statusText ?? "", json: async () => next.body, text: async () => JSON.stringify(next.body) };
  };
  return { fetchImpl, calls };
}

test("SCHEMA_VERSION is 1", () => {
  assert.equal(SCHEMA_VERSION, 1);
});

test("loadAllDomains fetches /domains and sorts by slug", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body: [{ slug: "web-dev", projects: [] }, { slug: "automation", projects: [] }] }]);
  const domains = await loadAllDomains({ fetchImpl });
  assert.deepEqual(domains.map((d) => d.slug), ["automation", "web-dev"]);
  assert.equal(calls[0].url, "http://example.test/domains");
});

test("loadAllProjectEntities fetches /projects into a Map keyed by id", async () => {
  const { fetchImpl } = fakeFetch([{ status: 200, body: [{ id: "facebook/react", name: "React" }] }]);
  const byId = await loadAllProjectEntities({ fetchImpl });
  assert.equal(byId.get("facebook/react").name, "React");
});

test("joinDomainProjects merges each membership entry's path onto its project entity", () => {
  const domain = {
    slug: "web-dev",
    projects: [
      { id: "facebook/react", path: ["Frontend Frameworks"] },
      { id: "vuejs/core", path: ["Frontend Frameworks"] },
    ],
  };
  const entitiesById = new Map([
    ["facebook/react", { id: "facebook/react", name: "React", weight: 247895 }],
    ["vuejs/core", { id: "vuejs/core", name: "Vue", weight: 54250 }],
  ]);

  const joined = joinDomainProjects(domain, entitiesById);

  assert.deepEqual(joined, [
    { id: "facebook/react", name: "React", weight: 247895, path: ["Frontend Frameworks"] },
    { id: "vuejs/core", name: "Vue", weight: 54250, path: ["Frontend Frameworks"] },
  ]);
});

test("joinDomainProjects throws on a membership id with no matching entity", () => {
  const domain = { slug: "web-dev", projects: [{ id: "ghost/repo", path: ["Nowhere"] }] };
  assert.throws(() => joinDomainProjects(domain, new Map()), /"ghost\/repo" has no project entity/);
});

test("a failing (non-ok) response throws with status and body text", async () => {
  const { fetchImpl } = fakeFetch([{ status: 500, statusText: "Internal Server Error", body: { error: "boom" } }]);
  await assert.rejects(loadAllDomains({ fetchImpl }), /500/);
});

test("loadAllDomains defaults to the live production API when AWESOMEMAP_DATA_API_URL is unset", async () => {
  const original = process.env.AWESOMEMAP_DATA_API_URL;
  delete process.env.AWESOMEMAP_DATA_API_URL;
  try {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: [] }]);
    await loadAllDomains({ fetchImpl });
    assert.equal(calls[0].url, "https://awesomemap-data.haggai-shachar.workers.dev/domains");
  } finally {
    process.env.AWESOMEMAP_DATA_API_URL = original;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/data-store.test.js`
Expected: FAIL — the still-fs-based `data-store.mjs` doesn't export a `loadAllDomains` that calls `fetchImpl` (it reads from the now-deleted `data/` directory and returns `[]` without ever touching `fetchImpl`), so `calls[0]` is `undefined` and the first HTTP-shaped test throws a `TypeError`.

- [ ] **Step 3: Write the implementation**

Replace `scripts/data-store.mjs` entirely with:

```javascript
// Read-only HTTP client for awesomemap-data's public API — the site's
// build (generate.mjs) is the only consumer, replacing the old fs-based
// version that read data/domains/*.json + data/projects/**/*.json
// directly. See
// docs/superpowers/specs/2026-09-04-awesomemap-data-api-wiring-design.md.
//
// Mirrors the exported names/shapes of awesomemap-data's own
// scripts/data-store.mjs (loadAllDomains, loadAllProjectEntities,
// joinDomainProjects, SCHEMA_VERSION) but read-only — nothing in this
// repo writes data anymore, so there's no save*/write plumbing or
// internal-token handling here.
//
// Configuration: AWESOMEMAP_DATA_API_URL (base URL of the deployed
// Worker), defaulting to the live production API. The default matters:
// pr-check.yml runs on pull_request, including from forks, and GitHub
// does not expose repo secrets to fork-PR runs — local dev and fork-PR
// checks both need this to work with zero configuration.

export const SCHEMA_VERSION = 1;

function baseUrl() {
  return (process.env.AWESOMEMAP_DATA_API_URL ?? "https://awesomemap-data.haggai-shachar.workers.dev").replace(/\/$/, "");
}

async function apiFetch(path, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${baseUrl()}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText} ${text}`.trim());
  }
  return res.json();
}

/** Loads every domain (with its membership list), sorted by slug. */
export async function loadAllDomains({ fetchImpl } = {}) {
  const domains = (await apiFetch("/domains", { fetchImpl })) ?? [];
  return [...domains].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Loads every project entity (full — including tags/history/events) into a Map keyed by id. */
export async function loadAllProjectEntities({ fetchImpl } = {}) {
  const projects = (await apiFetch("/projects", { fetchImpl })) ?? [];
  return new Map(projects.map((entity) => [entity.id, entity]));
}

/**
 * Joins a domain's membership list against the full project-entity map,
 * returning one merged object per project — every entity field plus that
 * domain's own `path` for this project. Pure. Throws on a dangling
 * reference (a membership id with no entity), the same "fail loudly on
 * bad data" convention the pre-split repo used.
 */
export function joinDomainProjects(domain, entitiesById) {
  return domain.projects.map(({ id, path }) => {
    const entity = entitiesById.get(id);
    if (!entity) {
      throw new Error(`domain "${domain.slug}": project "${id}" has no project entity`);
    }
    return { ...entity, path };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/data-store.test.js`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS. `scripts/generate.mjs` is not itself exercised by `node --test` (no test file imports it), so its now-stale non-`await`ed calls to `loadAllDomains()`/`loadAllProjectEntities()` don't affect `npm test` — they only break `npm run generate`, which Task 3 fixes. Do not run `npm run generate` as part of this task; that verification belongs to Task 3 Step 2.

- [ ] **Step 6: Commit**

```bash
git add scripts/data-store.mjs test/data-store.test.js
git commit -m "feat: replace fs-based data-store.mjs with a read-only HTTP client"
```

---

## Task 3: Await the new async loaders in `scripts/generate.mjs`

**Files:**
- Modify: `scripts/generate.mjs:53-54` (the two Pass 1 loader calls)

**Interfaces:**
- Consumes: `loadAllDomains`, `loadAllProjectEntities` from Task 2's `scripts/data-store.mjs` (both now return `Promise`s).
- Produces: a working `npm run generate` — the deliverable every later task's docs/workflow changes describe.

- [ ] **Step 1: Locate and update the two calls**

In `scripts/generate.mjs`, find:

```javascript
const rawDomains = loadAllDomains();
const projectEntities = loadAllProjectEntities();
```

Replace with:

```javascript
const rawDomains = await loadAllDomains();
const projectEntities = await loadAllProjectEntities();
```

(Top-level `await` is valid here — this file is run directly via `node scripts/generate.mjs`, not bundled, and `package.json` has `"type": "module"`.)

- [ ] **Step 2: Run the generator against live production data**

Run: `npm run generate`
Expected: succeeds, no `AWESOMEMAP_DATA_API_URL` set, hits the default production API. Confirm `dist/` was produced:
```bash
ls dist/ | head
```
Expected: non-empty, includes `index.html` and one directory per domain slug (e.g. `data-science/`, `security/`, ...).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate.mjs
git commit -m "fix: await the now-async data-store loaders in generate.mjs"
```

---

## Task 4: Disable the 4 superseded/broken workflows, update `deploy.yml`

**Files:**
- Modify: `.github/workflows/discovery.yml`
- Modify: `.github/workflows/snapshot-history.yml`
- Modify: `.github/workflows/social-digest.yml`
- Modify: `.github/workflows/submit-project.yml`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: nothing (independent of Tasks 1-3's code, but logically follows them — the workflow bodies below reference scripts deleted in Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Disable `discovery.yml`'s trigger**

In `.github/workflows/discovery.yml`, replace:

```yaml
on:
  schedule:
    - cron: "0 7 * * *"
  workflow_dispatch:
```

with:

```yaml
# Disabled: project discovery moved to the private awesomemap-data repo,
# which runs its own copy of this workflow against D1 directly. See
# docs/superpowers/specs/2026-09-04-awesomemap-data-api-wiring-design.md.
# scripts/discover-projects.mjs no longer exists in this repo, so
# workflow_dispatch is left as a placeholder only — triggering it
# manually will fail at the "node scripts/discover-projects.mjs" step.
on:
  workflow_dispatch:
```

Leave the rest of the file (permissions, concurrency, jobs) untouched.

- [ ] **Step 2: Disable `snapshot-history.yml`'s trigger**

In `.github/workflows/snapshot-history.yml`, replace:

```yaml
on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:
```

with:

```yaml
# Disabled: star-history snapshotting moved to the private awesomemap-data
# repo, which runs its own copy of this workflow against D1 directly. See
# docs/superpowers/specs/2026-09-04-awesomemap-data-api-wiring-design.md.
# scripts/snapshot-history.mjs and scripts/snapshot-events.mjs no longer
# exist in this repo, so workflow_dispatch is left as a placeholder only.
on:
  workflow_dispatch:
```

- [ ] **Step 3: Disable `social-digest.yml`'s trigger**

In `.github/workflows/social-digest.yml`, replace:

```yaml
on:
  schedule:
    - cron: "0 8 * * 1"
  workflow_dispatch:
```

with:

```yaml
# Disabled: scripts/social-digest.mjs was deleted in favor of
# awesomemap-data's own HTTP-wired copy, which currently only opens the
# digest issue there (it no longer has a README to update). Re-wiring
# this repo's README-risers update against awesomemap-data's API is
# deferred — see "Part B" in
# docs/superpowers/specs/2026-09-04-awesomemap-data-api-wiring-design.md.
on:
  workflow_dispatch:
```

- [ ] **Step 4: Disable `submit-project.yml`'s trigger**

In `.github/workflows/submit-project.yml`, replace:

```yaml
on:
  issues:
    types: [opened]
```

with:

```yaml
# Disabled: scripts/process-submission.mjs was deleted in favor of
# awesomemap-data's own HTTP-wired copy, which needs a cross-repo trigger
# from this repo's "Suggest a project" issues — deferred to "Part B", see
# docs/superpowers/specs/2026-09-04-awesomemap-data-api-wiring-design.md.
# An opened "Suggest a project" issue currently sits unprocessed.
on:
  workflow_dispatch:
```

(This file's `if: contains(github.event.issue.labels.*.name, 'discovery')` job-level condition references `github.event.issue`, which won't exist on a `workflow_dispatch` run — that's fine, the job will just evaluate the condition false and skip, which is the desired "disabled" behavior. Leave it as-is.)

- [ ] **Step 5: Wire `AWESOMEMAP_DATA_API_URL` into `deploy.yml`**

In `.github/workflows/deploy.yml`, find the `build` job's `env:` block:

```yaml
    env:
      # Served from the custom domain root (see CNAME below), not a
      # `/awesomemap` project-page subpath, so BASE_PATH stays empty.
      BASE_PATH: ""
      SITE_URL: https://awesomemap.dev
      # Written into dist/CNAME so GitHub Pages keeps the custom domain
      # configured across Actions-based deploys (it isn't persisted any
      # other way for workflow-based publishing).
      CNAME: awesomemap.dev
```

Add `AWESOMEMAP_DATA_API_URL`:

```yaml
    env:
      # Served from the custom domain root (see CNAME below), not a
      # `/awesomemap` project-page subpath, so BASE_PATH stays empty.
      BASE_PATH: ""
      SITE_URL: https://awesomemap.dev
      # Written into dist/CNAME so GitHub Pages keeps the custom domain
      # configured across Actions-based deploys (it isn't persisted any
      # other way for workflow-based publishing).
      CNAME: awesomemap.dev
      # Explicit even though it currently matches data-store.mjs's
      # hardcoded default — keeps production deploys independently
      # controllable (e.g. pointing at a staging awesomemap-data
      # deployment) without a code change.
      AWESOMEMAP_DATA_API_URL: ${{ secrets.AWESOMEMAP_DATA_API_URL }}
```

- [ ] **Step 6: Validate YAML syntax for all 5 files**

Run:
```bash
for f in .github/workflows/discovery.yml .github/workflows/snapshot-history.yml .github/workflows/social-digest.yml .github/workflows/submit-project.yml .github/workflows/deploy.yml; do
  node -e "require('node:child_process').execSync('npx --yes js-yaml ' + process.argv[1], {stdio:'inherit'})" "$f" 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$f"
done
```
Expected: no errors printed for any file. (If neither `js-yaml` nor `python3`'s `yaml` module is available, visually re-check each file's indentation instead — the `on:` blocks above must line up exactly as shown, 2-space indented under `on:`.)

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS (workflow YAML changes don't touch any Node code, but the plan's Global Constraints require confirming this after every task).

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/discovery.yml .github/workflows/snapshot-history.yml .github/workflows/social-digest.yml .github/workflows/submit-project.yml .github/workflows/deploy.yml
git commit -m "chore: disable the 4 workflows superseded by awesomemap-data, wire deploy.yml's API URL"
```

---

## Task 5: Update `README.md` and `CONTRIBUTING.md`

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: nothing (documentation only, no test coverage depends on this repo's docs text — verified during research: no test file references `README.md`/`CONTRIBUTING.md` content).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update `README.md`'s discovery-workflow claim**

Find:

```markdown
More domains are on the way. Counts grow daily as the [discovery workflow](.github/workflows) finds and classifies new projects.
```

Replace with:

```markdown
More domains are on the way. Project data is now maintained via [awesomemap-data](https://github.com/haggaishachar/awesomemap-data); counts here reflect the latest deploy.
```

- [ ] **Step 2: Update CONTRIBUTING.md's intro paragraph**

Find:

```markdown
**Contributions here are code/platform contributions, not data
submissions.** Adding a project to a map is fully automated (see "How
project data gets added" below) — a human PR is no longer the way that
happens, so please don't open one just to add or nominate a project. If
```

Replace with:

```markdown
**Contributions here are code/platform contributions, not data
submissions.** Adding a project to a map is normally fully automated —
currently paused, see "How project data gets added" below — and a human
PR was never the way that happened, so please don't open one just to add
or nominate a project. If
```

- [ ] **Step 3: Rewrite the "Develop" section**

Find:

```markdown
## Develop

    npm install
    npm run dev

Generates `dist/` from `data/domains/` + `data/projects/` and serves it at
http://localhost:5000. Re-run `npm run dev` (or just `npm run generate`)
after editing any data file to regenerate.
```

Replace with:

```markdown
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
```

- [ ] **Step 4: Rewrite "How project data gets added" and remove "Data layout"**

Find the entire span from `## How project data gets added` through the end of the `## Data layout` section (i.e. everything up to, but not including, `## Star history & Rising mode`) — this is `CONTRIBUTING.md`'s current lines 75-190, starting with:

```markdown
## How project data gets added

There is no manual "add a project" contribution path anymore — every
```

and ending with:

```markdown
Run `npm run generate` to confirm it builds before opening a PR.
```

Replace that entire span with:

```markdown
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
```

- [ ] **Step 5: Rewrite "Star history & Rising mode"**

Find:

```markdown
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
```

Replace with:

```markdown
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
```

- [ ] **Step 6: Verify the "Rising stars leaderboard" section needs no change**

Run:
```bash
grep -n "data/" CONTRIBUTING.md
```
Expected: no output (confirms no remaining stale `data/` references anywhere in the file, including the untouched "Rising stars leaderboard" section).

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS (docs-only changes, but the plan's Global Constraints require confirming this after every task).

- [ ] **Step 8: Commit**

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs: update README/CONTRIBUTING for the awesomemap-data API split"
```

---

## Task 6: End-to-end verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: the complete working state from Tasks 1-5.
- Produces: nothing (terminal task).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, no skipped/broken imports.

- [ ] **Step 2: Build with zero configuration and spot-check content**

```bash
unset AWESOMEMAP_DATA_API_URL
npm run generate
grep -o "ggerganov/llama.cpp" dist/artificial-intelligence/index.html
```
Expected: build succeeds; the grep finds a match — `ggerganov/llama.cpp` is a project confirmed present in production's `artificial-intelligence` domain (verified directly against the live API's `/domains` response during design), embedded in the page's `<script type="application/json" id="map-data">` block. A match confirms the build actually pulled real production data, not an empty/stubbed response.

- [ ] **Step 3: Local dev server**

```bash
npm run dev &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/
kill %1
```
Expected: `200`.

- [ ] **Step 4: Confirm a misconfigured API URL fails loudly, not silently**

```bash
AWESOMEMAP_DATA_API_URL=http://127.0.0.1:1 npm run generate; echo "exit code: $?"
```
Expected: non-zero exit code, with a fetch/connection error message — not a silently empty `dist/`.

- [ ] **Step 5: Confirm no leftover references to deleted paths**

```bash
grep -rn "data/domains\|data/projects\|data/discovery" scripts/ test/ app/ README.md CONTRIBUTING.md
```
Expected: no output.

- [ ] **Step 6: Rebuild once more with the real default before finishing**

```bash
npm run generate
```
Expected: succeeds — leaves the repo's `dist/` in the same good state Step 2 already confirmed, undoing Step 4's deliberately-broken env var for any further manual poking around.
