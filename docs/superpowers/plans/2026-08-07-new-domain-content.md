# New Domain Content (Web Dev, DevOps & Infra, Security, Mobile Dev) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four new domain maps (`web-dev`, `devops-infra`, `security`, `mobile-dev`) to techmap, each populated with real, notable open-source tools, real GitHub star counts as `weight`, and best-effort logos sourced only from each tool's own repo.

**Architecture:** No generator/schema code changes — `scripts/generate.mjs` already auto-discovers every `data/*.json` file. This plan (a) builds a small reusable enrichment script that fills in `weight` (live GitHub star count) and downloads an in-repo logo when one exists, then (b) curates and enriches each of the four domain files in turn, then (c) validates the whole site builds and renders correctly.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`, native `fetch`), `gh` CLI (already authenticated in this environment, used only to mint an API token — no other `gh` subcommands are invoked), GitHub REST API (`api.github.com`).

## Global Constraints

- Only real, notable open-source projects with a public GitHub repo — no invented or placeholder tools. (spec: Scope per domain)
- ~8-10 categories, ~4-6 tools per category, ~40-50 tools per domain. (spec: Scope per domain)
- `path` is a single-element array (flat, one category level), matching `data-science.json`'s existing convention. (spec: Data fields)
- `weight` is the tool's real, current GitHub star count (integer), fetched live via the GitHub API — never estimated. (spec: Data fields)
- Logo sourcing only from the tool's own repo, via the fixed candidate-path list below; skip (fallback icon applies) if none found. Never substitute an icon-pack or favicon-service image. (spec: Logo sourcing)
- Tool `id` must be unique within each domain file.
- Domain slugs/names/descriptions are fixed (see Task 2-5 headers below).

**Logo candidate paths (in order, first match wins):**
```
logo.svg, logo.png
assets/logo.svg, assets/logo.png
docs/logo.svg, docs/logo.png
docs/assets/logo.svg, docs/assets/logo.png
.github/logo.svg, .github/logo.png
brand/logo.svg, brand/logo.png
```

---

### Task 1: Domain enrichment script

**Files:**
- Create: `scripts/enrich-domain.mjs`
- Test: `test/enrich-domain.test.js`

**Interfaces:**
- Produces: `parseGhRepo(url)` → `{ owner, repo }` or `null`.
- Produces: `LOGO_CANDIDATE_PATHS` → `string[]`, the 12 paths listed above, in that order.
- Produces: `async enrichTool(tool, { getJson, downloadFile })` → returns a new tool object; `tool.weight` is set from `getJson`'s repo response when `tool.gh` parses as a GitHub URL; `downloadFile` is called at most once, with `(rawUrl, destPath)`, when a logo candidate resolves; original `tool` fields are preserved.
  - `getJson(url)` — injected async function, `(url) => Promise<object>`; must throw an object with a `status` property on non-2xx responses (mirrors `fetch` + manual status check, not native `fetch` rejection behavior).
  - `downloadFile(url, destPath)` — injected async function, `(url, destPath) => Promise<void>`.
- Consumes: nothing from other tasks (first task).

- [ ] **Step 1: Write failing tests for `parseGhRepo`**

```js
// test/enrich-domain.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGhRepo, LOGO_CANDIDATE_PATHS, enrichTool } from "../scripts/enrich-domain.mjs";

test("parseGhRepo extracts owner/repo from a plain github.com URL", () => {
  assert.deepEqual(parseGhRepo("https://github.com/scikit-learn/scikit-learn"), {
    owner: "scikit-learn",
    repo: "scikit-learn",
  });
});

test("parseGhRepo strips a trailing slash", () => {
  assert.deepEqual(parseGhRepo("https://github.com/facebook/react/"), {
    owner: "facebook",
    repo: "react",
  });
});

test("parseGhRepo strips a trailing .git", () => {
  assert.deepEqual(parseGhRepo("https://github.com/facebook/react.git"), {
    owner: "facebook",
    repo: "react",
  });
});

