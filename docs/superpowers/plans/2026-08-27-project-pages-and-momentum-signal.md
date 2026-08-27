# Project Pages & Always-On Momentum Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every project a canonical, shareable `/projects/<owner>/<repo>/` page, make momentum visible in the detail panel regardless of Popular/Rising mode, and add a derived "why this is interesting" signal line — reusing data the generator already computes.

**Architecture:** A new pure module (`scripts/signal.mjs`) derives the narrative line from existing per-project and per-category growth data. `render-page.mjs` gains a `renderProjectPage` function that reuses existing formatting helpers (`renderMomentumStat`, `escapeHtml`, `renderJsonLd`) and the same star-history sparkline math the client-side detail panel already uses (`app/shared/star-history.js`, plain ESM, importable from Node build-time code). `generate.mjs` wires it all together in a new pass after the existing per-tag-page pass. The detail panel gets two small, independent fixes: momentum defaults to a 7-day window in Popular mode instead of showing nothing, and a new "View full project page" link (omitted in embeds).

**Tech Stack:** Node.js (`node --test`), no framework — matches the rest of `scripts/`/`app/shared/`.

**Spec:** `docs/superpowers/specs/2026-08-27-project-pages-and-momentum-signal-design.md`

## Global Constraints

- Project page URL: `/projects/<owner>/<repo>/`, built directly from `project.id` (already `owner/repo` shaped) — no separate slugification.
- A project curated into more than one domain gets exactly one page, attributed via the same last-write-wins dedup `generate.mjs` already applies for global tag groups (`allProjectsWithDomain`) — no new dedup policy.
- The signal's category-relative comparison is always pinned to the 7-day window (`MOMENTUM_WINDOW_DAYS`/`categoryGrowthBySlug`, as already computed for the "Where the heat is" widget) — not widened to 30/90d.
- No related-projects list, no "also listed in" cross-domain note, no site search, no rising-page trend visuals, no treemap hash-routing, and no embed variant of project pages — all explicitly out of scope for this plan (see spec's Non-goals).
- No new persisted data file — everything is derived at build time from data `generate.mjs` already parses.
- Reuse existing CSS classes/tokens wherever the visual need matches (`.detail-panel-logo`, `.detail-panel-tags`/`.detail-panel-tag`, `.detail-panel-star-chart*`, `.detail-panel-link`/`.detail-panel-stars`, `.momentum-stat`) rather than inventing near-duplicates.

---

## File Structure

```
/scripts/
  signal.mjs                      # NEW — pure: sustained-vs-spike, relative-to-category, headline
  seo.mjs                         # CHANGED — buildSoftwareSourceCodeJsonLd()
  render-page.mjs                 # CHANGED — renderProjectPage() + helpers; showProjectPageLink threading
  generate.mjs                    # CHANGED — Pass 4: canonical project pages, sitemap entries
/app/shared/
  detail-panel.js                 # CHANGED — always-on 7d momentum fallback, project-page link
  treemap.css                     # CHANGED — .project-* rules for the new page
/test/
  signal.test.js                  # NEW
  seo.test.js                     # CHANGED
  render-page.test.js             # CHANGED
```

---

### Task 1: `scripts/signal.mjs` — signal derivation

**Files:**
- Create: `scripts/signal.mjs`
- Test: `test/signal.test.js`

**Interfaces:**
- Consumes: `RISING_WINDOWS_DAYS` (`[7, 30, 90]`) from `scripts/velocity.mjs`.
- Produces: `explainSignal({ growthByWindow, hasEnoughHistory, categoryGrowth7d, categoryName })` → `{ sustained: boolean | null, relativeMultiple: number | null, headline: string | null }`.
  - `growthByWindow` / `hasEnoughHistory`: a project's own `growth` / `hasEnoughHistory` objects as built by `computeProjectSizing` in `velocity.mjs` (keyed `rising7`/`rising30`/`rising90`; `growth[key]` is `{ starDelta, percentDelta, oldestDate }`).
  - `categoryGrowth7d`: one category's 7-day `computeGroupGrowth` result (e.g. one `categoryGrowthBySlug[domainSlug]` entry's `.growth`), or `undefined`.
  - `categoryName`: string used only to word the relative-growth clause.
  - Consumed by Task 3 (`renderProjectPage`) and Task 4 (`generate.mjs`, which calls `explainSignal` and passes the result into `renderProjectPage`).

- [ ] **Step 1: Write the failing tests**

