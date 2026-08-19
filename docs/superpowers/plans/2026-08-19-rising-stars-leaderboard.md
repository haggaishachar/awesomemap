# Rising Stars Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-site rising-stars leaderboard — a dedicated `/rising/` page (global + per-domain top-20 lists, 7/30/90-day window toggle) plus short teasers on the landing page and each domain page — computed entirely from data already tracked, with no new persisted state.

**Architecture:** A new pure module (`scripts/leaderboard.mjs`) derives a ranked, rank-diffed, deduplicated leaderboard from the existing star-count history by re-running the existing velocity computation twice (as of today, as of yesterday) and diffing rank positions. `scripts/generate.mjs` computes it once per window/scope at build time and embeds the results into static HTML via new `scripts/render-page.mjs` renderers — no client-side computation, only a small script toggling which precomputed window is visible. `scripts/social-digest.mjs` is refactored onto the same shared module.

**Tech Stack:** Node.js (ESM, `node:test` for tests), no framework — matches the rest of the repo.

**Spec:** `docs/superpowers/specs/2026-08-18-rising-stars-leaderboard-design.md`

## Global Constraints

- Windows are always `[7, 30, 90]` days — reuse `RISING_WINDOWS_DAYS` exported from `scripts/velocity.mjs`; never redefine this list elsewhere (an existing comment in `app/shared/treemap.js` already warns about window lists drifting out of sync).
- A leaderboard entry requires enough history to score **both today and "yesterday" (now minus one day)** — no persisted "previous rank" state; both are derived from the same `data/history/<slug>.json` at build time.
- The **global** scope dedupes a project listed in multiple domains to its single best-scoring listing; **per-domain** scopes never dedupe.
- Full leaderboards (`/rising/` page): limit **20** entries, global + one per domain.
- Teasers (landing page, each domain page): limit **5** entries, always the **7-day** window, linking to the full page.
- Row fields: rank, icon (`image`), name+link, domain tag (global list only), up/down/flat rank-arrow with positions moved, star delta + percent (same numbers/format `computeVelocity` already produces).

---

### Task 1: `scripts/leaderboard.mjs` — ranked, rank-diffed, deduplicated leaderboard

**Files:**
- Create: `scripts/leaderboard.mjs`
- Test: `test/leaderboard.test.js`

**Interfaces:**
- Consumes: `computeVelocity(history, windowDays, { now })` and `MS_PER_DAY` from `scripts/velocity.mjs` (existing).
- Produces: `computeLeaderboard(domains, historyBySlug, { scope, windowDays, limit, now })` → `Array<{ rank, id, name, link, image, domain, domainSlug, starDelta, percentDelta, rankDelta }>`. `domains` is `[{ slug, name, projects: [{ id, name, link, image }] }]` (raw `data/<slug>.json` shape); `historyBySlug` maps slug to that domain's history file contents; `scope` is `"global"` or a domain `slug` string.

- [ ] **Step 1: Write the failing tests**

```javascript
// test/leaderboard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLeaderboard } from "../scripts/leaderboard.mjs";

const NOW = "2026-08-15T00:00:00.000Z";

const DOMAINS = [
  {
    slug: "data-science",
    name: "Data Science",
    projects: [
      { id: "a/a", name: "Project A", link: "https://a.example" },
      { id: "b/b", name: "Project B", link: "https://b.example" },
    ],
  },
  {
    slug: "security",
    name: "Security",
    projects: [{ id: "c/c", name: "Project C", link: "https://c.example" }],
  },
];

const HISTORY = {
  "data-science": {
    "a/a": [
      { date: "2026-08-05", stars: 100 },
      { date: "2026-08-14", stars: 110 },
      { date: "2026-08-15", stars: 150 },
    ],
    "b/b": [
      { date: "2026-08-05", stars: 500 },
      { date: "2026-08-14", stars: 600 },
      { date: "2026-08-15", stars: 610 },
    ],
  },
  security: {
    "c/c": [
      { date: "2026-08-05", stars: 50 },
      { date: "2026-08-14", stars: 80 },
      { date: "2026-08-15", stars: 200 },
    ],
  },
};

test("computeLeaderboard ranks by score descending and computes rank movement vs yesterday", () => {
  const result = computeLeaderboard(DOMAINS, HISTORY, { scope: "global", windowDays: 7, limit: 20, now: NOW });
  assert.deepEqual(result.map((r) => r.id), ["c/c", "b/b", "a/a"]);
  assert.deepEqual(result.map((r) => r.rank), [1, 2, 3]);

  const cRow = result.find((r) => r.id === "c/c");
  assert.equal(cRow.rankDelta, 1); // climbed from #2 (yesterday) to #1 (today)
  assert.equal(cRow.starDelta, 150);
  assert.equal(cRow.percentDelta, 300);

  const bRow = result.find((r) => r.id === "b/b");
  assert.equal(bRow.rankDelta, -1); // fell from #1 (yesterday) to #2 (today)

  const aRow = result.find((r) => r.id === "a/a");
  assert.equal(aRow.rankDelta, 0); // unchanged at #3
});

test("computeLeaderboard respects the limit", () => {
  const result = computeLeaderboard(DOMAINS, HISTORY, { scope: "global", windowDays: 7, limit: 2, now: NOW });
  assert.deepEqual(result.map((r) => r.id), ["c/c", "b/b"]);
});

test("computeLeaderboard scoped to one domain only ranks that domain's projects", () => {
  const result = computeLeaderboard(DOMAINS, HISTORY, { scope: "data-science", windowDays: 7, limit: 20, now: NOW });
  assert.deepEqual(result.map((r) => r.id), ["b/b", "a/a"]);
});

test("computeLeaderboard excludes a project with enough history today but not enough as of yesterday", () => {
  const domains = [
    {
      slug: "data-science",
      name: "Data Science",
      projects: [{ id: "d/d", name: "Project D", link: "https://d.example" }],
    },
  ];
  const history = {
    "data-science": {
      "d/d": [
        { date: "2026-08-08", stars: 10 }, // exactly at today's 7-day cutoff, but after yesterday's
        { date: "2026-08-15", stars: 500 },
      ],
    },
  };
  const result = computeLeaderboard(domains, history, { scope: "global", windowDays: 7, limit: 20, now: NOW });
  assert.deepEqual(result, []);
});

test("computeLeaderboard returns an empty list for a domain with no history yet", () => {
  const domains = [{ slug: "data-science", name: "Data Science", projects: [{ id: "a/a", name: "Project A", link: "https://a.example" }] }];
  const result = computeLeaderboard(domains, {}, { scope: "global", windowDays: 7, limit: 20, now: NOW });
  assert.deepEqual(result, []);
});

test("computeLeaderboard dedupes a project listed in multiple domains, keeping its best-scoring listing", () => {
  const domains = [
    { slug: "data-science", name: "Data Science", projects: [{ id: "e/e", name: "Project E", link: "https://e.example" }] },
    { slug: "security", name: "Security", projects: [{ id: "e/e", name: "Project E", link: "https://e.example" }] },
  ];
  const history = {
    "data-science": {
      "e/e": [
        { date: "2026-08-05", stars: 1000 },
        { date: "2026-08-14", stars: 1005 },
        { date: "2026-08-15", stars: 1010 },
      ],
    },
    security: {
      "e/e": [
        { date: "2026-08-05", stars: 20 },
        { date: "2026-08-14", stars: 25 },
        { date: "2026-08-15", stars: 100 },
      ],
    },
  };
  const result = computeLeaderboard(domains, history, { scope: "global", windowDays: 7, limit: 20, now: NOW });
  assert.equal(result.length, 1);
  assert.equal(result[0].domain, "Security");
  assert.equal(result[0].starDelta, 80);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/leaderboard.test.js`
