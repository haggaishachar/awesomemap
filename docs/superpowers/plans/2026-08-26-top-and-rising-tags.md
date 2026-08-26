# Top & Rising Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-repo tags (GitHub topics) as a third grouping dimension — alongside category and domain — via a "Top tags" widget on each domain page, a global `/tags/` explore page (top + rising tags), per-tag pages, and clickable tag chips on the project detail panel.

**Architecture:** A new pure module `scripts/tag-growth.mjs` owns every tag business rule (filtering, grouping, popularity ranking, growth ranking) and generalizes the existing `computeGroupGrowth`/`rankGroups` machinery (already used for category/domain growth) to a third grouping key. `render-page.mjs` gains new rendering functions that only ever accept already-computed arrays — it never imports `tag-growth.mjs`. `generate.mjs` is the sole file that imports both and wires one's output into the other's input.

**Tech Stack:** Plain Node.js (ESM `.mjs`), `node --test` + `node:assert/strict`, no framework, no bundler, static HTML string templates.

**Spec:** `docs/superpowers/specs/2026-08-26-top-and-rising-tags-design.md`

## Prerequisite

This plan assumes `data/<slug>.json` projects already carry a `tags: string[]` field, added by the `backfill-repo-tags` branch (commit `5e51643`, not yet on this branch as of plan-writing time). **Merge or rebase onto that branch before Task 9's manual verification** — everything up to Task 8 works fine without it (empty `tags` arrays just mean empty widgets/pages, which is already a handled case), but Task 9's `npm run generate`/`npm run dev` checks won't show real tag data until it's present. Check with:

```bash
git log --oneline -1 -- data/data-science.json
```

If the newest entry isn't (or doesn't include) `5e51643`, merge it in first.

## Global Constraints

- Tag filtering/ranking rules live **only** in `scripts/tag-growth.mjs`. `scripts/render-page.mjs` must never import it — its new functions only accept already-computed, already-ranked arrays as parameters. `scripts/generate.mjs` is the only file importing both.
- Stopword list is exactly `["hacktoberfest", "open-source", "awesome"]`, hardcoded as a `Set` constant in `tag-growth.mjs` — not a data file, not configurable.
- `MIN_PROJECTS_PER_TAG = 2` — a tag carried by only 1 project is dropped before ranking.
- No embed variant of tag pages.
- No per-domain filtering UI on the global `/tags/` index page (domain-scoped rankings live on the domain widget instead).
- `app/shared/detail-panel.js` has no automated test coverage in this repo (no browser/DOM test harness present) — its task is verified manually via `npm run dev`, matching how existing detail-panel behavior is verified.

---

### Task 1: `tag-growth.mjs` — stopwords, self-referential filter, grouping

**Files:**
- Create: `scripts/tag-growth.mjs`
- Test: `test/tag-growth.test.js`

**Interfaces:**
- Consumes: nothing external yet (Task 2/3 add the `group-growth.mjs` import)
- Produces: `export const STOPWORD_TAGS` (a `Set<string>`), `export const MIN_PROJECTS_PER_TAG` (number, `2`), `export function isSelfReferential(tag: string, project: { name?: string, id?: string }): boolean`, `export function buildTagGroups(projects: Array<{ id, name, weight?, tags? }>): Array<{ tag: string, projects: Array }>`

- [ ] **Step 1: Write the failing tests**

Create `test/tag-growth.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { STOPWORD_TAGS, MIN_PROJECTS_PER_TAG, isSelfReferential, buildTagGroups } from "../scripts/tag-growth.mjs";

test("STOPWORD_TAGS excludes known GitHub campaign/meta labels", () => {
  assert.ok(STOPWORD_TAGS.has("hacktoberfest"));
  assert.ok(STOPWORD_TAGS.has("open-source"));
  assert.ok(STOPWORD_TAGS.has("awesome"));
});

test("isSelfReferential matches a tag equal to the project's normalized display name", () => {
  assert.equal(isSelfReferential("pandas", { name: "pandas", id: "pandas-dev/pandas" }), true);
  assert.equal(isSelfReferential("sci-kit-learn", { name: "SciKit Learn", id: "scikit-learn/scikit-learn" }), true);
});

test("isSelfReferential matches a tag equal to the repo-name segment of id, even when it differs from the display name", () => {
  assert.equal(isSelfReferential("numpy", { name: "NumPy", id: "numpy/numpy" }), true);
});

test("isSelfReferential is false for a genuine topic tag", () => {
  assert.equal(isSelfReferential("machine-learning", { name: "pandas", id: "pandas-dev/pandas" }), false);
});

test("isSelfReferential is false when project has no name/id to compare against", () => {
  assert.equal(isSelfReferential("python", {}), false);
});

test("buildTagGroups drops stopword tags", () => {
  const projects = [
    { id: "a/a", name: "A", weight: 10, tags: ["hacktoberfest", "python"] },
    { id: "b/b", name: "B", weight: 20, tags: ["python"] },
  ];
  const groups = buildTagGroups(projects);
  assert.deepEqual(groups.map((g) => g.tag), ["python"]);
});

test("buildTagGroups drops a project's self-referential tag but keeps its other tags", () => {
  const projects = [
    { id: "pandas-dev/pandas", name: "pandas", weight: 10, tags: ["pandas", "python"] },
    { id: "b/b", name: "B", weight: 20, tags: ["python"] },
  ];
  const groups = buildTagGroups(projects);
  assert.deepEqual(groups.map((g) => g.tag), ["python"]);
  assert.equal(groups[0].projects.length, 2);
});

test("buildTagGroups drops a tag carried by fewer than MIN_PROJECTS_PER_TAG projects", () => {
  assert.equal(MIN_PROJECTS_PER_TAG, 2);
  const projects = [{ id: "a/a", name: "A", weight: 10, tags: ["rare-tag"] }];
  assert.deepEqual(buildTagGroups(projects), []);
});

test("buildTagGroups lets one project fan out into every tag group it qualifies for", () => {
  const projects = [
    { id: "a/a", name: "A", weight: 10, tags: ["python", "machine-learning"] },
    { id: "b/b", name: "B", weight: 20, tags: ["python"] },
    { id: "c/c", name: "C", weight: 30, tags: ["machine-learning"] },
  ];
  const groups = buildTagGroups(projects);
  const byTag = Object.fromEntries(groups.map((g) => [g.tag, g.projects.map((p) => p.id)]));
  assert.deepEqual(byTag, {
    python: ["a/a", "b/b"],
    "machine-learning": ["a/a", "c/c"],
  });
});

test("buildTagGroups ignores a project with no tags field", () => {
  const projects = [
    { id: "a/a", name: "A", weight: 10 },
    { id: "b/b", name: "B", weight: 20, tags: ["python"] },
    { id: "c/c", name: "C", weight: 30, tags: ["python"] },
  ];
  const groups = buildTagGroups(projects);
  assert.deepEqual(groups.map((g) => g.tag), ["python"]);
});

test("buildTagGroups returns an empty array for an empty project list", () => {
  assert.deepEqual(buildTagGroups([]), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/tag-growth.test.js`
Expected: FAIL — `Cannot find module '../scripts/tag-growth.mjs'`

- [ ] **Step 3: Write the implementation**

Create `scripts/tag-growth.mjs`:

```js
/**
 * Tags too generic to ever be an interesting "top tag" — GitHub
 * campaign/meta labels that aren't technology descriptors, so no
 * self-referential or project-count filter would ever catch them.
 * Hardcoded rather than a maintained data file: this list only grows when
 * a real top-tags run surfaces another one, and re-triaging every new tag
 * against a growing denylist is exactly the ongoing curation burden this
 * module is designed to avoid (see the design spec's Non-goals).
 */
export const STOPWORD_TAGS = new Set(["hacktoberfest", "open-source", "awesome"]);

/**
 * A tag shared by fewer projects than this is dropped before ranking — a
 * tag one project uses isn't a trend, it's that project's own name for
 * itself.
 */
export const MIN_PROJECTS_PER_TAG = 2;

/** Lowercases and strips everything but letters/digits, so "SciKit Learn", "scikit-learn", and "scikit_learn" all compare equal. */
function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True when `tag` just names `project` itself — either its display name
 * (pandas tagged `pandas`) or the repo-name segment of its `id`
 * (`pandas-dev/pandas` -> `pandas`), which sometimes differs from the
 * display name (e.g. NumPy's repo is `numpy/numpy`, its display name
 * "NumPy"). A self-referential tag is never an interesting "top tag" — by
 * construction it's unique to the one project that carries it.
 */
export function isSelfReferential(tag, project) {
  const normalizedTag = normalize(tag);
  if (project.name && normalize(project.name) === normalizedTag) return true;
  const repoName = typeof project.id === "string" ? project.id.split("/").pop() : undefined;
  if (repoName && normalize(repoName) === normalizedTag) return true;
  return false;
}

/**
 * Groups `projects` by shared tag, after dropping stopword and
 * self-referential tags, then dropping any resulting group smaller than
 * `MIN_PROJECTS_PER_TAG`. Unlike category/domain grouping (one group per
 * project), a project fans out into *every* tag group it qualifies for —
 * tags are multi-valued.
 *
 * Pure grouping: no history, no ranking. `computeTopTags` (Task 2) and
 * `computeRisingTags` (Task 3) both build on this same grouping, so the
 * eligibility rules (what counts as a "real" tag) are decided exactly
 * once.
 */
export function buildTagGroups(projects) {
  const byTag = new Map();
  for (const project of projects) {
    for (const tag of project.tags ?? []) {
      if (STOPWORD_TAGS.has(tag)) continue;
      if (isSelfReferential(tag, project)) continue;
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(project);
    }
  }
  return [...byTag]
    .filter(([, groupProjects]) => groupProjects.length >= MIN_PROJECTS_PER_TAG)
    .map(([tag, groupProjects]) => ({ tag, projects: groupProjects }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tag-growth.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-growth.mjs test/tag-growth.test.js
git commit -m "feat: add tag filtering and grouping (tag-growth.mjs)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `tag-growth.mjs` — `computeTopTags`

**Files:**
- Modify: `scripts/tag-growth.mjs` (append)
- Test: `test/tag-growth.test.js` (append)

**Interfaces:**
- Consumes: `buildTagGroups` output shape `{ tag, projects }` (Task 1)
- Produces: `export function computeTopTags(tagGroups, { limit }? ): Array<{ tag, projectCount, totalStars, rank }>`, sorted by `totalStars` descending

- [ ] **Step 1: Write the failing tests**

Append to `test/tag-growth.test.js` (add `computeTopTags` to the existing import):

```js
import { STOPWORD_TAGS, MIN_PROJECTS_PER_TAG, isSelfReferential, buildTagGroups, computeTopTags } from "../scripts/tag-growth.mjs";
```

```js
test("computeTopTags ranks by total stars descending and stamps 1-based ranks", () => {
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 100, tags: ["x"] },
    { id: "b/b", name: "B", weight: 50, tags: ["x"] },
    { id: "c/c", name: "C", weight: 40, tags: ["y"] },
    { id: "d/d", name: "D", weight: 40, tags: ["y"] },
  ]);
  const ranked = computeTopTags(groups);
  assert.deepEqual(ranked.map((r) => r.tag), ["x", "y"]);
  assert.equal(ranked[0].totalStars, 150);
  assert.equal(ranked[0].projectCount, 2);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
});

test("computeTopTags breaks a totalStars tie by project count, then alphabetically by tag", () => {
  const groups = [
    { tag: "b-tag", projects: [{ id: "1", weight: 10 }, { id: "2", weight: 10 }] },
    { tag: "a-tag", projects: [{ id: "3", weight: 20 }] },
  ];
  const ranked = computeTopTags(groups);
  assert.deepEqual(ranked.map((r) => r.tag), ["b-tag", "a-tag"], "same totalStars (20) — higher project count wins");
});

test("computeTopTags respects limit", () => {
  const groups = [
    { tag: "a", projects: [{ id: "1", weight: 30 }] },
    { tag: "b", projects: [{ id: "2", weight: 20 }] },
    { tag: "c", projects: [{ id: "3", weight: 10 }] },
  ];
  assert.equal(computeTopTags(groups, { limit: 2 }).length, 2);
  assert.equal(computeTopTags(groups).length, 3, "no limit means every group");
});

test("computeTopTags treats a project with no weight as 0 stars rather than NaN", () => {
  const groups = [{ tag: "a", projects: [{ id: "1" }, { id: "2" }] }];
  const ranked = computeTopTags(groups);
  assert.equal(ranked[0].totalStars, 0);
  assert.ok(Number.isFinite(ranked[0].totalStars));
});

test("computeTopTags returns an empty array for no groups", () => {
  assert.deepEqual(computeTopTags([]), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/tag-growth.test.js`
Expected: FAIL — `computeTopTags is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/tag-growth.mjs`:

```js
/**
 * Ranks tag groups by total stars descending (ties: project count
 * descending, then tag name ascending) — "top tags" mirrors what
 * "Popular" already means everywhere else on the site. History-
 * independent: a tag's popularity doesn't depend on any growth window, so
 * this needs no `historyById` and can be computed once per scope.
 */
export function computeTopTags(tagGroups, { limit } = {}) {
  const ranked = tagGroups
    .map(({ tag, projects }) => ({
      tag,
      projectCount: projects.length,
      totalStars: projects.reduce((sum, project) => sum + (typeof project.weight === "number" ? project.weight : 0), 0),
    }))
    .sort((a, b) => b.totalStars - a.totalStars || b.projectCount - a.projectCount || a.tag.localeCompare(b.tag))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tag-growth.test.js`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-growth.mjs test/tag-growth.test.js
git commit -m "feat: add computeTopTags to tag-growth.mjs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `tag-growth.mjs` — `computeRisingTags`

**Files:**
- Modify: `scripts/tag-growth.mjs` (append)
- Test: `test/tag-growth.test.js` (append)

**Interfaces:**
- Consumes: `buildTagGroups` output (Task 1); `computeGroupGrowth(projects, historyById, windowDays, { now })` and `rankGroups(groups)` from `scripts/group-growth.mjs` (existing)
- Produces: `export function computeRisingTags(tagGroups, historyById, windowDays, { limit, now }? ): Array<{ tag, projectCount, totalStars, rank, growth }>`

- [ ] **Step 1: Write the failing tests**

Append to `test/tag-growth.test.js` (add `computeRisingTags` to the import):

```js
import { STOPWORD_TAGS, MIN_PROJECTS_PER_TAG, isSelfReferential, buildTagGroups, computeTopTags, computeRisingTags } from "../scripts/tag-growth.mjs";
```

```js
const NOW = "2026-08-08T00:00:00.000Z";

/** Builds a 7-day-spanning history for a project that went `from` -> `to` stars. */
function history(from, to) {
  return [
    { date: "2026-08-01", stars: from },
    { date: "2026-08-08", stars: to },
  ];
}

test("computeRisingTags ranks eligible tag groups by percent growth descending", () => {
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 1100, tags: ["fast"] },
    { id: "b/b", name: "B", weight: 1050, tags: ["fast"] },
    { id: "c/c", name: "C", weight: 2020, tags: ["slow"] },
    { id: "d/d", name: "D", weight: 2000, tags: ["slow"] },
  ]);
  const historyById = {
    "a/a": history(1000, 1100),
    "b/b": history(1000, 1050),
    "c/c": history(2000, 2020),
    "d/d": history(2000, 2000),
  };
  const ranked = computeRisingTags(groups, historyById, 7, { now: NOW });
  assert.deepEqual(ranked.map((r) => r.tag), ["fast", "slow"]);
  assert.ok(ranked[0].growth.percentDelta > ranked[1].growth.percentDelta);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
});

test("computeRisingTags excludes a tag group with no net growth, even if tracked", () => {
  // "Rising" must never show a flat or shrinking entry — same rule
  // leaderboard.mjs applies to individual projects.
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 900, tags: ["flat"] },
    { id: "b/b", name: "B", weight: 900, tags: ["flat"] },
  ]);
  const historyById = { "a/a": history(1000, 900), "b/b": history(1000, 900) };
  assert.deepEqual(computeRisingTags(groups, historyById, 7, { now: NOW }), []);
});