test("parseGhRepo ignores subpaths beyond owner/repo", () => {
  assert.deepEqual(parseGhRepo("https://github.com/facebook/react/tree/main/packages"), {
    owner: "facebook",
    repo: "react",
  });
});

test("parseGhRepo returns null for a non-github.com URL", () => {
  assert.equal(parseGhRepo("https://gitlab.com/foo/bar"), null);
});

test("parseGhRepo returns null for a malformed URL", () => {
  assert.equal(parseGhRepo("not a url"), null);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test`
Expected: FAIL — `../scripts/enrich-domain.mjs` does not exist yet.

- [ ] **Step 3: Implement `parseGhRepo` and `LOGO_CANDIDATE_PATHS`**

```js
// scripts/enrich-domain.mjs
export const LOGO_CANDIDATE_PATHS = [
  "logo.svg",
  "logo.png",
  "assets/logo.svg",
  "assets/logo.png",
  "docs/logo.svg",
  "docs/logo.png",
  "docs/assets/logo.svg",
  "docs/assets/logo.png",
  ".github/logo.svg",
  ".github/logo.png",
  "brand/logo.svg",
  "brand/logo.png",
];

/**
 * Extracts { owner, repo } from a github.com repo URL. Tolerates a
 * trailing slash, a trailing .git, and subpaths beyond owner/repo
 * (e.g. /tree/main/packages). Returns null for anything else.
 */
export function parseGhRepo(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com") return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const [owner, repoRaw] = segments;
  const repo = repoRaw.endsWith(".git") ? repoRaw.slice(0, -4) : repoRaw;
  if (!owner || !repo) return null;
  return { owner, repo };
}
```

- [ ] **Step 4: Run the tests to confirm `parseGhRepo` passes**

Run: `npm test`
Expected: PASS for all `parseGhRepo` tests; `enrichTool`/`LOGO_CANDIDATE_PATHS` import still resolves since both are now exported.

- [ ] **Step 5: Write failing tests for `enrichTool`**

Append to `test/enrich-domain.test.js`:

```js
function fakeGetJson({ repoStars, contentsByPath }) {
  return async (url) => {
    const contentsMatch = Object.keys(contentsByPath).find((p) => url.endsWith(`/contents/${p}`));
    if (contentsMatch) {
      const entry = contentsByPath[contentsMatch];
      if (!entry) {
        const err = new Error("Not Found");
        err.status = 404;
        throw err;
      }
      return entry;
    }
    return { stargazers_count: repoStars };
  };
}

test("enrichTool sets weight from the repo's star count", async () => {
  const tool = { id: "react", gh: "https://github.com/facebook/react" };
  const getJson = fakeGetJson({ repoStars: 12345, contentsByPath: {} });
  const downloads = [];
  const downloadFile = async (url, dest) => downloads.push({ url, dest });

  const result = await enrichTool(tool, { getJson, downloadFile });

  assert.equal(result.weight, 12345);
  assert.equal(result.id, "react");
  assert.deepEqual(downloads, []);
});

test("enrichTool downloads the first matching logo candidate", async () => {
  const tool = { id: "react", gh: "https://github.com/facebook/react" };
  const getJson = fakeGetJson({
    repoStars: 12345,
    contentsByPath: {
      "logo.svg": null,
      "logo.png": { type: "file", download_url: "https://raw.githubusercontent.com/facebook/react/main/logo.png" },
    },
  });
  const downloads = [];
  const downloadFile = async (url, dest) => downloads.push({ url, dest });

  const result = await enrichTool(tool, { getJson, downloadFile }, "data/web-dev/images");

  assert.equal(result.weight, 12345);
  assert.deepEqual(downloads, [
    {
      url: "https://raw.githubusercontent.com/facebook/react/main/logo.png",
      dest: "data/web-dev/images/react.png",
    },
  ]);
});

test("enrichTool downloads nothing when no candidate path exists", async () => {
  const tool = { id: "react", gh: "https://github.com/facebook/react" };
  const getJson = fakeGetJson({ repoStars: 12345, contentsByPath: {} });
  const downloads = [];
  const downloadFile = async (url, dest) => downloads.push({ url, dest });

  const result = await enrichTool(tool, { getJson, downloadFile }, "data/web-dev/images");

  assert.equal(result.weight, 12345);
  assert.deepEqual(downloads, []);
});

test("enrichTool leaves a tool with no gh URL unchanged", async () => {
  const tool = { id: "unlisted", desc: "no repo" };
  const getJson = async () => {
    throw new Error("should not be called");
  };
  const downloadFile = async () => {
    throw new Error("should not be called");
  };

  const result = await enrichTool(tool, { getJson, downloadFile });

  assert.deepEqual(result, tool);
});
```

- [ ] **Step 6: Run the tests to confirm the new ones fail**

Run: `npm test`
Expected: FAIL — `enrichTool` not defined.

- [ ] **Step 7: Implement `enrichTool`**

```js
// scripts/enrich-domain.mjs (append)

/**
 * Given a tool and injected I/O functions, returns a new tool object with
 * `weight` set to its GitHub repo's live star count, and (as a side
 * effect) downloads the first matching logo candidate — if any — to
 * `<imagesDir>/<tool.id>.<ext>`. Tools without a parseable `gh` URL are
 * returned unchanged; no network calls are made for them.
 */
export async function enrichTool(tool, { getJson, downloadFile }, imagesDir) {
  const repo = parseGhRepo(tool.gh);
  if (!repo) return tool;

  const repoData = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
  const enriched = { ...tool, weight: repoData.stargazers_count };

  for (const path of LOGO_CANDIDATE_PATHS) {
    let entry;
    try {
      entry = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${path}`);
    } catch (err) {
      if (err.status === 404) continue;
      throw err;
    }
    if (entry && entry.type === "file" && entry.download_url) {
      const ext = path.slice(path.lastIndexOf("."));
      await downloadFile(entry.download_url, `${imagesDir}/${tool.id}${ext}`);
      break;
    }
  }

  return enriched;
}
```

- [ ] **Step 8: Run the tests to confirm they pass**

Run: `npm test`
Expected: PASS — all `enrich-domain.test.js` tests green, and the pre-existing suite (`build-tree`, `layout`, `render-page`, `resolve-image`) still passes.

- [ ] **Step 9: Implement the CLI entry point (not unit tested — real I/O)**

Append to `scripts/enrich-domain.mjs`:

```js
// CLI entry point: node scripts/enrich-domain.mjs data/<slug>.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

async function main() {
  const domainPath = process.argv[2];
  if (!domainPath) {
    console.error("Usage: node scripts/enrich-domain.mjs data/<slug>.json");
    process.exit(1);
  }

  const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const imagesDir = domainPath.replace(/\.json$/, "/images");
  mkdirSync(imagesDir, { recursive: true });

  const getJson = async (url) => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      const err = new Error(`${res.status} ${res.statusText} for ${url}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  };

  const downloadFile = async (url, dest) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
  };

  const domain = JSON.parse(readFileSync(domainPath, "utf8"));
  let starsFetched = 0;
  let logosFound = 0;
  const enrichedTools = [];

  for (const tool of domain.tools) {
    const before = new Set(readdirSync(imagesDir));
    const enriched = await enrichTool(tool, { getJson, downloadFile }, imagesDir);
    if (enriched.weight !== undefined) starsFetched += 1;
    const after = new Set(readdirSync(imagesDir));
    if (after.size > before.size) logosFound += 1;
    enrichedTools.push(enriched);
  }

  writeFileSync(domainPath, JSON.stringify({ ...domain, tools: enrichedTools }, null, 2) + "\n");
  console.log(`${domainPath}: ${starsFetched}/${domain.tools.length} weights fetched, ${logosFound} logos downloaded`);
}

main();
```

`imagesDir` is created with `mkdirSync(..., { recursive: true })` above, so it always exists by the time the loop's `readdirSync(imagesDir)` calls run.

- [ ] **Step 10: Manually verify the CLI against one real tool**

Create a throwaway file to test against real GitHub data without touching real domain data yet:

```bash
mkdir -p /tmp/enrich-smoke-test
cat > /tmp/enrich-smoke-test/smoke.json <<'EOF'
{
  "slug": "smoke",
  "name": "Smoke Test",
  "description": "test",
  "tools": [
    { "id": "react", "path": ["Test"], "gh": "https://github.com/facebook/react", "link": "https://react.dev", "name": "React", "desc": "test" }
  ]
}
EOF
node scripts/enrich-domain.mjs /tmp/enrich-smoke-test/smoke.json
cat /tmp/enrich-smoke-test/smoke.json
ls /tmp/enrich-smoke-test/images 2>/dev/null
rm -rf /tmp/enrich-smoke-test
```

Expected: console line reporting `1/1 weights fetched`, `smoke.json`'s `react` tool now has a `weight` that's a large positive integer, and (if `facebook/react` has one of the candidate logo files — check manually if unsure) an image file appears under `images/`.

- [ ] **Step 11: Commit**

```bash
git add scripts/enrich-domain.mjs test/enrich-domain.test.js
git commit -m "Add domain enrichment script: live star counts + in-repo logo sourcing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Web Dev domain

**Files:**
- Create: `data/web-dev.json`
- Create: `data/web-dev/images/` (populated by the enrichment script, not by hand)

**Interfaces:**
- Consumes: `scripts/enrich-domain.mjs` CLI from Task 1 (`node scripts/enrich-domain.mjs data/web-dev.json`).
- Produces: `data/web-dev.json`, discovered automatically by `scripts/generate.mjs` (no other task depends on its content, but Task 6's site-wide validation reads it).

**Domain metadata:**
- `slug`: `web-dev`
- `name`: `Best Web Development Open Source Tools`
- `description`: `Frontend frameworks, build tools, styling, backend frameworks, and more.`

**Required categories** (use these exact category names as `path` values; do not add, drop, or rename categories):
1. Frontend Frameworks
2. Meta-Frameworks
3. Build Tools & Bundlers
4. CSS Frameworks & Styling
5. Backend Frameworks
6. State Management
7. Testing
8. Static Site Generators
9. API & Data Layer
10. UI Component Libraries

- [ ] **Step 1: Curate the tool list**

Write `data/web-dev.json` by hand, following the exact shape of `data/data-science.json` (read it first for the schema). For each of the 10 categories above, pick 4-6 real, notable open-source web development tools with a public GitHub repo. Requirements:
- Every tool needs `id`, `path` (`["<Category Name>"]`), `name`, `gh`, `link`, `desc`. Omit `weight` — Step 2 fills it in.
- `id` must be unique within this file.
- Only include a tool if you're confident its GitHub repo is real and public — do not guess a repo URL.
- `desc` is one short sentence, in the same style as `data-science.json`'s (e.g. "Machine Learning in Python").

- [ ] **Step 2: Enrich with real star counts and logos**

Run: `node scripts/enrich-domain.mjs data/web-dev.json`
Expected: console output shows `N/N weights fetched` where `N` equals the total tool count (if fewer, one or more `gh` URLs failed to resolve — fix those URLs and re-run before continuing). Some non-zero number of logos may be downloaded into `data/web-dev/images/`; zero is acceptable.

- [ ] **Step 3: Check for duplicate ids**

Run: `node -e "const d = JSON.parse(require('fs').readFileSync('data/web-dev.json','utf8')); const ids = d.tools.map(t => t.id); const dupes = ids.filter((id, i) => ids.indexOf(id) !== i); if (dupes.length) { console.error('Duplicate ids:', dupes); process.exit(1); } console.log(ids.length, 'unique ids');"`
Expected: prints the tool count with no duplicate-id error. Fix any duplicates in `data/web-dev.json` and re-run if it fails.

- [ ] **Step 4: Validate the build**

Run: `npm run generate`
Expected: exits 0, no thrown error referencing `web-dev`.

- [ ] **Step 5: Commit**

```bash
git add data/web-dev.json data/web-dev/
git commit -m "Add Web Dev domain content

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: DevOps & Infra domain

**Files:**
- Create: `data/devops-infra.json`
- Create: `data/devops-infra/images/` (populated by the enrichment script, not by hand)

**Interfaces:**
- Consumes: `scripts/enrich-domain.mjs` CLI from Task 1.
- Produces: `data/devops-infra.json`.

**Domain metadata:**
- `slug`: `devops-infra`
- `name`: `Best DevOps & Infrastructure Open Source Tools`
- `description`: `Containers, orchestration, CI/CD, infrastructure as code, observability, and more.`

**Required categories:**
1. Containers
2. Container Orchestration
3. CI/CD
4. Infrastructure as Code
5. Configuration Management
6. Monitoring & Observability
7. Logging
8. Service Mesh
9. GitOps
10. Package & Artifact Management

- [ ] **Step 1: Curate the tool list**

Same process as Task 2 Step 1, applied to these 10 categories. Write `data/devops-infra.json`.

- [ ] **Step 2: Enrich with real star counts and logos**

Run: `node scripts/enrich-domain.mjs data/devops-infra.json`
Expected: same as Task 2 Step 2, substituting `devops-infra`.

- [ ] **Step 3: Check for duplicate ids**

Run: `node -e "const d = JSON.parse(require('fs').readFileSync('data/devops-infra.json','utf8')); const ids = d.tools.map(t => t.id); const dupes = ids.filter((id, i) => ids.indexOf(id) !== i); if (dupes.length) { console.error('Duplicate ids:', dupes); process.exit(1); } console.log(ids.length, 'unique ids');"`
Expected: same as Task 2 Step 3.

- [ ] **Step 4: Validate the build**

Run: `npm run generate`
Expected: exits 0, no thrown error referencing `devops-infra`.

- [ ] **Step 5: Commit**

```bash
git add data/devops-infra.json data/devops-infra/
git commit -m "Add DevOps & Infra domain content

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Security domain

**Files:**
- Create: `data/security.json`
- Create: `data/security/images/` (populated by the enrichment script, not by hand)

**Interfaces:**
- Consumes: `scripts/enrich-domain.mjs` CLI from Task 1.
- Produces: `data/security.json`.

**Domain metadata:**
- `slug`: `security`
- `name`: `Best Security Open Source Tools`
- `description`: `Scanning, exploitation, SIEM, secrets management, forensics, and more.`

**Required categories:**
1. Network Scanning & Recon
2. Vulnerability Scanning
3. Web App Security
4. Exploitation Frameworks
5. SIEM & Threat Detection
6. Password & Credential Auditing
7. Static & Dynamic Analysis
8. Secrets Management
9. Container & Cloud Security
10. Forensics & Reverse Engineering

- [ ] **Step 1: Curate the tool list**

Same process as Task 2 Step 1, applied to these 10 categories. Write `data/security.json`. These are legitimate, well-known open-source security research/testing tools (e.g. network scanners, SIEM platforms, static analyzers) — the same class of project already covered by security review and pentesting tooling documentation; do not substitute in unrelated or fictional projects.

- [ ] **Step 2: Enrich with real star counts and logos**

Run: `node scripts/enrich-domain.mjs data/security.json`
Expected: same as Task 2 Step 2, substituting `security`.

- [ ] **Step 3: Check for duplicate ids**

Run: `node -e "const d = JSON.parse(require('fs').readFileSync('data/security.json','utf8')); const ids = d.tools.map(t => t.id); const dupes = ids.filter((id, i) => ids.indexOf(id) !== i); if (dupes.length) { console.error('Duplicate ids:', dupes); process.exit(1); } console.log(ids.length, 'unique ids');"`
Expected: same as Task 2 Step 3.

- [ ] **Step 4: Validate the build**

Run: `npm run generate`
Expected: exits 0, no thrown error referencing `security`.

- [ ] **Step 5: Commit**

```bash
git add data/security.json data/security/
git commit -m "Add Security domain content

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Mobile Dev domain

**Files:**
- Create: `data/mobile-dev.json`
- Create: `data/mobile-dev/images/` (populated by the enrichment script, not by hand)

**Interfaces:**
- Consumes: `scripts/enrich-domain.mjs` CLI from Task 1.
- Produces: `data/mobile-dev.json`.

**Domain metadata:**
- `slug`: `mobile-dev`
- `name`: `Best Mobile Development Open Source Tools`
- `description`: `Cross-platform frameworks, native tooling, testing, state management, and more.`

**Required categories:**
1. Cross-Platform Frameworks
2. Native Android Libraries
3. Native iOS Libraries
4. Backend-as-a-Service
5. Testing
6. UI Component Libraries
7. State Management
8. Navigation
9. CI/CD & Distribution
10. Analytics & Crash Reporting

- [ ] **Step 1: Curate the tool list**

Same process as Task 2 Step 1, applied to these 10 categories. Write `data/mobile-dev.json`.

- [ ] **Step 2: Enrich with real star counts and logos**

Run: `node scripts/enrich-domain.mjs data/mobile-dev.json`
Expected: same as Task 2 Step 2, substituting `mobile-dev`.

- [ ] **Step 3: Check for duplicate ids**

Run: `node -e "const d = JSON.parse(require('fs').readFileSync('data/mobile-dev.json','utf8')); const ids = d.tools.map(t => t.id); const dupes = ids.filter((id, i) => ids.indexOf(id) !== i); if (dupes.length) { console.error('Duplicate ids:', dupes); process.exit(1); } console.log(ids.length, 'unique ids');"`
Expected: same as Task 2 Step 3.

- [ ] **Step 4: Validate the build**

Run: `npm run generate`
Expected: exits 0, no thrown error referencing `mobile-dev`.

- [ ] **Step 5: Commit**

```bash
git add data/mobile-dev.json data/mobile-dev/
git commit -m "Add Mobile Dev domain content

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Site-wide validation

**Files:**
- None created or modified — this task only verifies Tasks 1-5's combined output.

**Interfaces:**
- Consumes: `data/web-dev.json`, `data/devops-infra.json`, `data/security.json`, `data/mobile-dev.json`, and their `images/` directories from Tasks 2-5; `scripts/generate.mjs` (unmodified, existing).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests (`build-tree`, `layout`, `render-page`, `resolve-image`, `enrich-domain`) still green; domain content isn't exercised by these tests directly, but a passing suite confirms Task 1's script didn't regress anything.

- [ ] **Step 2: Regenerate the full site**

Run: `npm run generate`
Expected: exits 0. Confirm all six domains produced output:

```bash
ls dist/ | grep -E '^(data-science|web-dev|devops-infra|security|mobile-dev)$'
```

Expected: all five directories listed (plus `data-science`, unchanged from before this plan).

- [ ] **Step 3: Spot-check the landing page**

Run: `grep -o '<a href="[^"]*"' dist/index.html | sort -u`
Expected: links to all five domain pages present (`./data-science/`, `./web-dev/`, `./devops-infra/`, `./security/`, `./mobile-dev/`, or `/techmap/...` equivalents depending on `BASE_PATH`).

- [ ] **Step 4: Spot-check one generated domain page renders real content**

Run: `grep -c '"id"' data/web-dev.json data/devops-infra.json data/security.json data/mobile-dev.json`
Expected: each file reports a count in the ~40-50 range (matching the spec's target density).

No commit needed for this task — it's verification-only. If any step fails, return to the relevant Task 2-5 and fix before considering the plan complete.