Expected: FAIL — `Cannot find module '../scripts/leaderboard.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
// scripts/leaderboard.mjs
import { computeVelocity, MS_PER_DAY } from "./velocity.mjs";

/**
 * Collects every eligible candidate for one scope ("global" or a domain
 * slug), as of `asOf`. `asOf` must be a `Date`. A candidate is eligible
 * when `computeVelocity` reports enough history for `windowDays` using
 * only history entries dated on or before `asOf` — this is what lets the
 * same function compute "today's" candidates and "yesterday's" candidates
 * just by varying `asOf`, with no separate stored rank data.
 *
 * For `scope: "global"`, a project listed in more than one domain is
 * deduped to its single best-scoring listing (ties keep whichever domain
 * was encountered first).
 */
function collectCandidates(domains, historyBySlug, scope, windowDays, asOf) {
  const relevantDomains = scope === "global" ? domains : domains.filter((d) => d.slug === scope);
  const asOfDateStr = asOf.toISOString().slice(0, 10);

  const candidates = [];
  for (const domain of relevantDomains) {
    const history = historyBySlug[domain.slug] ?? {};
    for (const project of domain.projects) {
      const truncated = (history[project.id] ?? []).filter((entry) => entry.date <= asOfDateStr);
      const velocity = computeVelocity(truncated, windowDays, { now: asOf });
      if (!velocity.hasEnoughHistory) continue;
      candidates.push({
        id: project.id,
        name: project.name,
        link: project.link,
        image: project.image,
        domain: domain.name,
        domainSlug: domain.slug,
        score: velocity.score,
        starDelta: velocity.starDelta,
        percentDelta: velocity.percentDelta,
      });
    }
  }

  if (scope !== "global") return candidates;

  const bestById = new Map();
  for (const candidate of candidates) {
    const existing = bestById.get(candidate.id);
    if (!existing || candidate.score > existing.score) bestById.set(candidate.id, candidate);
  }
  return [...bestById.values()];
}

/** Sorts candidates by score descending (ties broken by name) and assigns 1-based `rank`. */
function rankCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return sorted.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/**
 * Computes a ranked, rank-diffed leaderboard for one scope ("global" or a
 * domain slug) and window. A project appears only when it has enough
 * history to rank both today and "yesterday" (`now` minus one day) — so
 * every returned entry always has a real prior rank to diff against, and
 * there's no ambiguous "new entry" case to special-case downstream.
 * `domains` is the raw `data/<slug>.json` shape (each
 * `{ slug, name, projects }`); `historyBySlug` maps slug to that domain's
 * `data/history/<slug>.json` contents.
 */
export function computeLeaderboard(domains, historyBySlug, { scope, windowDays, limit = 20, now = new Date() }) {
  const nowDate = new Date(now);
  const yesterdayDate = new Date(nowDate.getTime() - MS_PER_DAY);

  const todayRanked = rankCandidates(collectCandidates(domains, historyBySlug, scope, windowDays, nowDate));
  const yesterdayRanked = rankCandidates(collectCandidates(domains, historyBySlug, scope, windowDays, yesterdayDate));
  const yesterdayRankById = new Map(yesterdayRanked.map((c) => [c.id, c.rank]));

  return todayRanked
    .filter((c) => yesterdayRankById.has(c.id))
    .slice(0, limit)
    .map((c) => ({
      rank: c.rank,
      id: c.id,
      name: c.name,
      link: c.link,
      image: c.image,
      domain: c.domain,
      domainSlug: c.domainSlug,
      starDelta: c.starDelta,
      percentDelta: c.percentDelta,
      rankDelta: yesterdayRankById.get(c.id) - c.rank,
    }));
}
```