test("computeRisingTags excludes a tag group without enough history", () => {
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 1100, tags: ["new"] },
    { id: "b/b", name: "B", weight: 1050, tags: ["new"] },
  ]);
  assert.deepEqual(computeRisingTags(groups, {}, 7, { now: NOW }), []);
});

test("computeRisingTags carries projectCount/totalStars alongside the growth stat", () => {
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 1100, tags: ["fast"] },
    { id: "b/b", name: "B", weight: 1050, tags: ["fast"] },
  ]);
  const historyById = { "a/a": history(1000, 1100), "b/b": history(1000, 1050) };
  const ranked = computeRisingTags(groups, historyById, 7, { now: NOW });
  assert.equal(ranked[0].projectCount, 2);
  assert.equal(ranked[0].totalStars, 2150);
});

test("computeRisingTags respects limit", () => {
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 1100, tags: ["fast"] },
    { id: "b/b", name: "B", weight: 1050, tags: ["fast"] },
    { id: "c/c", name: "C", weight: 2200, tags: ["also-fast"] },
    { id: "d/d", name: "D", weight: 2100, tags: ["also-fast"] },
  ]);
  const historyById = {
    "a/a": history(1000, 1100),
    "b/b": history(1000, 1050),
    "c/c": history(2000, 2200),
    "d/d": history(2000, 2100),
  };
  assert.equal(computeRisingTags(groups, historyById, 7, { now: NOW, limit: 1 }).length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/tag-growth.test.js`
Expected: FAIL — `computeRisingTags is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/tag-growth.mjs`, and add the import at the top of the file:

```js
import { computeGroupGrowth, rankGroups } from "./group-growth.mjs";
```

```js
/**
 * Ranks tag groups by growth rate over `windowDays`, reusing
 * `computeGroupGrowth` (the same group-growth math categories and domains
 * already use) and `rankGroups` (the same sort/tie-break rule) — this
 * function's only job is deciding which tag groups are *eligible*. A group
 * qualifies only when it `hasEnoughHistory` AND its aggregate
 * `starDelta > 0`, the same rule `leaderboard.mjs` applies so a list
 * called "Rising" never shows a flat or shrinking entry.
 */
export function computeRisingTags(tagGroups, historyById, windowDays, { limit, now } = {}) {
  const groups = tagGroups.map(({ tag, projects }) => ({
    key: tag,
    tag,
    projectCount: projects.length,
    totalStars: projects.reduce((sum, project) => sum + (typeof project.weight === "number" ? project.weight : 0), 0),
    growth: computeGroupGrowth(projects, historyById, windowDays, { now }),
  }));
  const eligible = groups.filter((group) => group.growth.hasEnoughHistory && group.growth.starDelta > 0);
  const ranked = rankGroups(eligible).map(({ key, ...rest }) => rest);
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tag-growth.test.js`
Expected: PASS (21 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-growth.mjs test/tag-growth.test.js
git commit -m "feat: add computeRisingTags to tag-growth.mjs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `render-page.mjs` — `tagSlug`, domain-page "Top tags" widget

**Files:**
- Modify: `scripts/render-page.mjs` (add `tagSlug` export, `renderTagWidget`, wire into `renderDomainPage`)
- Modify: `app/shared/treemap.css` (one hover rule)
- Test: `test/render-page.test.js`

**Interfaces:**
- Consumes: `renderMomentumStat(growth, { windowDays })` (existing, internal), `escapeHtml` (existing, internal). Input shapes: `topTags: Array<{ tag, projectCount, totalStars, rank }>` (Task 2's `computeTopTags` output), `risingTags: Array<{ tag, projectCount, totalStars, rank, growth }>` (Task 3's `computeRisingTags` output).
- Produces: `export function tagSlug(tag: string): string`; `renderDomainPage` gains `topTags = []` and `risingTags = []` options.

- [ ] **Step 1: Write the failing tests**

In `test/render-page.test.js`, change the import line to:

```js
import { renderDomainPage, renderLandingPage, renderRisingPage, tagSlug } from "../scripts/render-page.mjs";
```

Append these tests (near the end of the file, after the existing momentum tests — `growth()` helper is already defined there and is a hoisted function declaration, so it's usable anywhere in the file):

```js
test("tagSlug URL-encodes a tag for use as a route segment", () => {
  assert.equal(tagSlug("machine-learning"), "machine-learning");
  assert.equal(tagSlug("c++"), "c%2B%2B");
});

test("renderDomainPage renders a Top tags widget with rank, name link, and project count", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const topTags = [
    { tag: "machine-learning", projectCount: 12, totalStars: 500000, rank: 1 },
    { tag: "python", projectCount: 30, totalStars: 900000, rank: 2 },
  ];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", topTags });
  assert.match(html, /Top tags in this domain/);
  assert.match(html, /href="\/tags\/machine-learning\/"/);
  assert.match(html, />machine-learning</);
  assert.match(html, /12 projects/);
});

test("renderDomainPage's tag widget shows a growth badge only for a tag that also appears in risingTags", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const topTags = [
    { tag: "machine-learning", projectCount: 12, totalStars: 500000, rank: 1 },
    { tag: "python", projectCount: 30, totalStars: 900000, rank: 2 },
  ];
  const risingTags = [{ tag: "python", projectCount: 30, totalStars: 900000, rank: 1, growth: growth({ percentDelta: 4 }) }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", topTags, risingTags });
  const mlSlice = html.slice(html.indexOf("machine-learning"), html.indexOf("machine-learning") + 400);
  const pySlice = html.slice(html.indexOf(">python<"), html.indexOf(">python<") + 400);
  assert.ok(!mlSlice.includes("momentum-stat"), "no badge for a tag that isn't rising");
  assert.ok(pySlice.includes("momentum-stat"), "badge shown for the rising tag");
});

test("renderDomainPage omits the tag widget when there are no qualifying tags", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", topTags: [] });
  assert.doesNotMatch(html, /Top tags in this domain/);
});