Create `test/signal.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { explainSignal } from "../scripts/signal.mjs";

/** Builds one window's growth entry, the shape computeProjectSizing produces. */
function growth(starDelta, percentDelta) {
  return { starDelta, percentDelta, oldestDate: "2026-05-01" };
}

const ALL_TRACKED = { rising7: true, rising30: true, rising90: true };

test("sustained is true when every window shows positive growth", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 5), rising30: growth(200, 20), rising90: growth(500, 60) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, true);
});

test("sustained is false when only the 7-day window is positive (a spike)", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 5), rising30: growth(-10, -1), rising90: growth(500, 60) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, false);
});

test("sustained is null when the 7-day window isn't positive either, even if a longer window is", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(-5, -1), rising30: growth(-10, -1), rising90: growth(500, 60) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, null);
});

test("sustained is null when any window lacks enough history", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 5), rising30: growth(200, 20), rising90: growth(0, 0) },
    hasEnoughHistory: { rising7: true, rising30: true, rising90: false },
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, null);
});

test("relativeMultiple is the project's 7-day percentDelta divided by the category's", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 2 },
  });
  assert.equal(result.relativeMultiple, 5);
});

test("relativeMultiple is null when the category has no history yet", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: false, percentDelta: 0 },
  });
  assert.equal(result.relativeMultiple, null);
});

test("relativeMultiple is null when the category is flat or shrinking", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: -1 },
  });
  assert.equal(result.relativeMultiple, null);
});

test("relativeMultiple is null when categoryGrowth7d is undefined (e.g. a brand-new category)", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.relativeMultiple, null);
});

test("relativeMultiple is null when the project's own 7-day window isn't tracked", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(0, 0), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: { rising7: false, rising30: true, rising90: true },
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 2 },
  });
  assert.equal(result.relativeMultiple, null);
});

test("relativeMultiple is null when the project's own 7-day growth isn't positive, even if the category is growing", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(-5, -1), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 2 },
  });
  assert.equal(result.relativeMultiple, null);
});

test("headline combines both clauses when both signals are available", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 2 },
    categoryName: "LLM Frameworks",
  });
  assert.equal(result.headline, "Growing steadily, 5.0× faster than LLM Frameworks this week");
});

test("headline uses only the sustained clause when there's no category to compare against", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.headline, "Growing steadily this week");
});

test("headline uses only the relative clause when sustained is null because a longer window lacks history", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(0, 0) },
    hasEnoughHistory: { rising7: true, rising30: true, rising90: false },
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 2 },
    categoryName: "LLM Frameworks",
  });
  assert.equal(result.sustained, null);
  assert.equal(result.headline, "5.0× faster than LLM Frameworks this week");
});

test("headline reports a plain spike when sustained is false and no category comparison is available", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 5), rising30: growth(-10, -1), rising90: growth(500, 60) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.headline, "Recent spike this week");
});

test("headline is null when neither signal is available", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(-5, -1), rising30: growth(-10, -1), rising90: growth(-500, -60) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.headline, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/signal.test.js`
Expected: FAIL — `Cannot find module '../scripts/signal.mjs'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `scripts/signal.mjs`:

```js
import { RISING_WINDOWS_DAYS } from "./velocity.mjs";

/**
 * Derives a short "why is this interesting" narrative from a project's own
 * per-window growth (as built by `computeProjectSizing` in velocity.mjs)
 * and its category's 7-day growth (a `computeGroupGrowth` result, e.g. one
 * entry of `categoryGrowthBySlug` in generate.mjs). Pure — no I/O, no
 * knowledge of HTML or routing, same shape as group-growth.mjs's/
 * tag-growth.mjs's other derivation functions.
 *
 * `growthByWindow`/`hasEnoughHistory` are a project's own `growth`/
 * `hasEnoughHistory` objects, each keyed `rising7`/`rising30`/`rising90`.
 * `categoryGrowth7d` is the project's category's 7-day `computeGroupGrowth`
 * result (may be `undefined` for a category with no growth data at all —
 * e.g. one that's brand new). `categoryName` only words the relative-growth
 * clause; passing it as `undefined` degrades to the sustained-only clause.
 *
 * Returns `{ sustained, relativeMultiple, headline }` — see
 * `computeSustained`/`computeRelativeMultiple`/`buildHeadline` below for
 * what each means and when each is `null`.
 */
export function explainSignal({ growthByWindow, hasEnoughHistory, categoryGrowth7d, categoryName }) {
  const sustained = computeSustained(growthByWindow, hasEnoughHistory);
  const relativeMultiple = computeRelativeMultiple(growthByWindow, hasEnoughHistory, categoryGrowth7d);
  const headline = buildHeadline(sustained, relativeMultiple, categoryName);
  return { sustained, relativeMultiple, headline };
}

/**
 * `true` when every RISING_WINDOWS_DAYS window shows positive growth (a
 * sustained riser), `false` when only the shortest window does (a
 * short-term spike), `null` when there's nothing to say — either a window
 * is missing history, or the shortest window isn't even positive.
 */
function computeSustained(growthByWindow, hasEnoughHistory) {
  const allTracked = RISING_WINDOWS_DAYS.every((windowDays) => hasEnoughHistory?.[`rising${windowDays}`]);
  if (!allTracked) return null;

  const allPositive = RISING_WINDOWS_DAYS.every((windowDays) => growthByWindow[`rising${windowDays}`].starDelta > 0);
  if (allPositive) return true;

  return growthByWindow.rising7.starDelta > 0 ? false : null;
}

/**
 * How many times faster the project grew (7-day window) than its category
 * did over the same period, or `null` when the comparison wouldn't be
 * meaningful: the project's own 7-day growth isn't tracked or isn't
 * positive (nothing to call "faster"), or the category's isn't tracked or
 * isn't positive (dividing by a flat/shrinking baseline isn't a real
 * "faster than" claim).
 */
function computeRelativeMultiple(growthByWindow, hasEnoughHistory, categoryGrowth7d) {
  if (!hasEnoughHistory?.rising7) return null;
  const projectPercent = growthByWindow.rising7.percentDelta;
  if (!(projectPercent > 0)) return null;
  if (!categoryGrowth7d?.hasEnoughHistory) return null;
  if (!(categoryGrowth7d.percentDelta > 0)) return null;
  return projectPercent / categoryGrowth7d.percentDelta;
}