`velocity.mjs` already exports `MS_PER_DAY` — no change needed there.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/leaderboard.test.js`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add scripts/leaderboard.mjs test/leaderboard.test.js
git commit -m "feat: add leaderboard.mjs — ranked, rank-diffed, deduped rising leaderboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Refactor `scripts/social-digest.mjs` onto the shared leaderboard module

**Files:**
- Modify: `scripts/social-digest.mjs`
- Modify: `test/social-digest.test.js`

**Interfaces:**
- Consumes: `computeLeaderboard` from `scripts/leaderboard.mjs` (Task 1).
- Produces: no change to `formatDigest`, `renderReadmeRisers`, or `updateReadme`'s exported behavior — this task only changes where the ranked candidate list comes from.

- [ ] **Step 1: Update the test file — drop the now-relocated `computeTopRisers` tests**

Replace the whole file:

```javascript
// test/social-digest.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDigest, renderReadmeRisers, updateReadme } from "../scripts/social-digest.mjs";

test("formatDigest renders a numbered list with links and percentages", () => {
  const body = formatDigest(
    [{ id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 30, percentDelta: 30 }],
    { windowDays: 7 }
  );
  assert.match(body, /1\. \*\*\[Project A\]\(https:\/\/a\.example\)\*\* \(Data Science\) — \+30 stars \(\+30\.0%\)/);
  assert.match(body, /last 7 days/);
});

test("formatDigest returns a not-ready placeholder for an empty list", () => {
  const body = formatDigest([], { windowDays: 7 });
  assert.match(body, /Not enough star-history yet/);
  assert.match(body, /7-day/);
});

test("renderReadmeRisers renders a numbered list without the digest intro line", () => {
  const section = renderReadmeRisers(
    [{ id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 30, percentDelta: 30 }],
    { windowDays: 7 }
  );
  assert.match(section, /^1\. \*\*\[Project A\]\(https:\/\/a\.example\)\*\* \(Data Science\) — \+30 stars \(\+30\.0%\)$/);
  assert.doesNotMatch(section, /Biggest risers on/);
});

test("renderReadmeRisers returns a not-ready placeholder for an empty list", () => {
  const section = renderReadmeRisers([], { windowDays: 7 });
  assert.match(section, /Not enough star-history yet/);
  assert.match(section, /7-day/);
});

test("updateReadme replaces the content between the risers markers", () => {
  const readme = ["# awesomemap", "", "<!-- risers:start -->", "old content", "<!-- risers:end -->", "", "## Next section"].join("\n");
  const result = updateReadme(readme, "new content");
  assert.equal(result, ["# awesomemap", "", "<!-- risers:start -->", "new content", "<!-- risers:end -->", "", "## Next section"].join("\n"));
});

test("updateReadme throws when the markers are missing", () => {
  assert.throws(() => updateReadme("# awesomemap", "new content"), /risers markers not found/);
});
```

(`computeTopRisers`'s own coverage now lives in `test/leaderboard.test.js` from Task 1, testing the same ranking logic through `computeLeaderboard`.)

- [ ] **Step 2: Run the test file to confirm the rewrite is valid**

This task removes coverage rather than adding it (the ranking logic it tested moved to `test/leaderboard.test.js` in Task 1), so there's no red step here — run the file just to confirm the rewritten test file itself is syntactically valid and every remaining test still passes against the *old* `social-digest.mjs`.

Run: `node --test test/social-digest.test.js`
Expected: PASS (6/6) — `formatDigest`, `renderReadmeRisers`, and `updateReadme` are untouched so far.

- [ ] **Step 3: Update `scripts/social-digest.mjs`**

Remove the `computeTopRisers` function (its module-level JSDoc and body) and switch to the shared module:

```javascript
// scripts/social-digest.mjs — top of file
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { computeLeaderboard } from "./leaderboard.mjs";

const DATA_DIR = "data";
const HISTORY_DIR = "data/history";
const WINDOW_DAYS = 7;
const LIMIT = 5;
```

Delete the entire `computeTopRisers` function (from its leading JSDoc comment through its closing `}`) — `formatRiserLines`, `formatDigest`, `renderReadmeRisers`, `updateReadme`, and the README marker constants are all unchanged, keep them as-is.

In `main()`, replace:

```javascript
  const risers = computeTopRisers(domains, historyBySlug, {});
```

with:

```javascript
  const risers = computeLeaderboard(domains, historyBySlug, { scope: "global", windowDays: WINDOW_DAYS, limit: LIMIT });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/social-digest.test.js`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add scripts/social-digest.mjs test/social-digest.test.js
git commit -m "refactor: point social-digest.mjs at the shared leaderboard.mjs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `/rising/` page rendering — `scripts/render-page.mjs` + `app/shared/treemap.css`

**Files:**
- Modify: `scripts/render-page.mjs`
- Modify: `app/shared/treemap.css`
- Modify: `test/render-page.test.js`

**Interfaces:**
- Consumes: `RISING_WINDOWS_DAYS` from `scripts/velocity.mjs` (existing export, `[7, 30, 90]`); leaderboard entries shaped `{ rank, id, name, link, image, domain, starDelta, percentDelta, rankDelta }` (Task 1's `computeLeaderboard` output).
- Produces: `renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage, siteUrl, basePath, generatedAt })` where `leaderboardsByWindow` is `{ [windowDays]: { global: entries[], [domainSlug]: entries[] } }`. Also a module-private `renderRisingRows(entries, { showDomain })` reused by Task 4. `renderSiteHeader` (existing, private) gains a "Rising" link.

- [ ] **Step 1: Write the failing tests**

Add to `test/render-page.test.js` (after the existing `import`, keep everything else in the file unchanged):

```javascript
import { renderDomainPage, renderLandingPage, renderRisingPage } from "../scripts/render-page.mjs";
```

(replaces the existing import line, which only imports `renderDomainPage, renderLandingPage`)

Append these tests to the end of the file:

```javascript
test("the site header includes a Rising nav link, prefixed by BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const rootHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(rootHtml, /class="site-header-rising" href="\/rising\/"/);

  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(prefixedHtml, /class="site-header-rising" href="\/techmap\/rising\/"/);
});