test("renderDomainPage's embed variant has no tag widget", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const topTags = [{ tag: "python", projectCount: 30, totalStars: 900000, rank: 1 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", embed: true, topTags });
  assert.doesNotMatch(html, /Top tags in this domain/);
});

test("renderDomainPage's tag widget links respect BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const topTags = [{ tag: "python", projectCount: 30, totalStars: 900000, rank: 1 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", basePath: "/techmap", topTags });
  assert.match(html, /href="\/techmap\/tags\/python\/"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render-page.test.js`
Expected: FAIL — `tagSlug is not a function` / `renderDomainPage does not export or use topTags` (widget text absent)

- [ ] **Step 3: Write the implementation**

In `scripts/render-page.mjs`, add `tagSlug` right after `renderJsonLd` (before `renderSiteHeader`, around line 34):

```js
/**
 * Turns a raw tag string into its URL path segment (`/tags/<slug>/`).
 * GitHub topics are already lowercase and hyphen-separated, so this is
 * close to identity — centralizing it here (instead of inlining
 * `encodeURIComponent` at each call site that builds a tag URL) keeps "how
 * a tag becomes a route" one decision. `generate.mjs` imports this same
 * function to name each tag's directory on disk, so a page's URL and its
 * file path can never drift apart.
 */
export function tagSlug(tag) {
  return encodeURIComponent(tag);
}
```

Add `renderTagWidget` right after `renderCategoryMomentum` (after its closing brace, before `renderDomainQuicklinks`, around line 213):

```js
/**
 * Renders a domain page's "Top tags" widget — a third section in
 * `.domain-insights`, alongside "Where the heat is" and the rising teaser.
 * `topTags` is `computeTopTags` output for this domain's projects (no
 * history needed); `risingTags` is `computeRisingTags` output for the same
 * domain at `windowDays`, used only to decorate a top-tag row with a
 * growth badge when that same tag also qualifies as rising. This lookup is
 * a display-only join — `tag-growth.mjs` already decided eligibility and
 * ranking for both lists; this only asks "does this tag also appear in
 * that other already-ranked list."
 */
function renderTagWidget(topTags, risingTags, { basePath, windowDays, limit = 8 }) {
  if (topTags.length === 0) return "";
  const risingByTag = new Map(risingTags.map((entry) => [entry.tag, entry]));
  const rows = topTags
    .slice(0, limit)
    .map((entry) => {
      const rising = risingByTag.get(entry.tag);
      const badge = rising ? renderMomentumStat(rising.growth, { windowDays }) : "";
      const count = `${entry.projectCount} project${entry.projectCount === 1 ? "" : "s"}`;
      return `
        <li class="momentum-row">
          <span class="momentum-row-rank">${entry.rank}</span>
          <a class="momentum-row-name" href="${basePath}/tags/${tagSlug(entry.tag)}/" title="${escapeHtml(entry.tag)}">${escapeHtml(entry.tag)}</a>
          <span class="momentum-row-coverage">${count}</span>
          ${badge}
        </li>`;
    })
    .join("");
  return `
    <section class="category-momentum">
      <h2 class="category-momentum-heading">Top tags in this domain</h2>
      <ol class="momentum-rows-list">${rows}</ol>
    </section>`;
}
```

Modify `renderDomainPage`'s signature and body (replace the existing function, lines 79-137):

```js
export function renderDomainPage(
  domain,
  tree,
  {
    embed = false,
    defaultOgImage,
    siteUrl = "",
    basePath = "",
    teaser = [],
    categoryGrowth = [],
    momentumWindowDays = RISING_WINDOWS_DAYS[0],
    topTags = [],
    risingTags = [],
  }
) {
  const header = embed ? "" : renderSiteHeader(basePath);
  const footer = embed ? "" : renderSiteFooter();
  const teaserSection = embed
    ? ""
    : renderRisingTeaser(teaser, { heading: "Rising this week", href: `${basePath}/rising/#${domain.slug}`, showDomain: false });
  // Omitted from embeds along with the rest of the chrome — an embedded map is
  // a visualization, not a page.
  const categorySection = embed ? "" : renderCategoryMomentum(categoryGrowth, { windowDays: momentumWindowDays });
  const tagSection = embed ? "" : renderTagWidget(topTags, risingTags, { basePath, windowDays: momentumWindowDays });
  const ogUrl = `${siteUrl}${basePath}/${domain.slug}/`;
  // Omitted from the embed variant along with the header/footer/teaser —
  // it's structured data for search engines, and embed pages are already
  // excluded from the sitemap as duplicate content (see seo.mjs).
  const itemListJsonLd = embed
    ? ""
    : renderJsonLd(buildItemListJsonLd(domain.name, domain.projects ?? [], { url: ogUrl }));
  // The domain's own `history.json` (copied from `data/history/<slug>.json`
  // by generate.mjs, when it exists) — fetched lazily by the detail panel
  // to draw its star-history sparkline. Always emitted, even for domains
  // with no history file yet; the panel's fetch fails gracefully (no
  // chart) rather than needing generate.mjs's fs state here.
  const historyUrl = `${basePath}/${domain.slug}/history.json`;
  const body = `
    ${header}
    ${itemListJsonLd}
    <div id="app"></div>
    <script type="application/json" id="map-data">${escapeScriptJson(JSON.stringify(tree))}</script>
    <script type="module">
      import { mountTreemap } from "${basePath}/shared/treemap.js";
      import { createDetailPanel } from "${basePath}/shared/detail-panel.js";
      const mapData = JSON.parse(document.getElementById("map-data").textContent);
      const panel = createDetailPanel(document.body, { historyUrl: "${historyUrl}" });
      mountTreemap(
        document.getElementById("app"),
        mapData,
        (leafData) => panel.open(leafData),
        () => panel.close()
      );
    </script>
    <div class="domain-insights">
      ${categorySection}
      ${tagSection}
      ${teaserSection}
    </div>
    ${footer}
  `;
  return renderShell({
    title: domain.name,
    ogTitle: domain.name,
    ogDescription: domain.description ?? "",
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}
```

(Note: `createDetailPanel(document.body, { historyUrl: "${historyUrl}" })` is deliberately left unchanged here — Task 8 adds `basePath` to it.)

In `app/shared/treemap.css`, add this rule right after the existing `.momentum-row-name { ... }` block (around line 583), since `.momentum-row-name` is now sometimes an `<a>`:

```css
a.momentum-row-name:hover {
  color: var(--color-accent);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render-page.test.js`
Expected: PASS (all render-page tests, including the new ones)

- [ ] **Step 5: Commit**

```bash
git add scripts/render-page.mjs app/shared/treemap.css test/render-page.test.js
git commit -m "feat: add tagSlug and domain-page Top tags widget

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `render-page.mjs` — global `/tags/` index page + "Tags" nav link

**Files:**
- Modify: `scripts/render-page.mjs` (add `renderSiteHeader` nav link, `renderTagsIndexPage` + helpers)
- Test: `test/render-page.test.js`

**Interfaces:**
- Consumes: `topTags: Array<{ tag, projectCount, totalStars, rank }>` (global scope), `risingTagsByWindow: { [windowDays]: Array<{ tag, projectCount, totalStars, rank, growth }> }` — same shapes as Task 4, just computed at global scope instead of per-domain.
- Produces: `export function renderTagsIndexPage(topTags, risingTagsByWindow, { defaultOgImage, siteUrl?, basePath?, generatedAt?, limit? }): string`

- [ ] **Step 1: Write the failing tests**

Update the import line in `test/render-page.test.js`:

```js
import { renderDomainPage, renderLandingPage, renderRisingPage, renderTagsIndexPage, tagSlug } from "../scripts/render-page.mjs";
```

Append:

```js
test("the site header includes a Tags nav link, prefixed by BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const rootHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", basePath: "" });
  assert.match(rootHtml, /href="\/tags\/">Tags<\/a>/);
  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", basePath: "/techmap" });
  assert.match(prefixedHtml, /href="\/techmap\/tags\/">Tags<\/a>/);
});

test("renderTagsIndexPage lists top tags ranked by stars, with project count and star total", () => {
  const topTags = [
    { tag: "python", projectCount: 30, totalStars: 900000, rank: 1 },
    { tag: "machine-learning", projectCount: 12, totalStars: 500000, rank: 2 },
  ];
  const html = renderTagsIndexPage(topTags, {}, { defaultOgImage: "/og.png" });
  assert.match(html, /Top tags/);
  assert.match(html, /href="\/tags\/python\/"/);
  assert.match(html, /30 projects/);
  assert.match(html, /900,000/);
});

test("renderTagsIndexPage renders all three rising windows, only the 7-day one visible initially", () => {
  const risingTagsByWindow = {
    7: [{ tag: "rust", projectCount: 4, totalStars: 1000, rank: 1, growth: growth({ percentDelta: 5 }) }],
    30: [{ tag: "zig", projectCount: 4, totalStars: 1000, rank: 1, growth: growth({ percentDelta: 12 }) }],
    90: [{ tag: "go", projectCount: 4, totalStars: 1000, rank: 1, growth: growth({ percentDelta: 8 }) }],
  };
  const html = renderTagsIndexPage([], risingTagsByWindow, { defaultOgImage: "/og.png" });
  const day7 = html.match(/<div class="rising-rows" data-window="7">([\s\S]*?)<\/div>/)[1];
  const day30 = html.match(/<div class="rising-rows" data-window="30" hidden>([\s\S]*?)<\/div>/)[1];
  assert.match(day7, /rust/);
  assert.match(day30, /zig/);
});

test("renderTagsIndexPage shows a not-ready placeholder for a window with no eligible rising tags", () => {
  const html = renderTagsIndexPage([], { 7: [] }, { defaultOgImage: "/og.png" });
  assert.match(html, /Not enough star-history yet for this window\./);
});

test("renderTagsIndexPage shows a placeholder when there are no top tags at all", () => {
  const html = renderTagsIndexPage([], {}, { defaultOgImage: "/og.png" });
  assert.match(html, /No tags yet\./);
});

test("renderTagsIndexPage's canonical/og:url point at /tags/, respecting BASE_PATH", () => {
  const html = renderTagsIndexPage([], {}, { defaultOgImage: "/og.png", siteUrl: "https://awesomemap.dev", basePath: "/techmap" });
  assert.match(html, /rel="canonical" href="https:\/\/awesomemap\.dev\/techmap\/tags\/"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render-page.test.js`
Expected: FAIL — `renderTagsIndexPage is not a function` / no "Tags" nav link

- [ ] **Step 3: Write the implementation**

In `scripts/render-page.mjs`, modify `renderSiteHeader` (add the Tags link next to Rising, around line 42):

```js
function renderSiteHeader(basePath) {
  return `
    <header class="site-header">
      <a class="site-header-brand" href="${basePath}/">awesomemap</a>
      <div class="site-header-links">
        <a class="site-header-rising" href="${basePath}/rising/">Rising</a>
        <a class="site-header-tags" href="${basePath}/tags/">Tags</a>
        <a class="site-header-github" href="${REPO_URL}" aria-label="View awesomemap on GitHub">
          <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
          </svg>
        </a>
        <img class="site-header-stars" src="https://img.shields.io/github/stars/haggaishachar/awesomemap?style=social" alt="GitHub stars" width="94" height="20" loading="lazy" />
      </div>
    </header>`;
}
```

Add the following after `renderTagPage`'s eventual home — for this task, append it at the **end of the file** (it will sit after `renderRisingPage`; `renderTagPage` in Task 6 is appended after this):

```js
/** Formats a plain (non-delta) star count with thousands separators, e.g. `12,400`. */
function formatStars(stars) {
  return Number(stars).toLocaleString("en-US");
}

/** One row in the global "Top tags" list — star-ranked, no growth window involved. */
function renderTopTagRow(entry, { basePath }) {
  const count = `${entry.projectCount} project${entry.projectCount === 1 ? "" : "s"}`;
  return `
    <li class="momentum-row">
      <span class="momentum-row-rank">${entry.rank}</span>
      <a class="momentum-row-name" href="${basePath}/tags/${tagSlug(entry.tag)}/" title="${escapeHtml(entry.tag)}">${escapeHtml(entry.tag)}</a>
      <span class="momentum-row-coverage">${count}</span>
      <span class="momentum-abs">★ ${formatStars(entry.totalStars)}</span>
    </li>`;
}

function renderTopTagsList(topTags, { basePath, limit }) {
  if (topTags.length === 0) return `<p class="rising-empty">No tags yet.</p>`;
  return `<ol class="momentum-rows-list">${topTags
    .slice(0, limit)
    .map((entry) => renderTopTagRow(entry, { basePath }))
    .join("")}</ol>`;
}

/** One row in a "Rising tags" window's list — same shape as the domain widget's rows, always showing a growth badge (every entry here is, by construction, rising). */
function renderRisingTagRow(entry, { basePath, windowDays }) {
  const count = `${entry.projectCount} project${entry.projectCount === 1 ? "" : "s"}`;
  return `
    <li class="momentum-row">
      <span class="momentum-row-rank">${entry.rank}</span>
      <a class="momentum-row-name" href="${basePath}/tags/${tagSlug(entry.tag)}/" title="${escapeHtml(entry.tag)}">${escapeHtml(entry.tag)}</a>
      <span class="momentum-row-coverage">${count}</span>
      ${renderMomentumStat(entry.growth, { windowDays })}
    </li>`;
}

/** Renders the three window variants for the "Rising tags" list, only the first shown initially — mirrors `renderRisingWindowVariants`' precomputed/client-toggled pattern. */
function renderRisingTagsWindowVariants(risingTagsByWindow, { basePath, limit }) {
  return RISING_WINDOWS_DAYS.map((windowDays, index) => {
    const entries = (risingTagsByWindow[windowDays] ?? []).slice(0, limit);
    const hiddenAttr = index === 0 ? "" : " hidden";
    const body =
      entries.length === 0
        ? `<p class="rising-empty">Not enough star-history yet for this window.</p>`
        : `<ol class="momentum-rows-list">${entries.map((entry) => renderRisingTagRow(entry, { basePath, windowDays })).join("")}</ol>`;
    return `<div class="rising-rows" data-window="${windowDays}"${hiddenAttr}>${body}</div>`;
  }).join("");
}

/**
 * Renders the global `/tags/` page: a "Top tags" list (star-ranked, no
 * window) and a "Rising tags" list with the same 7/30/90-day window toggle
 * `/rising/` uses (precomputed per window, swapped client-side — no
 * client-side recomputation). No per-domain filtering here — domain-scoped
 * tag rankings already live on each domain page's widget (see
 * `renderTagWidget`); a second filtering mechanism for the same data would
 * just duplicate it.
 */
export function renderTagsIndexPage(topTags, risingTagsByWindow, { defaultOgImage, siteUrl = "", basePath = "", generatedAt = new Date(), limit = 30 }) {
  const windowBar = `
    <div class="rising-window-bar">
      ${RISING_WINDOWS_DAYS.map(
        (windowDays, index) =>
          `<button type="button" class="treemap-window-button${index === 0 ? " treemap-window-button-active" : ""}" data-window="${windowDays}">${windowDays}d</button>`
      ).join("")}
    </div>`;

  const body = `
    ${renderSiteHeader(basePath)}
    <header class="rising-hero">
      <h1>Tags</h1>
      <p class="rising-hero-tagline">The technologies awesomemap's projects carry, across every domain.</p>
      <p class="rising-updated">Updated ${escapeHtml(generatedAt.toISOString().slice(0, 10))}</p>
    </header>
    <div class="rising-page">
      <section class="rising-section">
        <h2 class="rising-section-heading">Top tags</h2>
        ${renderTopTagsList(topTags, { basePath, limit })}
      </section>
      <section class="rising-section">
        <h2 class="rising-section-heading">Rising tags</h2>
        ${windowBar}
        ${renderRisingTagsWindowVariants(risingTagsByWindow, { basePath, limit })}
      </section>
    </div>
    <script>
      document.querySelectorAll(".rising-window-bar button").forEach((button) => {
        button.addEventListener("click", () => {
          const selected = button.dataset.window;
          document.querySelectorAll(".rising-window-bar button").forEach((b) => {
            b.classList.toggle("treemap-window-button-active", b === button);
          });
          document.querySelectorAll(".rising-rows").forEach((el) => {
            el.hidden = el.dataset.window !== selected;
          });
        });
      });
    </script>
    ${renderSiteFooter()}
  `;

  return renderShell({
    title: "Tags — awesomemap",
    ogTitle: "Tags — awesomemap",
    ogDescription: "Top and rising technology tags across every awesomemap domain.",
    ogImage: defaultOgImage,
    ogUrl: `${siteUrl}${basePath}/tags/`,
    base: basePath,
    body,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render-page.test.js`
Expected: PASS (all render-page tests, including the new ones)

- [ ] **Step 5: Commit**

```bash
git add scripts/render-page.mjs test/render-page.test.js
git commit -m "feat: add global /tags/ index page and Tags nav link

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `render-page.mjs` — per-tag page

**Files:**
- Modify: `scripts/render-page.mjs` (append `renderTagProjectRow`, `renderTagPage`)
- Test: `test/render-page.test.js`

**Interfaces:**
- Consumes: `buildItemListJsonLd(name, projects, { url })` from `./seo.mjs` (existing import already in this file); `projects: Array<{ id, name, link, image?, weight?, domainShort?, domainName? }>` — the raw project objects a `buildTagGroups` group carries, pre-sorted by the caller; `growth`: a `computeGroupGrowth` result for the page's default window.
- Produces: `export function renderTagPage(tag, projects, growth, { defaultOgImage, siteUrl?, basePath?, windowDays? }): string`

- [ ] **Step 1: Write the failing tests**

Update the import line:

```js
import { renderDomainPage, renderLandingPage, renderRisingPage, renderTagsIndexPage, renderTagPage, tagSlug } from "../scripts/render-page.mjs";
```

Append:

```js
test("renderTagPage lists projects in the caller's order, with domain badges and star counts", () => {
  const projects = [
    { id: "a/a", name: "A", link: "https://a.example", weight: 500, image: "https://img/a.png", domainShort: "AI" },
    { id: "b/b", name: "B", link: "https://b.example", weight: 200, domainShort: "Web" },
  ];
  const html = renderTagPage("machine-learning", projects, { hasEnoughHistory: false, oldestDate: null }, { defaultOgImage: "/og.png" });
  assert.match(html, /<h1>machine-learning<\/h1>/);
  assert.match(html, /2 projects tagged/);
  assert.match(html, /★ 700 combined/);
  assert.match(html, /href="https:\/\/a\.example"/);
  assert.match(html, />AI</);
  assert.match(html, />Web</);
});

test("renderTagPage shows the default-window growth stat when the tag group is tracked", () => {
  const projects = [{ id: "a/a", name: "A", link: "https://a.example", weight: 500 }];
  const html = renderTagPage("rust", projects, growth({ percentDelta: 3.2 }), { defaultOgImage: "/og.png" });
  assert.match(html, /\+3\.2%/);
});

test("renderTagPage reports 'Not tracked yet' rather than a fabricated 0% when the tag group has no history", () => {
  const projects = [{ id: "a/a", name: "A", link: "https://a.example", weight: 500 }];
  const html = renderTagPage("rust", projects, { hasEnoughHistory: false, oldestDate: null }, { defaultOgImage: "/og.png" });
  assert.match(html, /Not tracked yet/);
});

test("renderTagPage emits an ItemList JSON-LD block with a ListItem per linked project", () => {
  const projects = [{ id: "a/a", name: "A", link: "https://a.example", weight: 500 }];
  const html = renderTagPage("rust", projects, { hasEnoughHistory: false, oldestDate: null }, {
    defaultOgImage: "/og.png",
    siteUrl: "https://awesomemap.dev",
  });
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const jsonLd = JSON.parse(jsonLdMatch[1]);
  assert.equal(jsonLd["@type"], "ItemList");
  assert.equal(jsonLd.itemListElement[0].name, "A");
});

test("renderTagPage's canonical/og:url use tagSlug and respect BASE_PATH", () => {
  const html = renderTagPage("c++", [], { hasEnoughHistory: false, oldestDate: null }, {
    defaultOgImage: "/og.png",
    siteUrl: "https://awesomemap.dev",
    basePath: "/techmap",
  });
  assert.match(html, /rel="canonical" href="https:\/\/awesomemap\.dev\/techmap\/tags\/c%2B%2B\/"/);
});

test("renderTagPage handles a project with no link by falling back to '#' rather than throwing", () => {
  const projects = [{ id: "a/a", name: "A", weight: 500 }];
  assert.doesNotThrow(() => renderTagPage("rust", projects, { hasEnoughHistory: false, oldestDate: null }, { defaultOgImage: "/og.png" }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render-page.test.js`
Expected: FAIL — `renderTagPage is not a function`

- [ ] **Step 3: Write the implementation**

Append to the end of `scripts/render-page.mjs`:

```js
/**
 * One row on a per-tag page's project list — same visual shape as a
 * rising-leaderboard row (rank, icon, name, domain badge), with a plain
 * star count in the trailing slot instead of a growth delta, since a tag
 * page ranks by absolute popularity, not by a growth window.
 */
function renderTagProjectRow(project, rank) {
  const icon = project.image ? `<img class="rising-row-icon" src="${escapeHtml(project.image)}" alt="" loading="lazy" />` : "";
  const domainBadge = project.domainShort
    ? `<span class="rising-row-domain" title="${escapeHtml(project.domainName ?? project.domainShort)}">${escapeHtml(project.domainShort)}</span>`
    : "";
  const stars = typeof project.weight === "number" ? `★ ${formatStars(project.weight)}` : "";
  return `
    <li class="rising-row">
      <span class="rising-row-rank">${rank}</span>
      ${icon}
      <span class="rising-row-title">
        <a class="rising-row-name" href="${escapeHtml(project.link ?? "#")}">${escapeHtml(project.name ?? project.id)}</a>
      </span>
      ${domainBadge}
      <span class="rising-row-delta">${stars}</span>
    </li>`;
}

/**
 * Renders one tag's page: header stats (project count, combined stars,
 * default-window growth) then every carrying project, in the order the
 * caller passes them (sorted by stars descending — `generate.mjs`'s job,
 * not this function's), each with a domain badge since one tag can span
 * several domains. Gets the same SEO treatment (`ItemList` JSON-LD,
 * canonical) as a domain page — the ~600 pages like this one are a
 * genuine long-tail search surface. `growth` is a `computeGroupGrowth`
 * result for the page's default window (may report
 * `hasEnoughHistory: false`, rendered the same way `renderMomentumStat`
 * already handles that everywhere else).
 */
export function renderTagPage(tag, projects, growth, { defaultOgImage, siteUrl = "", basePath = "", windowDays = RISING_WINDOWS_DAYS[0] }) {
  const ogUrl = `${siteUrl}${basePath}/tags/${tagSlug(tag)}/`;
  const itemListJsonLd = renderJsonLd(buildItemListJsonLd(tag, projects, { url: ogUrl }));
  const rows = projects.map((project, index) => renderTagProjectRow(project, index + 1)).join("");
  const totalStars = projects.reduce((sum, project) => sum + (typeof project.weight === "number" ? project.weight : 0), 0);
  const projectWord = `project${projects.length === 1 ? "" : "s"}`;

  const body = `
    ${renderSiteHeader(basePath)}
    ${itemListJsonLd}
    <header class="rising-hero">
      <h1>${escapeHtml(tag)}</h1>
      <p class="rising-hero-tagline">${projects.length} ${projectWord} tagged <strong>${escapeHtml(tag)}</strong> · ★ ${formatStars(totalStars)} combined</p>
      ${renderMomentumStat(growth, { windowDays })}
    </header>
    <div class="rising-page">
      <section class="rising-section">
        <ol class="rising-rows-list">${rows}</ol>
      </section>
    </div>
    ${renderSiteFooter()}
  `;

  return renderShell({
    title: `${tag} — awesomemap`,
    ogTitle: `${tag} — awesomemap`,
    ogDescription: `${projects.length} open-source ${projectWord} tagged ${tag} on awesomemap.`,
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render-page.test.js`
Expected: PASS (all render-page tests, including the new ones)

- [ ] **Step 5: Commit**

```bash
git add scripts/render-page.mjs test/render-page.test.js
git commit -m "feat: add per-tag page (renderTagPage)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `seo.mjs` — sitemap gains `extraPaths`

**Files:**
- Modify: `scripts/seo.mjs`
- Test: `test/seo.test.js`

**Interfaces:**
- Consumes: nothing new
- Produces: `buildSitemap(slugs, { siteUrl, basePath, extraPaths? })` — `extraPaths` is an array of already-prefixed paths (e.g. `"/tags/"`, `"/tags/python/"`), appended after the domain-page URLs. Defaults to `[]`, so existing callers are unaffected.

- [ ] **Step 1: Write the failing tests**

Append to `test/seo.test.js`:

```js
test("buildSitemap appends extraPaths after the domain pages", () => {
  const xml = buildSitemap(["data-science"], {
    siteUrl: "https://example.com",
    basePath: "",
    extraPaths: ["/tags/", "/tags/python/"],
  });
  assert.match(xml, /<loc>https:\/\/example\.com\/tags\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.com\/tags\/python\/<\/loc>/);
});

test("buildSitemap defaults extraPaths to empty, unchanged output when omitted", () => {
  const xml = buildSitemap(["data-science"], { siteUrl: "https://example.com", basePath: "" });
  assert.doesNotMatch(xml, /\/tags\//);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/seo.test.js`
Expected: FAIL — extraPaths not reflected in output

- [ ] **Step 3: Write the implementation**

Replace `buildSitemap` in `scripts/seo.mjs`:

```js
/**
 * Builds a sitemap.xml document listing the landing page, the rising
 * leaderboard page, one entry per domain page, and any additional paths
 * the caller passes via `extraPaths` (e.g. the `/tags/` index and every
 * per-tag page — `generate.mjs` builds that list from the same tag slugs
 * it uses to write those pages to disk, so the sitemap and the actual
 * build output can't drift apart). `slugs` is the list of domain slugs
 * (e.g. `["data-science", "security"]`); `siteUrl`/`basePath` combine the
 * same way they do for `og:url` elsewhere in the generator. Embed pages
 * (`/embed/<slug>/`) are intentionally excluded — they're meant for
 * iframing into third-party pages, not for search discovery, and would
 * otherwise read as duplicate content of the domain pages.
 *
 * Returns `null` when `siteUrl` is empty (e.g. local `npm run dev`),
 * since a sitemap of relative URLs isn't spec-compliant and there's no
 * meaningful site to submit to a search engine locally.
 */
export function buildSitemap(slugs, { siteUrl, basePath, extraPaths = [] }) {
  if (!siteUrl) return null;

  const origin = `${siteUrl}${basePath}`;
  const urls = [
    `${origin}/`,
    `${origin}/rising/`,
    ...slugs.map((slug) => `${origin}/${slug}/`),
    ...extraPaths.map((path) => `${origin}${path}`),
  ];

  const urlEntries = urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/seo.test.js`
Expected: PASS (all seo tests, including the new ones)

- [ ] **Step 5: Commit**

```bash
git add scripts/seo.mjs test/seo.test.js
git commit -m "feat: let buildSitemap accept extraPaths

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Detail-panel tag chips

**Files:**
- Modify: `app/shared/detail-panel.js` (`basePath` option, tag chip rendering)
- Modify: `scripts/render-page.mjs` (thread `basePath` into the `createDetailPanel` call inside `renderDomainPage`)
- Modify: `app/shared/treemap.css` (chip styles)
- Test: `test/render-page.test.js` (covers the `basePath` thread-through; the DOM-side chip rendering has no automated test in this repo — see Global Constraints — and is verified manually in Step 6)

**Interfaces:**
- Consumes: `leafData.tags: string[]` (already flows onto tree leaves via `build-tree.mjs`'s field spread — no change needed there), `basePath` passed into `createDetailPanel`.
- Produces: `createDetailPanel(container, { historyUrl, basePath = "" })` — `basePath` is new and optional; existing callers omitting it keep working (chips just link relative to root).

- [ ] **Step 1: Write the failing test (server-side thread-through)**

Append to `test/render-page.test.js`:

```js
test("renderDomainPage threads basePath into createDetailPanel, so its tag chips can build correct links", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", basePath: "/techmap" });
  assert.match(html, /createDetailPanel\(document\.body, \{ historyUrl: "\/techmap\/data-science\/history\.json", basePath: "\/techmap" \}\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/render-page.test.js`
Expected: FAIL — current script only passes `historyUrl`

- [ ] **Step 3: Update `renderDomainPage`'s inline script**

In `scripts/render-page.mjs`, inside `renderDomainPage`'s `body` template, change:

```js
      const panel = createDetailPanel(document.body, { historyUrl: "${historyUrl}" });
```

to:

```js
      const panel = createDetailPanel(document.body, { historyUrl: "${historyUrl}", basePath: "${basePath}" });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/render-page.test.js`
Expected: PASS

- [ ] **Step 5: Update `detail-panel.js`**

In `app/shared/detail-panel.js`, change the `createDetailPanel` signature (around line 14):

```js
export function createDetailPanel(container, { historyUrl, basePath = "" } = {}) {
```

Add a `tagSlug` helper and a `renderTagChips` helper right before `createDetailPanel` (after the import line):

```js
/**
 * Turns a raw tag string into its URL path segment. Mirrors
 * `render-page.mjs`'s identical `tagSlug` — duplicated rather than
 * shared, since this file runs in the browser and can't import the
 * server-side module; both sides are a one-line `encodeURIComponent`, so
 * the duplication is cheap to keep in sync.
 */
function tagSlug(tag) {
  return encodeURIComponent(tag);
}

/** Builds the row of tag chips shown on a project's detail panel, or `null` when it has no tags. Each chip links to that tag's `/tags/<slug>/` page. */
function renderTagChips(tags, basePath) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const list = document.createElement("div");
  list.className = "detail-panel-tags";
  for (const tag of tags) {
    const chip = document.createElement("a");
    chip.className = "detail-panel-tag";
    chip.href = `${basePath}/tags/${tagSlug(tag)}/`;
    chip.textContent = tag;
    list.appendChild(chip);
  }
  return list;
}
```

Inside `open(leafData)`, right after the existing `desc` block (currently ending around line 102):

```js
    if (leafData.desc) {
      const desc = document.createElement("p");
      desc.textContent = leafData.desc;
      panel.appendChild(desc);
    }

    const tagList = renderTagChips(leafData.tags, basePath);
    if (tagList) panel.appendChild(tagList);
```

- [ ] **Step 6: Add chip styles**

In `app/shared/treemap.css`, add after the `.detail-panel-star-chart-caption { ... }` block (around line 326):

```css
.detail-panel-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}

.detail-panel-tag {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  text-decoration: none;
}

.detail-panel-tag:hover {
  text-decoration: underline;
}
```

- [ ] **Step 7: Manual verification**

Run: `npm run generate && npm run dev`

- Open a domain page (e.g. `http://localhost:5000/data-science/`), click a project leaf with tags.
- Confirm a row of small pill-shaped chips appears below its description.
- Click a chip — confirm it navigates to `/tags/<tag>/` (won't have real content until `data/*.json` has the `tags` field — see Prerequisite — but the navigation itself, and a `404`/empty page rather than a broken link, confirms the wiring).
- Confirm a project with no tags shows no chip row (no empty `<div class="detail-panel-tags">`).

- [ ] **Step 8: Commit**

```bash
git add app/shared/detail-panel.js app/shared/treemap.css scripts/render-page.mjs test/render-page.test.js
git commit -m "feat: add clickable tag chips to the detail panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `generate.mjs` — wire it all together

**Files:**
- Modify: `scripts/generate.mjs`

**Interfaces:**
- Consumes: everything built in Tasks 1-7 — `buildTagGroups`/`computeTopTags`/`computeRisingTags` from `scripts/tag-growth.mjs`; `renderTagsIndexPage`/`renderTagPage`/`tagSlug` from `scripts/render-page.mjs`; `buildSitemap`'s new `extraPaths` option.
- Produces: `dist/tags/index.html`, one `dist/tags/<slug>/index.html` per qualifying global tag, `topTags`/`risingTags` passed into every `renderDomainPage` call, `sitemap.xml` listing all of the above.

No unit test file exists for `generate.mjs` in this repo (it's the orchestration script, verified by running it) — this task's correctness is checked via the full test suite plus the manual steps below.

- [ ] **Step 1: Update imports**

In `scripts/generate.mjs`, replace the import block at the top:

```js
import { renderDomainPage, renderLandingPage, renderRisingPage, renderTagsIndexPage, renderTagPage, tagSlug } from "./render-page.mjs";
import { computeProjectSizing, findInvalidSizes, RISING_WINDOWS_DAYS } from "./velocity.mjs";
import { computeLeaderboard } from "./leaderboard.mjs";
import { computeGroupGrowth, rankGroups } from "./group-growth.mjs";
import { buildTagGroups, computeTopTags, computeRisingTags } from "./tag-growth.mjs";
import { buildSitemap, buildRobots } from "./seo.mjs";
```

- [ ] **Step 2: Add tag-related constants**

Right after the existing `const TEASER_LIMIT = 5;` line, add:

```js
const TAG_WIDGET_LIMIT = 8;
const TAGS_INDEX_LIMIT = 30;
```

- [ ] **Step 3: Add Pass 2c (tag computation)**

Insert this block right after the `categoryGrowthBySlug` loop ends (right before the `// Pass 3: render every domain's full page, embed page, and history.json,` comment):

```js
// Pass 2c: group projects by shared tag (GitHub topics), then rank those
// groups by popularity and by growth — the same "how did this slice of the
// ecosystem move" question Pass 2b already answers for categories and
// domains, just grouped a third way. `tag-growth.mjs` owns every
// filtering/ranking rule; this pass only calls it and stores results for
// Pass 3's domain widget and the /tags/ pages built after the domain loop.
const domainTopTagsBySlug = {};
const domainRisingTagsBySlug = {};
for (const domain of parsedDomains) {
  const tagGroups = buildTagGroups(domain.projects);
  domainTopTagsBySlug[domain.slug] = computeTopTags(tagGroups, { limit: TAG_WIDGET_LIMIT });
  domainRisingTagsBySlug[domain.slug] = computeRisingTags(tagGroups, historyBySlug[domain.slug], MOMENTUM_WINDOW_DAYS, { limit: TAG_WIDGET_LIMIT });
}

// Global tag groups additionally carry each project's originating domain
// (short name + slug) — a project's own record doesn't know that on its
// own, and a per-tag page needs it since tags cross domains.
const allProjectsWithDomain = parsedDomains.flatMap((domain) =>
  domain.projects.map((project) => ({ ...project, domainSlug: domain.slug, domainShort: domain.shortName ?? domain.name }))
);
// A project curated into more than one domain is the same GitHub repo
// regardless of which domain's history file recorded it, so merging here
// (last write wins on the rare collision) is a reasonable simplification
// for a group-level growth figure — unlike leaderboard.mjs's global scope,
// which must keep a project's single best-scoring domain listing, nothing
// here needs to trace a stat back to one specific domain's copy.
const globalHistoryById = Object.assign({}, ...Object.values(historyBySlug));
const globalTagGroups = buildTagGroups(allProjectsWithDomain);
const globalTopTags = computeTopTags(globalTagGroups, { limit: TAGS_INDEX_LIMIT });
const globalRisingTagsByWindow = {};
for (const windowDays of RISING_WINDOWS_DAYS) {
  globalRisingTagsByWindow[windowDays] = computeRisingTags(globalTagGroups, globalHistoryById, windowDays, { limit: TAGS_INDEX_LIMIT });
}
```

- [ ] **Step 4: Pass the domain's tag data into `renderDomainPage`**

In the Pass 3 loop, find:

```js
  writeFileSync(
    `${DIST_DIR}/${slug}/index.html`,
    renderDomainPage(domain, tree, {
      embed: false,
      defaultOgImage: DEFAULT_OG_IMAGE,
      siteUrl: SITE_URL,
      basePath: BASE_PATH,
      teaser,
      categoryGrowth: categoryGrowthBySlug[slug],
      momentumWindowDays: MOMENTUM_WINDOW_DAYS,
    })
  );
```

and add the two new fields:

```js
  writeFileSync(
    `${DIST_DIR}/${slug}/index.html`,
    renderDomainPage(domain, tree, {
      embed: false,
      defaultOgImage: DEFAULT_OG_IMAGE,
      siteUrl: SITE_URL,
      basePath: BASE_PATH,
      teaser,
      categoryGrowth: categoryGrowthBySlug[slug],
      momentumWindowDays: MOMENTUM_WINDOW_DAYS,
      topTags: domainTopTagsBySlug[slug],
      risingTags: domainRisingTagsBySlug[slug],
    })
  );
```

- [ ] **Step 5: Build the `/tags/` pages**

Find the `/rising/` page block:

```js
mkdirSync(`${DIST_DIR}/rising`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/rising/index.html`,
  renderRisingPage(domains, leaderboardsByWindow, {
    defaultOgImage: DEFAULT_OG_IMAGE,
    siteUrl: SITE_URL,
    basePath: BASE_PATH,
  })
);

cpSync(`${APP_DIR}/shared`, `${DIST_DIR}/shared`, { recursive: true });
```

and insert the tags block between the `/rising/` page and the `cpSync` call:

```js
mkdirSync(`${DIST_DIR}/rising`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/rising/index.html`,
  renderRisingPage(domains, leaderboardsByWindow, {
    defaultOgImage: DEFAULT_OG_IMAGE,
    siteUrl: SITE_URL,
    basePath: BASE_PATH,
  })
);

mkdirSync(`${DIST_DIR}/tags`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/tags/index.html`,
  renderTagsIndexPage(globalTopTags, globalRisingTagsByWindow, {
    defaultOgImage: DEFAULT_OG_IMAGE,
    siteUrl: SITE_URL,
    basePath: BASE_PATH,
  })
);

// One page per qualifying global tag (~600 at current data volume),
// sorted by stars descending — the same ranking `computeTopTags` uses,
// just applied here to one tag's own project list rather than across tags.
const tagPagePaths = [];
for (const { tag, projects } of globalTagGroups) {
  const sortedProjects = [...projects].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const tagGrowth = computeGroupGrowth(sortedProjects, globalHistoryById, MOMENTUM_WINDOW_DAYS);
  const slug = tagSlug(tag);
  mkdirSync(`${DIST_DIR}/tags/${slug}`, { recursive: true });
  writeFileSync(
    `${DIST_DIR}/tags/${slug}/index.html`,
    renderTagPage(tag, sortedProjects, tagGrowth, {
      defaultOgImage: DEFAULT_OG_IMAGE,
      siteUrl: SITE_URL,
      basePath: BASE_PATH,
      windowDays: MOMENTUM_WINDOW_DAYS,
    })
  );
  tagPagePaths.push(`/tags/${slug}/`);
}

cpSync(`${APP_DIR}/shared`, `${DIST_DIR}/shared`, { recursive: true });
```

- [ ] **Step 6: Include tag pages in the sitemap**

Find:

```js
const sitemap = buildSitemap(domains.map((d) => d.slug), { siteUrl: SITE_URL, basePath: BASE_PATH });
```

Replace with:

```js
const sitemap = buildSitemap(domains.map((d) => d.slug), {
  siteUrl: SITE_URL,
  basePath: BASE_PATH,
  extraPaths: ["/tags/", ...tagPagePaths],
});
```

- [ ] **Step 7: Run the full test suite**

Run: `node --test`
Expected: PASS — every existing test still passes, plus all tests added in Tasks 1-8.

- [ ] **Step 8: Manual verification**

Confirm the Prerequisite (`backfill-repo-tags` merged) is satisfied, then:

```bash
npm run generate
ls dist/tags | head -20
grep -l "Top tags in this domain" dist/*/index.html
```

Expected: `dist/tags/` contains `index.html` plus one directory per qualifying tag (several hundred); at least some domain `index.html` files contain "Top tags in this domain" (any domain with zero qualifying tags legitimately won't, per the empty-section convention).

Then:

```bash
npm run dev
```

- Visit `http://localhost:5000/tags/` — confirm the "Top tags" list and the "Rising tags" list (with working 7/30/90 window toggle) both render.
- Click a tag from that list — confirm its `/tags/<slug>/` page lists projects with domain badges and star counts, sorted descending.
- Visit a domain page — confirm the "Top tags in this domain" widget appears between "Where the heat is" and "Rising this week", and that clicking a tag row navigates correctly.
- Click "Tags" in the site header nav from any page — confirm it lands on `/tags/`.

- [ ] **Step 9: Commit**

```bash
git add scripts/generate.mjs
git commit -m "feat: wire tag computation and pages into generate.mjs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** every Goals bullet in the design spec maps to a task — `tag-growth.mjs` (Tasks 1-3), domain widget (Task 4), global index page (Task 5), per-tag pages (Task 6), sitemap/SEO (Task 7), detail-panel chips (Task 8), nav entry (Task 5), generate.mjs wiring (Task 9). The data/presentation separation constraint is enforced structurally: `render-page.mjs` never imports `tag-growth.mjs` in any task, only `generate.mjs` does (Task 9).
- **Placeholder scan:** no TBD/TODO; every step has runnable code and exact run commands.
- **Type/name consistency:** `tag`, `projectCount`, `totalStars`, `rank`, `growth` field names are identical across `tag-growth.mjs`'s outputs (Tasks 1-3) and every `render-page.mjs` consumer (Tasks 4-6); `tagSlug` is defined once (Task 4) and reused by Tasks 5, 6, 8 (client-side duplicate), and 9 — never redefined differently.