/** Composes whichever of the two clauses is available into one sentence, or `null` if neither is. */
function buildHeadline(sustained, relativeMultiple, categoryName) {
  const sustainedClause = sustained === true ? "Growing steadily" : sustained === false ? "Recent spike" : null;
  const relativeClause =
    typeof relativeMultiple === "number" && categoryName
      ? `${relativeMultiple.toFixed(1)}× faster than ${categoryName} this week`
      : null;

  if (sustainedClause && relativeClause) return `${sustainedClause}, ${relativeClause}`;
  if (sustainedClause) return `${sustainedClause} this week`;
  if (relativeClause) return relativeClause;
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/signal.test.js`
Expected: PASS, all 15 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/signal.mjs test/signal.test.js
git commit -m "feat: add explainSignal — sustained-vs-spike and category-relative growth narrative

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `scripts/seo.mjs` — `buildSoftwareSourceCodeJsonLd`

**Files:**
- Modify: `scripts/seo.mjs`
- Test: `test/seo.test.js`

**Interfaces:**
- Produces: `buildSoftwareSourceCodeJsonLd({ name, description, url, codeRepository })` → plain object, `{ "@context": "https://schema.org", "@type": "SoftwareSourceCode", name, description, url, codeRepository }`. Consumed by Task 3 (`renderProjectPage`).

- [ ] **Step 1: Write the failing test**

Add to `test/seo.test.js` (extend the existing import line and append this test):

```js
import { buildSitemap, buildRobots, buildWebsiteJsonLd, buildItemListJsonLd, buildSoftwareSourceCodeJsonLd } from "../scripts/seo.mjs";
```

```js
test("buildSoftwareSourceCodeJsonLd returns a schema.org SoftwareSourceCode object", () => {
  const jsonLd = buildSoftwareSourceCodeJsonLd({
    name: "llama.cpp",
    description: "Inference of LLaMA and other large language models in pure C/C++",
    url: "https://example.com/projects/ggerganov/llama.cpp/",
    codeRepository: "https://github.com/ggerganov/llama.cpp",
  });
  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(jsonLd["@type"], "SoftwareSourceCode");
  assert.equal(jsonLd.name, "llama.cpp");
  assert.equal(jsonLd.description, "Inference of LLaMA and other large language models in pure C/C++");
  assert.equal(jsonLd.url, "https://example.com/projects/ggerganov/llama.cpp/");
  assert.equal(jsonLd.codeRepository, "https://github.com/ggerganov/llama.cpp");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/seo.test.js`
Expected: FAIL — `buildSoftwareSourceCodeJsonLd is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `scripts/seo.mjs`:

```js
/**
 * Builds a schema.org SoftwareSourceCode JSON-LD object for one project's
 * canonical page — mirrors buildItemListJsonLd's plain-object style (the
 * caller JSON.stringify's it). `codeRepository` is the project's GitHub
 * URL.
 */
export function buildSoftwareSourceCodeJsonLd({ name, description, url, codeRepository }) {
  return { "@context": "https://schema.org", "@type": "SoftwareSourceCode", name, description, url, codeRepository };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/seo.test.js`
Expected: PASS, all tests (existing + new) green.

- [ ] **Step 5: Commit**

```bash
git add scripts/seo.mjs test/seo.test.js
git commit -m "feat: add buildSoftwareSourceCodeJsonLd for project pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `scripts/render-page.mjs` — `renderProjectPage`

**Files:**
- Modify: `scripts/render-page.mjs`
- Test: `test/render-page.test.js`

**Interfaces:**
- Consumes:
  - `explainSignal`'s return shape from Task 1 (`{ sustained, relativeMultiple, headline }`), passed in as the `signal` param (already computed by the caller — this function doesn't call `explainSignal` itself).
  - `buildSoftwareSourceCodeJsonLd` from Task 2.
  - `githubRepoUrl`, `buildSparklinePath`, `starHistoryCaption` from `app/shared/star-history.js` (existing, pure, Node-importable).
  - `RISING_WINDOWS_DAYS` (already imported in this file).
  - Existing in-file helpers: `escapeHtml`, `renderJsonLd`, `renderShell`, `renderSiteHeader`, `renderSiteFooter`, `renderMomentumStat`, `formatStars`, `tagSlug`.
- Produces: `renderProjectPage(project, { domain, signal, historySeries, defaultOgImage, siteUrl, basePath })` → full HTML string. `project` is a sized project record (has `id`, `name`, `desc`, `weight`, `image`, `link`, `tags`, `path`, `growth`, `hasEnoughHistory` — the shape every domain's leaf already has after `computeProjectSizing`). `domain` is `{ slug, name, shortName }`. `historySeries` defaults to `[]` (oldest-first `{date, stars}[]`, `starHistoryFor`'s output shape). Consumed by Task 4 (`generate.mjs`).

- [ ] **Step 1: Write the failing tests**

Add to `test/render-page.test.js`, extending the existing import line:

```js
import {
  renderDomainPage,
  renderLandingPage,
  renderRisingPage,
  renderTagsIndexPage,
  renderTagPage,
  renderProjectPage,
  tagSlug,
} from "../scripts/render-page.mjs";
```

Append these fixtures and tests:

```js
const PROJECT = {
  id: "ggerganov/llama.cpp",
  name: "llama.cpp",
  desc: "Inference of LLaMA and other large language models in pure C/C++",
  weight: 125701,
  image: "https://avatars.githubusercontent.com/u/1?v=4",
  link: "https://github.com/ggerganov/llama.cpp",
  tags: ["ggml"],
  path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"],
  growth: {
    rising7: { starDelta: 500, percentDelta: 0.4, oldestDate: "2026-08-01" },
    rising30: { starDelta: 2000, percentDelta: 1.6, oldestDate: "2026-07-01" },
    rising90: { starDelta: 6000, percentDelta: 5.0, oldestDate: "2026-05-01" },
  },
  hasEnoughHistory: { rising7: true, rising30: true, rising90: true },
};

const PROJECT_DOMAIN = { slug: "artificial-intelligence", name: "Artificial Intelligence", shortName: "AI" };

const NO_SIGNAL = { sustained: null, relativeMultiple: null, headline: null };

test("renderProjectPage renders a momentum chip for each rising window", () => {
  const html = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png" });
  assert.match(html, /project-momentum-chip-window">7d</);
  assert.match(html, /project-momentum-chip-window">30d</);
  assert.match(html, /project-momentum-chip-window">90d</);
  assert.match(html, /\+500/);
  assert.match(html, /\+6,000/);
});

test("renderProjectPage renders the signal headline when present, and omits the element when null", () => {
  const withSignal = renderProjectPage(PROJECT, {
    domain: PROJECT_DOMAIN,
    signal: { sustained: true, relativeMultiple: 3.2, headline: "Growing steadily, 3.2× faster than LLM Infrastructure this week" },
    defaultOgImage: "/og-default.png",
  });
  assert.match(withSignal, /class="project-signal">Growing steadily, 3\.2× faster than LLM Infrastructure this week</);

  const withoutSignal = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png" });
  assert.doesNotMatch(withoutSignal, /class="project-signal"/);
});

test("renderProjectPage includes SoftwareSourceCode JSON-LD with the project's name, description, and GitHub URL", () => {
  const html = renderProjectPage(PROJECT, {
    domain: PROJECT_DOMAIN,
    signal: NO_SIGNAL,
    defaultOgImage: "/og-default.png",
    siteUrl: "https://example.com",
    basePath: "",
  });
  assert.match(html, /"@type":"SoftwareSourceCode"/);
  assert.match(html, /"name":"llama\.cpp"/);
  assert.match(html, /"codeRepository":"https:\/\/github\.com\/ggerganov\/llama\.cpp"/);
  assert.match(html, /"url":"https:\/\/example\.com\/projects\/ggerganov\/llama\.cpp\/"/);
});

test("renderProjectPage's breadcrumb links to the domain page and lists every level of the project's category path", () => {
  const html = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(html, /<a href="\/artificial-intelligence\/">AI<\/a>/);
  assert.match(html, />LLM Infrastructure<\/span>/);
  assert.match(html, />LLM Frameworks &amp; Runtimes<\/span>/);
});

test("renderProjectPage renders tag chips linking to /tags/<slug>/", () => {
  const html = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(html, /class="detail-panel-tag" href="\/tags\/ggml\/">ggml</);
});

test("renderProjectPage renders a star-history sparkline when given at least two history points, and omits it otherwise", () => {
  const withHistory = renderProjectPage(PROJECT, {
    domain: PROJECT_DOMAIN,
    signal: NO_SIGNAL,
    defaultOgImage: "/og-default.png",
    historySeries: [
      { date: "2026-08-01", stars: 120000 },
      { date: "2026-08-08", stars: 125701 },
    ],
  });
  assert.match(withHistory, /class="detail-panel-star-chart"/);
  assert.match(withHistory, /125,701 stars since/);

  const withoutHistory = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png" });
  assert.doesNotMatch(withoutHistory, /class="detail-panel-star-chart"/);
});

test("renderProjectPage's canonical URL is shaped /projects/<id>/, and gets the BASE_PATH prefix", () => {
  const html = renderProjectPage(PROJECT, {
    domain: PROJECT_DOMAIN,
    signal: NO_SIGNAL,
    defaultOgImage: "/og-default.png",
    siteUrl: "https://example.com",
    basePath: "/techmap",
  });
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/techmap\/projects\/ggerganov\/llama\.cpp\/"/);
});

test("renderProjectPage's momentum chip reports 'not tracked yet' for a window with insufficient history", () => {
  const project = { ...PROJECT, hasEnoughHistory: { rising7: true, rising30: true, rising90: false } };
  const html = renderProjectPage(project, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png" });
  assert.match(html, /Not tracked yet — first tracked 2026-05-01/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render-page.test.js`
Expected: FAIL — `renderProjectPage is not a function` (not exported yet).

- [ ] **Step 3: Write the implementation**

In `scripts/render-page.mjs`, change the top imports from:

```js
import { RISING_WINDOWS_DAYS } from "./velocity.mjs";
import { rankGroups } from "./group-growth.mjs";
import { buildWebsiteJsonLd, buildItemListJsonLd } from "./seo.mjs";
```

to:

```js
import { RISING_WINDOWS_DAYS } from "./velocity.mjs";
import { rankGroups } from "./group-growth.mjs";
import { buildWebsiteJsonLd, buildItemListJsonLd, buildSoftwareSourceCodeJsonLd } from "./seo.mjs";
import { githubRepoUrl, buildSparklinePath, starHistoryCaption } from "../app/shared/star-history.js";
```

Then append these functions at the end of the file (after `renderTagPage`):

```js
/**
 * Merges a project's parallel `growth`/`hasEnoughHistory` objects (as built
 * by `computeProjectSizing` in velocity.mjs, kept separate for the
 * treemap's own sizing use) into the single `{ ...growth, hasEnoughHistory
 * }` shape `renderMomentumStat` expects — the same shape a
 * `computeGroupGrowth` result already carries inline.
 */
function projectGrowthStat(project, windowDays) {
  const key = `rising${windowDays}`;
  return { ...project.growth?.[key], hasEnoughHistory: project.hasEnoughHistory?.[key] === true };
}

/**
 * Renders a project page's breadcrumb: Home, its canonical domain, then
 * every level of its category path (e.g. two segments for the
 * artificial-intelligence domain's nested categories) — a display-only
 * walk of `project.path`. The signal's category-relative comparison (built
 * in generate.mjs) is always pinned to `path[0]` regardless of how many
 * levels render here.
 */
function renderProjectBreadcrumb(project, domain, basePath) {
  const crumbs = [
    `<a href="${basePath}/">Home</a>`,
    `<a href="${basePath}/${escapeHtml(domain.slug)}/">${escapeHtml(domain.shortName ?? domain.name)}</a>`,
    ...(project.path ?? []).map((segment) => `<span>${escapeHtml(segment)}</span>`),
  ];
  return `<nav class="project-breadcrumb" aria-label="Breadcrumb">${crumbs.join(" › ")}</nav>`;
}

/**
 * Server-rendered star-history sparkline for a project page — reuses the
 * same SVG path math app/shared/star-history.js already provides for the
 * client-side detail panel (a static page has no client fetch to lazily
 * draw it from). `historySeries` is `starHistoryFor`'s output (oldest-first
 * `{date, stars}[]`). Renders nothing when there are fewer than 2 points,
 * matching `buildSparklinePath`'s own "nothing to draw" convention.
 */
function renderProjectStarChart(historySeries) {
  const spark = buildSparklinePath(historySeries);
  if (!spark) return "";
  const caption = starHistoryCaption(historySeries);
  return `
    <div class="detail-panel-star-chart">
      <svg class="detail-panel-star-chart-svg" viewBox="0 0 ${spark.width} ${spark.height}" width="${spark.width}" height="${spark.height}">
        <path d="${spark.path}" />
      </svg>
      <p class="detail-panel-star-chart-caption">${escapeHtml(caption)}</p>
    </div>`;
}

/**
 * Server-rendered tag chips for a project page — same visual/routing
 * convention as the detail panel's client-rendered chips
 * (app/shared/detail-panel.js's renderTagChips), reimplemented as an HTML
 * string since this runs at build time, not in the browser.
 */
function renderProjectTagChips(tags, basePath) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  const chips = tags
    .map((tag) => `<a class="detail-panel-tag" href="${basePath}/tags/${tagSlug(tag)}/">${escapeHtml(tag)}</a>`)
    .join("");
  return `<div class="detail-panel-tags">${chips}</div>`;
}

/**
 * Renders one project's canonical page — the shareable, indexable home for
 * a project that today only exists as ephemeral detail-panel state inside
 * one domain's treemap. `project` is a sized project record (see
 * velocity.mjs's `computeProjectSizing` — `growth`/`hasEnoughHistory` keyed
 * per rising window). `domain` is `{ slug, name, shortName }` — the
 * project's canonical domain (see generate.mjs's last-write-wins dedup).
 * `signal` is an `explainSignal` result (scripts/signal.mjs), already
 * computed by the caller. `historySeries` is `starHistoryFor`'s output for
 * this project.
 */
export function renderProjectPage(
  project,
  { domain, signal, historySeries = [], defaultOgImage, siteUrl = "", basePath = "" }
) {
  const ogUrl = `${siteUrl}${basePath}/projects/${project.id}/`;
  const jsonLd = renderJsonLd(
    buildSoftwareSourceCodeJsonLd({
      name: project.name ?? project.id,
      description: project.desc ?? "",
      url: ogUrl,
      codeRepository: githubRepoUrl(project.id),
    })
  );

  const momentumChips = RISING_WINDOWS_DAYS.map(
    (windowDays) => `
      <div class="project-momentum-chip">
        <span class="project-momentum-chip-window">${windowDays}d</span>
        ${renderMomentumStat(projectGrowthStat(project, windowDays), { windowDays })}
      </div>`
  ).join("");

  const body = `
    ${renderSiteHeader(basePath)}
    ${jsonLd}
    <header class="project-hero">
      ${renderProjectBreadcrumb(project, domain, basePath)}
      ${project.image ? `<img class="detail-panel-logo" src="${escapeHtml(project.image)}" alt="" loading="lazy" />` : ""}
      <h1>${escapeHtml(project.name ?? project.id)}</h1>
      ${project.desc ? `<p class="project-hero-desc">${escapeHtml(project.desc)}</p>` : ""}
      ${signal.headline ? `<p class="project-signal">${escapeHtml(signal.headline)}</p>` : ""}
    </header>
    <div class="project-body">
      <div class="project-momentum-grid">${momentumChips}</div>
      ${renderProjectStarChart(historySeries)}
      <div class="project-links">
        <a class="detail-panel-stars" href="${githubRepoUrl(project.id)}" target="_blank" rel="noopener">★ ${formatStars(project.weight ?? 0)} stars on GitHub</a>
        ${project.link ? `<a class="detail-panel-link" href="${escapeHtml(project.link)}" target="_blank" rel="noopener">Visit site ↗</a>` : ""}
      </div>
      ${renderProjectTagChips(project.tags, basePath)}
    </div>
    ${renderSiteFooter()}
  `;

  return renderShell({
    title: `${project.name ?? project.id} — awesomemap`,
    ogTitle: project.name ?? project.id,
    ogDescription: project.desc ?? "",
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render-page.test.js`
Expected: PASS, all tests (existing + new) green.

- [ ] **Step 5: Commit**

```bash
git add scripts/render-page.mjs test/render-page.test.js
git commit -m "feat: add renderProjectPage — canonical per-project page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `scripts/generate.mjs` — wire up `/projects/` pages

**Files:**
- Modify: `scripts/generate.mjs`

**Interfaces:**
- Consumes: `renderProjectPage` (Task 3), `explainSignal` (Task 1), `starHistoryFor` from `app/shared/star-history.js`, plus existing in-file state: `allProjectsWithDomain` (each entry already carries `domainSlug`/`domainShort`), `globalHistoryById`, `categoryGrowthBySlug` (all already computed before this insertion point).
- Produces: one `dist/projects/<owner>/<repo>/index.html` per canonical project, and their paths appended to the sitemap's `extraPaths`.

No automated test — `generate.mjs` is orchestration glue over already-tested pure modules, verified manually via `npm run generate`, matching this file's existing convention (no `generate.test.js` exists for any of its other passes either).

- [ ] **Step 1: Update imports**

At the top of `scripts/generate.mjs`, change:

```js
import { renderDomainPage, renderLandingPage, renderRisingPage, renderTagsIndexPage, renderTagPage, tagSlug } from "./render-page.mjs";
```

to:

```js
import { renderDomainPage, renderLandingPage, renderRisingPage, renderTagsIndexPage, renderTagPage, renderProjectPage, tagSlug } from "./render-page.mjs";
import { explainSignal } from "./signal.mjs";
import { starHistoryFor } from "../app/shared/star-history.js";
```

- [ ] **Step 2: Insert Pass 4 after the per-tag pages loop**

Find this existing block (the end of the per-tag pages loop):

```js
  tagPagePaths.push(`/tags/${slug}/`);
}

cpSync(`${APP_DIR}/shared`, `${DIST_DIR}/shared`, { recursive: true });
```

Insert the new pass between the closing `}` of the loop and the `cpSync` line:

```js
  tagPagePaths.push(`/tags/${slug}/`);
}

// Pass 4: render one canonical page per project — see the project-pages
// design spec. Reuses the same last-write-wins dedup already computed
// above for global tag groups (`allProjectsWithDomain`), so a project
// curated into more than one domain gets exactly one page, attributed to
// whichever domain won that dedup.
mkdirSync(`${DIST_DIR}/projects`, { recursive: true });
const projectPagePaths = [];
for (const project of allProjectsWithDomain) {
  const idParts = project.id.split("/");
  if (idParts.length !== 2 || idParts.some((part) => part.length === 0)) {
    throw new Error(`project "${project.id}": "id" must be a GitHub "owner/repo" shorthand to build its /projects/ page`);
  }

  const categoryEntry = categoryGrowthBySlug[project.domainSlug]?.find((category) => category.key === project.path[0]);
  const signal = explainSignal({
    growthByWindow: project.growth,
    hasEnoughHistory: project.hasEnoughHistory,
    categoryGrowth7d: categoryEntry?.growth,
    categoryName: categoryEntry?.key,
  });
  const historySeries = starHistoryFor(globalHistoryById, project.id);

  // `allProjectsWithDomain` already carries `domainSlug`/`domainShort`
  // (see the dedup pass above) — `domainShort` is already `domain.shortName
  // ?? domain.name`, so there's no need to look the domain back up in
  // `domains` just to re-derive the same fallback.
  mkdirSync(`${DIST_DIR}/projects/${project.id}`, { recursive: true });
  writeFileSync(
    `${DIST_DIR}/projects/${project.id}/index.html`,
    renderProjectPage(project, {
      domain: { slug: project.domainSlug, shortName: project.domainShort },
      signal,
      historySeries,
      defaultOgImage: DEFAULT_OG_IMAGE,
      siteUrl: SITE_URL,
      basePath: BASE_PATH,
    })
  );
  projectPagePaths.push(`/projects/${project.id}/`);
}

cpSync(`${APP_DIR}/shared`, `${DIST_DIR}/shared`, { recursive: true });
```

- [ ] **Step 3: Add project page paths to the sitemap**

Find:

```js
const sitemap = buildSitemap(domains.map((d) => d.slug), {
  siteUrl: SITE_URL,
  basePath: BASE_PATH,
  extraPaths: ["/tags/", ...tagPagePaths],
});
```

Change `extraPaths` to:

```js
  extraPaths: ["/tags/", ...tagPagePaths, ...projectPagePaths],
```

- [ ] **Step 4: Verify manually**

Run:

```bash
BASE_PATH= SITE_URL=https://example.com npm run generate
```

Expected:
- No thrown errors.
- `ls dist/projects/ggerganov/llama.cpp/index.html` exists (or another real `owner/repo` from `data/artificial-intelligence.json`).
- `grep -c 'SoftwareSourceCode' dist/projects/*/*/index.html | head` shows JSON-LD present.
- `grep '/projects/' dist/sitemap.xml | head` shows project page URLs.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate.mjs
git commit -m "feat: generate one canonical /projects/ page per project

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `app/shared/detail-panel.js` — always-on momentum + project-page link

**Files:**
- Modify: `app/shared/detail-panel.js`

**Interfaces:**
- Produces: `createDetailPanel(container, { historyUrl, basePath, showProjectPageLink = true })` — new `showProjectPageLink` option (defaults `true`), consumed by Task 6 (`render-page.mjs`'s embed branch passes `false`).

No automated test exists for this file today (browser-DOM module, no jsdom in this repo) — verified manually in Task 8, matching the convention already used for this file's prior accessibility work.

- [ ] **Step 1: Add the default-window fallback constant**

Near the top of `app/shared/detail-panel.js`, after the existing imports, add:

```js
// Popular mode has no "active" rising window of its own, but every leaf
// still carries growth data for every window (see velocity.mjs's
// computeProjectSizing) — defaulting to the shortest window here is what
// makes momentum visible in Popular mode, not just Rising mode. Duplicated
// from scripts/velocity.mjs's RISING_WINDOWS_DAYS[0] rather than imported,
// for the same reason treemap.js's own copy of that list is duplicated:
// scripts/ is build-time-only and never copied into dist/.
const DEFAULT_MOMENTUM_WINDOW_DAYS = 7;
```

- [ ] **Step 2: Make `renderGrowthLine` mode-independent**

Replace:

```js
function renderGrowthLine(leafData) {
  const key = leafData.activeSizeKey;
  if (!key || key === "popular") return null;

  const paragraph = document.createElement("p");
  paragraph.className = "detail-panel-growth";
```

with:

```js
function renderGrowthLine(leafData) {
  const key =
    leafData.activeSizeKey && leafData.activeSizeKey !== "popular"
      ? leafData.activeSizeKey
      : `rising${DEFAULT_MOMENTUM_WINDOW_DAYS}`;

  const paragraph = document.createElement("p");
  paragraph.className = "detail-panel-growth";
```

(the rest of the function — `windowDays`, `stats`, the insufficient-history branch, and the final formatted line — is unchanged).

Update the function's doc comment from:

```js
/**
 * Builds the Rising-mode growth line ("+340 stars (+18%) in 30 days", or
 * an insufficient-history notice) for `leafData.activeSizeKey`. Returns
 * `null` for Popular mode (no `activeSizeKey`, or `"popular"`) — there's
 * no growth stat to show there.
 */
```

to:

```js
/**
 * Builds the growth line ("+340 stars (+18%) in 30 days", or an
 * insufficient-history notice) for `leafData.activeSizeKey`. In Popular
 * mode (no `activeSizeKey`, or `"popular"`) this falls back to
 * DEFAULT_MOMENTUM_WINDOW_DAYS rather than showing nothing — Popular is the
 * mode every visitor lands in by default, so it's the one place a momentum
 * blind spot mattered most.
 */
```

- [ ] **Step 3: Add the `showProjectPageLink` option and the link itself**

Change the `createDetailPanel` signature from:

```js
export function createDetailPanel(container, { historyUrl, basePath = "" } = {}) {
```

to:

```js
export function createDetailPanel(container, { historyUrl, basePath = "", showProjectPageLink = true } = {}) {
```

Then, inside `open(leafData)`, immediately after the existing `if (leafData.link) { ... }` block that renders "Visit site ↗", add:

```js
    if (showProjectPageLink && leafData.id) {
      const projectLink = document.createElement("a");
      projectLink.className = "detail-panel-link";
      projectLink.href = `${basePath}/projects/${leafData.id}/`;
      projectLink.textContent = "View full project page →";
      panel.appendChild(projectLink);
    }
```

- [ ] **Step 4: Verify manually**

```bash
npm run generate && npx --yes serve dist -l 5000
```

Open a domain page, click a leaf while in Popular mode (the default): confirm a growth line now appears (previously blank), and a "View full project page →" link appears below "Visit site ↗", pointing at `/projects/<id>/`.

- [ ] **Step 5: Commit**

```bash
git add app/shared/detail-panel.js
git commit -m "feat: show momentum in Popular mode, add project-page link to the detail panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `scripts/render-page.mjs` — thread `showProjectPageLink` for embeds

**Files:**
- Modify: `scripts/render-page.mjs`
- Test: `test/render-page.test.js`

**Interfaces:**
- Consumes: `showProjectPageLink` option from Task 5's `createDetailPanel`.
- Produces: the non-embed `renderDomainPage` output passes `showProjectPageLink: true`; the embed variant passes `showProjectPageLink: false` — mirroring how `renderDomainPage` already omits header/footer/teaser chrome at the call-site level for embeds, rather than teaching `detail-panel.js` an `embed` flag of its own.

- [ ] **Step 1: Write the failing tests**

In `test/render-page.test.js`, find the existing test:

```js
test("the detail panel is created with a historyUrl pointing at the domain's own history.json, prefixed by BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const rootHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(rootHtml, /createDetailPanel\(document\.body, \{ historyUrl: "\/data-science\/history\.json", basePath: "" \}\)/);

  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(
    prefixedHtml,
    /createDetailPanel\(document\.body, \{ historyUrl: "\/techmap\/data-science\/history\.json", basePath: "\/techmap" \}\)/
  );
});
```

Replace it with (updated regexes plus a new embed-specific test):

```js
test("the detail panel is created with a historyUrl pointing at the domain's own history.json, prefixed by BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const rootHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(
    rootHtml,
    /createDetailPanel\(document\.body, \{ historyUrl: "\/data-science\/history\.json", basePath: "", showProjectPageLink: true \}\)/
  );

  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(
    prefixedHtml,
    /createDetailPanel\(document\.body, \{ historyUrl: "\/techmap\/data-science\/history\.json", basePath: "\/techmap", showProjectPageLink: true \}\)/
  );
});

test("the embed variant's detail panel has showProjectPageLink set to false", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "", embed: true });
  assert.match(
    html,
    /createDetailPanel\(document\.body, \{ historyUrl: "\/data-science\/history\.json", basePath: "", showProjectPageLink: false \}\)/
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render-page.test.js`
Expected: FAIL — the updated regex doesn't match the current (unchanged) output, which has no `showProjectPageLink` field yet.

- [ ] **Step 3: Write the implementation**

In `scripts/render-page.mjs`'s `renderDomainPage`, find:

```js
      const panel = createDetailPanel(document.body, { historyUrl: "${historyUrl}", basePath: "${basePath}" });
```

Replace with:

```js
      const panel = createDetailPanel(document.body, { historyUrl: "${historyUrl}", basePath: "${basePath}", showProjectPageLink: ${!embed} });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render-page.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/render-page.mjs test/render-page.test.js
git commit -m "feat: omit the project-page link from embedded detail panels

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `app/shared/treemap.css` — project page styles

**Files:**
- Modify: `app/shared/treemap.css`

**Interfaces:**
- Produces: `.project-hero`, `.project-hero-desc`, `.project-breadcrumb`, `.project-signal`, `.project-body`, `.project-momentum-grid`, `.project-momentum-chip`, `.project-momentum-chip-window`, `.project-links` — new classes referenced by Task 3's `renderProjectPage`. Reuses `.detail-panel-logo`, `.detail-panel-tags`/`.detail-panel-tag`, `.detail-panel-star-chart*`, `.detail-panel-link`/`.detail-panel-stars`, `.momentum-stat` (all pre-existing) rather than duplicating them.

No automated test — CSS isn't unit tested anywhere in this repo; verified visually in Task 8.

- [ ] **Step 1: Append the new rules**

Add to the end of `app/shared/treemap.css`:

```css
.project-hero {
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 24px 0;
  text-align: center;
}

.project-breadcrumb {
  font-size: 12px;
  color: var(--color-text-muted);
}

.project-breadcrumb a {
  color: var(--color-text-muted);
  text-decoration: none;
}

.project-breadcrumb a:hover {
  color: var(--color-accent);
}

.project-hero-desc {
  color: var(--color-text-muted);
}

.project-signal {
  margin: 8px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-accent);
}

.project-body {
  max-width: 640px;
  margin: 24px auto 48px;
  padding: 0 24px;
}

.project-momentum-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.project-momentum-chip {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.project-momentum-chip-window {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.project-body .detail-panel-star-chart {
  margin-top: 20px;
  text-align: center;
}

.project-links {
  margin-top: 16px;
  text-align: center;
}

.project-links .detail-panel-link,
.project-links .detail-panel-stars {
  display: inline-block;
  margin: 0 12px;
}

.project-body .detail-panel-tags {
  justify-content: center;
  margin-top: 16px;
}

@media (max-width: 480px) {
  .project-momentum-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Verify manually**

```bash
npm run generate && npx --yes serve dist -l 5000
```

Open `http://localhost:5000/projects/<owner>/<repo>/` for a real project from `data/`: confirm the three momentum chips lay out in a row (stack on narrow viewports), the breadcrumb/logo/title/signal line are centered and legible, the star chart and tag chips render, and both link buttons are visible and styled consistently with the treemap's existing detail panel.

- [ ] **Step 3: Commit**

```bash
git add app/shared/treemap.css
git commit -m "feat: style the project page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `signal.test.js` and the extended `seo.test.js`/`render-page.test.js`.

- [ ] **Step 2: Full local build**

Run: `BASE_PATH= SITE_URL=https://example.com npm run generate`
Expected: no errors; `dist/projects/` contains one directory per project across every domain in `data/`.

- [ ] **Step 3: Manual walkthrough**

Run: `npx --yes serve dist -l 5000`, then in a browser:
1. Open a domain page (e.g. `/artificial-intelligence/`). Click a leaf in Popular mode (the default): confirm a momentum line now shows (previously blank) and a "View full project page →" link is present.
2. Follow that link to `/projects/<owner>/<repo>/`: confirm the breadcrumb, momentum chips (7/30/90d), signal line (when the project qualifies), star-history sparkline, GitHub/homepage links, and tag chips all render correctly.
3. Open the same domain's embed page (`/embed/artificial-intelligence/`), open a leaf's panel: confirm momentum still shows, but the "View full project page →" link is absent.
4. Check `dist/sitemap.xml` includes `/projects/` URLs.
5. Spot-check a project whose category has enough history (e.g. one from a well-tracked domain) to see the signal headline in the browser, not just in tests.

- [ ] **Step 4: Report results**

Summarize pass/fail for each of the above in the session — no commit for this task (verification only, no file changes).