test("renderRisingPage renders a row per leaderboard entry, with rank, arrow, and star delta", () => {
  const domains = [{ slug: "data-science", name: "Data Science" }];
  const leaderboardsByWindow = {
    7: {
      global: [
        { rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 1 },
      ],
      "data-science": [],
    },
    30: { global: [], "data-science": [] },
    90: { global: [], "data-science": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<span class="rising-row-rank">1<\/span>/);
  assert.match(html, /<a class="rising-row-name" href="https:\/\/a\.example">Project A<\/a>/);
  assert.match(html, /rising-row-up">▲1<\/span>/);
  assert.match(html, /\+40 \(\+40\.0%\)/);
});

test("renderRisingPage shows a not-ready placeholder for a leaderboard with no eligible entries", () => {
  const domains = [{ slug: "data-science", name: "Data Science" }];
  const leaderboardsByWindow = {
    7: { global: [], "data-science": [] },
    30: { global: [], "data-science": [] },
    90: { global: [], "data-science": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  assert.match(html, /Not enough star-history yet for this window\./);
});

test("renderRisingPage renders all three window variants, only the 7-day one visible initially", () => {
  const leaderboardsByWindow = { 7: { global: [] }, 30: { global: [] }, 90: { global: [] } };
  const html = renderRisingPage([], leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<div class="rising-rows" data-window="7">/);
  assert.match(html, /<div class="rising-rows" data-window="30" hidden>/);
  assert.match(html, /<div class="rising-rows" data-window="90" hidden>/);
});

test("renderRisingPage's domain sections are anchorable by slug and link to that domain's page", () => {
  const domains = [{ slug: "data-science", name: "Data Science" }];
  const leaderboardsByWindow = {
    7: { global: [], "data-science": [] },
    30: { global: [], "data-science": [] },
    90: { global: [], "data-science": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /<section class="rising-section" id="data-science">/);
  assert.match(html, /<a href="\/techmap\/data-science\/">Data Science<\/a>/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/render-page.test.js`
Expected: FAIL — `renderRisingPage` is not exported yet; the Rising nav link doesn't exist yet.

- [ ] **Step 3: Add the Rising nav link to `renderSiteHeader`**

In `scripts/render-page.mjs`, change:

```javascript
      <div class="site-header-links">
        <a class="site-header-github" href="${REPO_URL}" aria-label="View awesomemap on GitHub">
```

to:

```javascript
      <div class="site-header-links">
        <a class="site-header-rising" href="${basePath}/rising/">Rising</a>
        <a class="site-header-github" href="${REPO_URL}" aria-label="View awesomemap on GitHub">
```

- [ ] **Step 4: Add the rising-row/section renderers and `renderRisingPage`**

In `scripts/render-page.mjs`, add this import at the top:

```javascript
import { RISING_WINDOWS_DAYS } from "./velocity.mjs";
```

Then append, after `renderLandingPage` at the end of the file:

```javascript
/** Formats one leaderboard entry (as returned by leaderboard.mjs's computeLeaderboard) as a row. `showDomain` controls whether the cross-domain tag is shown — true for the global list, false for a single domain's own list. */
function renderRisingRow(entry, { showDomain }) {
  const arrowSymbol = entry.rankDelta > 0 ? "▲" : entry.rankDelta < 0 ? "▼" : "–";
  const arrowClass = entry.rankDelta > 0 ? "rising-row-up" : entry.rankDelta < 0 ? "rising-row-down" : "rising-row-flat";
  const movedBy = Math.abs(entry.rankDelta);
  const sign = entry.starDelta > 0 ? "+" : "";
  const pct = entry.percentDelta.toFixed(1);
  const icon = entry.image ? `<img class="rising-row-icon" src="${escapeHtml(entry.image)}" alt="" loading="lazy" />` : "";
  const domainTag = showDomain ? `<span class="rising-row-domain">${escapeHtml(entry.domain)}</span>` : "";
  return `
    <li class="rising-row">
      <span class="rising-row-rank">${entry.rank}</span>
      ${icon}
      <a class="rising-row-name" href="${escapeHtml(entry.link ?? "#")}">${escapeHtml(entry.name)}</a>
      ${domainTag}
      <span class="rising-row-arrow ${arrowClass}">${arrowSymbol}${movedBy > 0 ? movedBy : ""}</span>
      <span class="rising-row-delta">${sign}${entry.starDelta} (${sign}${pct}%)</span>
    </li>`;
}

/** Renders a leaderboard's rows, or a not-ready placeholder when `entries` is empty (e.g. a domain too new for this window). Shared with the teaser sections added in Task 4. */
function renderRisingRows(entries, { showDomain }) {
  if (entries.length === 0) {
    return `<p class="rising-empty">Not enough star-history yet for this window.</p>`;
  }
  return `<ol class="rising-rows-list">${entries.map((entry) => renderRisingRow(entry, { showDomain })).join("")}</ol>`;
}

/**
 * Renders one leaderboard section's three window variants (7/30/90 days),
 * only the first shown initially — the rest sit `hidden` until the page's
 * window-toggle script flips them, so switching windows never re-fetches
 * or recomputes anything client-side. `leaderboardsByWindow` is
 * `{ [windowDays]: { [scopeKey]: entries[] } }`; `scopeKey` selects which
 * leaderboard within each window this section shows.
 */
function renderRisingWindowVariants(leaderboardsByWindow, scopeKey, { showDomain }) {
  return RISING_WINDOWS_DAYS.map((windowDays, index) => {
    const entries = leaderboardsByWindow[windowDays]?.[scopeKey] ?? [];
    const hiddenAttr = index === 0 ? "" : " hidden";
    return `<div class="rising-rows" data-window="${windowDays}"${hiddenAttr}>${renderRisingRows(entries, { showDomain })}</div>`;
  }).join("");
}

/** One full leaderboard section (heading + all three window variants), anchorable by `id`. */
function renderRisingSection({ id, heading, headingHref, leaderboardsByWindow, scopeKey, showDomain }) {
  const headingHtml = headingHref ? `<a href="${escapeHtml(headingHref)}">${escapeHtml(heading)}</a>` : escapeHtml(heading);
  return `
    <section class="rising-section" id="${escapeHtml(id)}">
      <h2 class="rising-section-heading">${headingHtml}</h2>
      ${renderRisingWindowVariants(leaderboardsByWindow, scopeKey, { showDomain })}
    </section>`;
}

/**
 * Renders the dedicated Rising page: a global leaderboard plus one per
 * domain, sharing a single 7/30/90-day window toggle. `domains` is
 * `[{ slug, name }]`; `leaderboardsByWindow` is
 * `{ [windowDays]: { global: entries[], [slug]: entries[] } }` — the shape
 * `generate.mjs` builds from `leaderboard.mjs`'s `computeLeaderboard`.
 */
export function renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage, siteUrl = "", basePath = "", generatedAt = new Date() }) {
  const globalSection = renderRisingSection({
    id: "global",
    heading: "Hottest overall",
    leaderboardsByWindow,
    scopeKey: "global",
    showDomain: true,
  });

  const domainSections = domains
    .map((domain) =>
      renderRisingSection({
        id: domain.slug,
        heading: domain.name,
        headingHref: `${basePath}/${domain.slug}/`,
        leaderboardsByWindow,
        scopeKey: domain.slug,
        showDomain: false,
      })
    )
    .join("");

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
      <h1>Rising stars</h1>
      <p class="rising-hero-tagline">Star-growth leaders across every awesomemap domain.</p>
      <p class="rising-updated">Updated ${escapeHtml(generatedAt.toISOString().slice(0, 10))}</p>
    </header>
    ${windowBar}
    <div class="rising-page">
      ${globalSection}
      ${domainSections}
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
    title: "Rising — awesomemap",
    ogTitle: "Rising — awesomemap",
    ogDescription: "Star-growth leaders across every awesomemap domain, updated daily.",
    ogImage: defaultOgImage,
    ogUrl: `${siteUrl}${basePath}/rising/`,
    base: basePath,
    body,
  });
}
```

- [ ] **Step 5: Add the CSS**

Append to `app/shared/treemap.css`:

```css
.site-header-rising {
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}

.site-header-rising:hover {
  color: var(--color-text);
}

.rising-hero {
  text-align: center;
  padding: 48px 24px 24px;
}

.rising-hero h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 2.75rem);
  font-weight: 700;
  color: var(--color-text);
}

.rising-hero-tagline {
  margin: 12px 0 0;
  color: var(--color-text-muted);
}

.rising-updated {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-muted);
}

.rising-window-bar {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin: 16px 0;
}

.rising-page {
  box-sizing: border-box;
  max-width: 1000px;
  margin: 0 auto 48px;
  padding: 0 24px;
  display: grid;
  gap: 32px;
}

.rising-section-heading {
  font-size: 18px;
  margin: 0 0 8px;
}

.rising-section-heading a {
  color: var(--color-text);
  text-decoration: none;
}

.rising-section-heading a:hover {
  color: var(--color-accent);
}

.rising-rows-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
}

.rising-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
}

.rising-row:last-child {
  border-bottom: none;
}

.rising-row-rank {
  width: 20px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--color-text-muted);
}

.rising-row-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  border-radius: 3px;
}

.rising-row-name {
  flex: 1;
  color: var(--color-accent);
  text-decoration: none;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rising-row-domain {
  font-size: 11px;
  color: var(--color-text-muted);
  background: var(--color-accent-soft);
  border-radius: 999px;
  padding: 2px 8px;
}

.rising-row-arrow {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  width: 34px;
  text-align: right;
}

.rising-row-up {
  color: var(--color-rising-up);
}

.rising-row-down {
  color: var(--color-rising-down);
}

.rising-row-flat {
  color: var(--color-text-muted);
}

.rising-row-delta {
  width: 130px;
  text-align: right;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.rising-empty {
  padding: 16px;
  color: var(--color-text-muted);
  font-size: 13px;
  text-align: center;
}
```

Add the two new color tokens to both `:root` blocks. In the light block (top of file):

```css
:root {
  --color-bg: #f4f4f6;
  --color-surface: #ffffff;
  --color-text: #1a1a1a;
  --color-text-muted: #555555;
  --color-accent: #2b5fad;
  --color-accent-soft: rgba(43, 95, 173, 0.12);
  --color-border: #e2e2e6;
  --color-rising-up: #1a8a4a;
  --color-rising-down: #c23b3b;
  --shadow-sm: 0 1px 4px rgba(0, 0, 0, 0.1);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.12);
}
```

In the dark `@media (prefers-color-scheme: dark)` block:

```css
    --color-border: #3a3f4c;
    --color-rising-up: #4ad080;
    --color-rising-down: #ef6464;
    --shadow-sm: 0 1px 4px rgba(0, 0, 0, 0.4);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/render-page.test.js`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 7: Commit**

```bash
git add scripts/render-page.mjs app/shared/treemap.css test/render-page.test.js
git commit -m "feat: render the dedicated /rising/ leaderboard page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Landing-page and domain-page teasers

**Files:**
- Modify: `scripts/render-page.mjs`
- Modify: `test/render-page.test.js`

**Interfaces:**
- Consumes: `renderRisingRows(entries, { showDomain })` (Task 3, module-private, same file).
- Produces: `renderDomainPage(domain, tree, { embed, defaultOgImage, siteUrl, basePath, teaser })` and `renderLandingPage(domains, { defaultOgImage, siteUrl, basePath, teaser })` both gain an optional `teaser` param (an already-sliced-to-5 array of leaderboard entries, defaults to `[]`).

- [ ] **Step 1: Write the failing tests**

Append to `test/render-page.test.js`:

```javascript
test("renderDomainPage renders a teaser section below the map, linking to that domain's rising anchor", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const teaser = [{ rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", teaser });
  assert.match(html, /class="rising-teaser-link" href="\/rising\/#data-science"/);
  assert.ok(html.indexOf('id="app"') < html.indexOf('class="rising-teaser"'));
});

test("renderDomainPage's embed variant has no teaser section", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const teaser = [{ rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", embed: true, teaser });
  assert.doesNotMatch(html, /rising-teaser/);
});

test("renderLandingPage renders a global teaser section between the hero and the map grid", () => {
  const teaser = [{ rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0 }];
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], { defaultOgImage: "/og-default.png", teaser });
  assert.match(html, /class="rising-teaser-link" href="\/rising\/"/);
  assert.ok(html.indexOf('class="hero"') < html.indexOf('class="rising-teaser"'));
  assert.ok(html.indexOf('class="rising-teaser"') < html.indexOf('class="map-grid"'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/render-page.test.js`
Expected: FAIL — no `rising-teaser` markup exists yet.

- [ ] **Step 3: Add `renderRisingTeaser` and wire it into both pages**

In `scripts/render-page.mjs`, add this helper right before `renderRisingPage` (or anywhere after `renderRisingRows` is defined):

```javascript
/**
 * Renders a short teaser (already-sliced entries, typically top 5, 7-day
 * window) linking to the full leaderboard — used on the landing page
 * (global) and each domain page (that domain's own list).
 */
function renderRisingTeaser(entries, { heading, href, showDomain }) {
  return `
    <section class="rising-teaser">
      <h2 class="rising-teaser-heading">${escapeHtml(heading)}</h2>
      ${renderRisingRows(entries, { showDomain })}
      <a class="rising-teaser-link" href="${escapeHtml(href)}">See full leaderboard →</a>
    </section>`;
}
```

Update `renderDomainPage`'s signature and body:

```javascript
export function renderDomainPage(domain, tree, { embed = false, defaultOgImage, siteUrl = "", basePath = "", teaser = [] }) {
  const header = embed ? "" : renderSiteHeader(basePath);
  const footer = embed ? "" : renderSiteFooter();
  const teaserSection = embed
    ? ""
    : renderRisingTeaser(teaser, { heading: "Rising this week", href: `${basePath}/rising/#${domain.slug}`, showDomain: false });
  const ogUrl = `${siteUrl}${basePath}/${domain.slug}/`;
  const historyUrl = `${basePath}/${domain.slug}/history.json`;
  const body = `
    ${header}
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
    ${teaserSection}
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

Update `renderLandingPage`'s signature and body:

```javascript
export function renderLandingPage(domains, { defaultOgImage, siteUrl = "", basePath = "", teaser = [] }) {
  const cards = domains
    .map(
      (domain) => `
        <a class="map-card" href="${basePath}/${escapeHtml(domain.slug)}/">
          <h3>${escapeHtml(domain.name)}</h3>
          <p>${escapeHtml(domain.description ?? "")}</p>
        </a>`
    )
    .join("");
  const teaserSection = renderRisingTeaser(teaser, { heading: "Rising this week", href: `${basePath}/rising/`, showDomain: true });
  const body = `
    ${renderSiteHeader(basePath)}
    <header class="hero">
      <div class="hero-motif" aria-hidden="true">
        <span class="hero-rect hero-rect-1"></span>
        <span class="hero-rect hero-rect-2"></span>
        <span class="hero-rect hero-rect-3"></span>
        <span class="hero-rect hero-rect-4"></span>
      </div>
      <div class="hero-content">
        <h1>awesomemap</h1>
        <p class="hero-tagline">Interactive, zoomable maps of open-source project ecosystems — sized by adoption, explorable by category.</p>
      </div>
    </header>
    ${teaserSection}
    <div class="map-index">
      <h2 class="map-index-heading">Explore the maps</h2>
      <div class="map-grid">${cards}</div>
    </div>
    ${renderSiteFooter()}
  `;
  return renderShell({
    title: "awesomemap",
    ogTitle: "awesomemap",
    ogDescription: "A community-curated map of open-source technology.",
    ogImage: defaultOgImage,
    ogUrl: `${siteUrl}${basePath}/`,
    base: basePath,
    body,
  });
}
```

- [ ] **Step 4: Add the teaser CSS**

Append to `app/shared/treemap.css`:

```css
.rising-teaser {
  box-sizing: border-box;
  max-width: 960px;
  margin: 0 auto 32px;
  padding: 0 24px;
}

.rising-teaser-heading {
  font-size: 15px;
  margin: 0 0 8px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.rising-teaser-link {
  display: inline-block;
  margin-top: 8px;
  font-size: 13px;
  color: var(--color-accent);
  text-decoration: none;
}

.rising-teaser-link:hover {
  text-decoration: underline;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/render-page.test.js`
Expected: PASS (every test in the file)

- [ ] **Step 6: Commit**

```bash
git add scripts/render-page.mjs app/shared/treemap.css test/render-page.test.js
git commit -m "feat: add rising-stars teasers to the landing page and domain pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: List `/rising/` in the sitemap

**Files:**
- Modify: `scripts/seo.mjs`
- Modify: `test/seo.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildSitemap`'s output now includes `${origin}/rising/`; signature unchanged.

- [ ] **Step 1: Write the failing test**

Append to `test/seo.test.js`:

```javascript
test("buildSitemap lists the rising leaderboard page", () => {
  const xml = buildSitemap(["data-science"], { siteUrl: "https://example.com", basePath: "" });
  assert.match(xml, /<loc>https:\/\/example\.com\/rising\/<\/loc>/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/seo.test.js`
Expected: FAIL — no `/rising/` URL in the sitemap yet.

- [ ] **Step 3: Update `buildSitemap`**

In `scripts/seo.mjs`, change:

```javascript
export function buildSitemap(slugs, { siteUrl, basePath }) {
  if (!siteUrl) return null;

  const origin = `${siteUrl}${basePath}`;
  const urls = [`${origin}/`, ...slugs.map((slug) => `${origin}/${slug}/`)];
```

to:

```javascript
export function buildSitemap(slugs, { siteUrl, basePath }) {
  if (!siteUrl) return null;

  const origin = `${siteUrl}${basePath}`;
  const urls = [`${origin}/`, `${origin}/rising/`, ...slugs.map((slug) => `${origin}/${slug}/`)];
```

Also update the function's leading doc comment ("Builds a sitemap.xml document listing the landing page plus one entry per domain page.") to read "...listing the landing page, the rising leaderboard page, plus one entry per domain page."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/seo.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/seo.mjs test/seo.test.js
git commit -m "feat: list /rising/ in the sitemap

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire it all together in `scripts/generate.mjs`

**Files:**
- Modify: `scripts/generate.mjs`

**Interfaces:**
- Consumes: `computeLeaderboard` (Task 1), `renderRisingPage` + `teaser` params on `renderDomainPage`/`renderLandingPage` (Tasks 3–4), `RISING_WINDOWS_DAYS` (existing, `scripts/velocity.mjs`).
- Produces: `dist/rising/index.html`; every domain/embed page and the landing page now render with their teasers populated.

`generate.mjs` has no dedicated test file today (it's I/O orchestration — the existing convention, matching `build-tree.mjs`/`render-page.mjs`'s own unit tests already covering the logic it calls). This task is verified by running the generator against real repo data and `npm test`.

- [ ] **Step 1: Rewrite `scripts/generate.mjs`**

Replace the entire file:

```javascript
#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, cpSync, existsSync } from "node:fs";
import { buildTree } from "./build-tree.mjs";
import { renderDomainPage, renderLandingPage, renderRisingPage } from "./render-page.mjs";
import { computeProjectSizing, findInvalidSizes, RISING_WINDOWS_DAYS } from "./velocity.mjs";
import { computeLeaderboard } from "./leaderboard.mjs";
import { buildSitemap, buildRobots } from "./seo.mjs";

const DATA_DIR = "data";
const DIST_DIR = "dist";
const APP_DIR = "app";
const LEADERBOARD_LIMIT = 20;
const TEASER_LIMIT = 5;
const TEASER_WINDOW_DAYS = 7;

// Empty string defaults to serving from the domain root, matching local
// `npm run dev`/`npm run generate` usage. Production deploys (GitHub Pages
// project sites are served under `/<repo>/`, not the domain root) set this
// via the BASE_PATH env var — see .github/workflows/deploy.yml.
const BASE_PATH = process.env.BASE_PATH ?? "";

// Absolute site origin, used to build absolute URLs (og:image, og:url) that
// link-preview scrapers require. When unset, falls back to a relative path
// — not spec-compliant, but better than failing the build outright.
const SITE_URL = process.env.SITE_URL ?? "";

// When set, writes a GitHub Pages CNAME file into the build output so the
// custom domain survives every deploy (Actions-based Pages publishing does
// not persist it any other way — see .github/workflows/deploy.yml).
const CNAME = process.env.CNAME ?? "";

const DEFAULT_OG_IMAGE = `${SITE_URL}${BASE_PATH}/og-default.png`;

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

const domainFiles = readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"));

// Pass 1: parse, validate, and size every domain. Collects the full set of
// domains + history before any page is rendered — the Rising page's global
// leaderboard (Pass 2) spans every domain, so it can't be computed
// incrementally inside a single per-domain loop the way sizing can.
const parsedDomains = [];
const historyBySlug = {};
const seenSlugs = new Map();

for (const file of domainFiles) {
  const domainPath = `${DATA_DIR}/${file}`;
  let domain;
  try {
    domain = JSON.parse(readFileSync(domainPath, "utf8"));
  } catch (err) {
    throw new Error(`${domainPath}: invalid JSON — ${err.message}`);
  }
  const slug = domain.slug;

  if (typeof slug !== "string" || slug.length === 0 || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`${domainPath}: "slug" must be a non-empty string matching /^[a-z0-9-]+$/, got ${JSON.stringify(slug)}`);
  }
  if (seenSlugs.has(slug)) {
    throw new Error(`${domainPath}: duplicate slug "${slug}" (already used by ${seenSlugs.get(slug)})`);
  }
  seenSlugs.set(slug, domainPath);

  if (!Array.isArray(domain.projects)) {
    throw new Error(`${domainPath}: "projects" must be an array`);
  }

  for (const project of domain.projects) {
    if (!project.id || !Array.isArray(project.path)) {
      throw new Error(`${domainPath}: project missing "id" or non-array "path": ${JSON.stringify(project)}`);
    }
  }

  const historyPath = `${DATA_DIR}/history/${slug}.json`;
  const projectHistory = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : {};
  historyBySlug[slug] = projectHistory;

  const sizedProjects = domain.projects.map((project) => {
    const { sizes, hasEnoughHistory, growth } = computeProjectSizing(project, projectHistory[project.id] ?? []);
    return { ...project, sizes, hasEnoughHistory, growth };
  });

  const invalidSizeIds = findInvalidSizes(sizedProjects);
  if (invalidSizeIds.length > 0) {
    throw new Error(`${domainPath}: invalid computed size(s) for project id(s): ${invalidSizeIds.join(", ")}`);
  }

  // Project `image` values (when present) are already direct URLs into the
  // project's source repo — set by `enrich-domain.mjs` — so no local
  // resolution or copying is needed here.
  parsedDomains.push({ ...domain, projects: sizedProjects, historyPath });
}

// Pass 2: compute every window's leaderboard (global + one per domain) from
// the complete set of domains and history — this powers both the dedicated
// /rising/ page and every teaser below.
const leaderboardsByWindow = {};
for (const windowDays of RISING_WINDOWS_DAYS) {
  const byScope = {
    global: computeLeaderboard(parsedDomains, historyBySlug, { scope: "global", windowDays, limit: LEADERBOARD_LIMIT }),
  };
  for (const domain of parsedDomains) {
    byScope[domain.slug] = computeLeaderboard(parsedDomains, historyBySlug, { scope: domain.slug, windowDays, limit: LEADERBOARD_LIMIT });
  }
  leaderboardsByWindow[windowDays] = byScope;
}

// Pass 3: render every domain's full page, embed page, and history.json,
// now that its teaser (the top of its own 7-day leaderboard) is available.
const domains = [];

for (const domain of parsedDomains) {
  const { slug, historyPath } = domain;
  const tree = buildTree(domain.projects, { id: slug, name: domain.name });
  const teaser = leaderboardsByWindow[TEASER_WINDOW_DAYS][slug].slice(0, TEASER_LIMIT);

  mkdirSync(`${DIST_DIR}/${slug}`, { recursive: true });
  mkdirSync(`${DIST_DIR}/embed/${slug}`, { recursive: true });

  // Ships the raw per-repo history (already loaded in Pass 1) to the
  // client as-is, so the detail panel can fetch it on demand to draw a
  // leaf's star-history sparkline. Skipped when the domain has no history
  // file yet — the panel's fetch fails gracefully in that case (see
  // render-page.mjs).
  if (existsSync(historyPath)) {
    copyFileSync(historyPath, `${DIST_DIR}/${slug}/history.json`);
  }

  writeFileSync(
    `${DIST_DIR}/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: false, defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH, teaser })
  );
  writeFileSync(
    `${DIST_DIR}/embed/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: true, defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
  );

  domains.push({ slug, name: domain.name, description: domain.description ?? "" });
}

const globalTeaser = leaderboardsByWindow[TEASER_WINDOW_DAYS].global.slice(0, TEASER_LIMIT);
writeFileSync(
  `${DIST_DIR}/index.html`,
  renderLandingPage(domains, { defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH, teaser: globalTeaser })
);

mkdirSync(`${DIST_DIR}/rising`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/rising/index.html`,
  renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
);

cpSync(`${APP_DIR}/shared`, `${DIST_DIR}/shared`, { recursive: true });
cpSync(`${APP_DIR}/vendor`, `${DIST_DIR}/vendor`, { recursive: true });
copyFileSync(`${APP_DIR}/og-default.png`, `${DIST_DIR}/og-default.png`);
if (CNAME) writeFileSync(`${DIST_DIR}/CNAME`, `${CNAME}\n`);

const sitemap = buildSitemap(domains.map((d) => d.slug), { siteUrl: SITE_URL, basePath: BASE_PATH });
if (sitemap) writeFileSync(`${DIST_DIR}/sitemap.xml`, sitemap);
writeFileSync(`${DIST_DIR}/robots.txt`, buildRobots({ siteUrl: SITE_URL, basePath: BASE_PATH }));

console.log(`Generated ${domains.length} domain(s) into ${DIST_DIR}/`);
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS (every test file, unchanged count from before this task plus Tasks 1–5's additions)

- [ ] **Step 3: Run the real generator and spot-check the output**

Run: `npm run generate`
Expected: `Generated 7 domain(s) into dist/` with no errors; then confirm:

```bash
test -f dist/rising/index.html && echo "rising page exists"
grep -c "rising-section" dist/rising/index.html
grep -q "rising-teaser" dist/index.html && echo "landing teaser present"
grep -q "rising-teaser" dist/data-science/index.html && echo "domain teaser present"
grep -q "site-header-rising" dist/data-science/index.html && echo "nav link present"
```

Expected: `rising page exists`, a section count of 8 (1 global + 7 domains), and all three "present" lines print.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate.mjs
git commit -m "feat: wire the rising leaderboard into the site generator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `CONTRIBUTING.md` — welcome smaller projects, note the eligibility lag

**Files:**
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Append a new section**

Add this new section at the end of `CONTRIBUTING.md`, right after the existing "## Star history & Rising mode" section:

```markdown

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
```

- [ ] **Step 2: Proofread**

Read the rendered file (or preview) to confirm the new section flows after "Star history & Rising mode" and doesn't duplicate its content.

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: welcome smaller projects, note the leaderboard eligibility lag

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification and manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every test file passes, no failures.

- [ ] **Step 2: Run the dev server and walk through the feature**

Run: `npm run dev` (serves `dist/` at `http://localhost:5000`)

Manually confirm:
- `http://localhost:5000/rising/` loads, shows a "Hottest overall" section plus one section per domain, each with ranked rows (or the "not enough history yet" placeholder for windows without enough data).
- Clicking the 30d/90d buttons switches every section's rows together, instantly (no network tab activity).
- `http://localhost:5000/` shows a "Rising this week" teaser between the hero and the map grid, linking to `/rising/`.
- A domain page (e.g. `http://localhost:5000/data-science/`) shows its own teaser below the map, linking to `/rising/#data-science`, and clicking it lands on that domain's section.
- The site header on every non-embed page shows a "Rising" link next to the brand.
- An embed page (`http://localhost:5000/embed/data-science/`) has no header, footer, or teaser.

- [ ] **Step 3: Stop the dev server**

Ctrl-C the `npm run dev` process (or kill the background job if run in the background).
