# Rising Tiers, Spiking, and Anomaly Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split every Rising leaderboard into star-count tiers (Breakout / Climbing / Giants, default Breakout), add a cross-size "Spiking" list for sudden accelerations, and keep implausible star jumps off every leaderboard.

**Architecture:** Tiers are a filter applied inside `computeLeaderboard` *before* ranking; the score formula is untouched. Spiking is a new pure module that reuses leaderboard's ranking helpers with a different score (gain ÷ own prior weekly pace). Surfaces (`/rising/`, homepage signals, domain teasers, detail panel, archive, RSS) consume a `leaderboardsByTier[tier][windowDays][scope]` structure built once in `generate.mjs`. Client-side tab/filter state moves out of an inline script into `app/shared/rising-filters.js`.

**Tech Stack:** Node ESM build scripts, `node --test` + `node:assert/strict`, static HTML strings, vanilla JS modules in `app/shared/`, Cloudflare D1 (data repo, unchanged schema).

**Spec:** `docs/superpowers/specs/2026-10-19-rising-tiers-design.md`

**Repos:** Tasks 1–7 and 9 are in `/home/haggai/workspace/awesomemap/awesomemap` (branch `feat/rising-tiers`). Task 8 is in `/home/haggai/workspace/awesomemap/awesomemap-data` (create branch `feat/rising-tiers` there from `main`). All commands below assume the repo root of the named repo as cwd.

## Global Constraints

- Tiers: Breakout `0 <= stars < 10_000`; Climbing `10_000 <= stars < 50_000`; Giants `stars >= 50_000`. Default tier: `breakout`.
- Spiking: `multiple = d7 / (max(priorWeekly, 0) + 20)`, `priorWeekly` = gain over the 28 days ending 7 days ago ÷ 4; eligible only with 35 days of history, `d7 >= 100`, `d7 >= 0.005 * currentStars`, not anomalous. 7-day only.
- Anomaly guard: exclude when `baselineStars >= 10_000 && percentDelta > 100` (window's own percentDelta). Applies to every `computeLeaderboard` call, tiered or not.
- `computeVelocity`'s formula and treemap Rising sizes must not change.
- `computeLeaderboard` without `tier` must keep returning all sizes (callers `readme-risers.mjs`, data repo `rising-story-select.mjs` rely on it).
- `scripts/leaderboard.mjs`, `scripts/tiers.mjs`, `scripts/spiking.mjs` must be byte-identical between the two repos after Task 8.
- `app/shared/*` cannot import from `scripts/` (scripts/ is never copied to dist/); duplicate small constants with a comment saying where they come from, as `detail-panel.js` already does.
- Snapshot scope keys: `<tier>:<scope>` for tier ∈ {breakout, climbing, giants, spiking}; plain `global`/`<slug>` keys still written as a copy of Breakout. No D1 schema/worker change.
- User-facing copy (exact):
  - Tabs: `Breakout`, `Climbing`, `Giants`, `Spiking`
  - Explainers: `Projects under 10k stars, ranked by star growth.` / `Projects with 10k–50k stars, ranked by star growth.` / `Projects over 50k stars, ranked by star growth.` / `Projects growing far faster than their own usual pace.`
  - Empty tier (domain scope): `No growing projects in this tier for this domain this week.`; (global scope): `No growing projects in this tier this week.`
  - `/rising/` hero tagline: `Fast-growing projects, grouped by size — start with the ones that haven't hit 10k stars yet.`
  - Spiking stat: `N.N× its usual pace` (one decimal)
  - Signal card label: `⚡ Spiking`
  - Detail panel: `#3 Breakout in AI over 7 days` (singulars: Breakout, Climbing, Giant)

## Known deviation from spec (decided while planning)

D1's `leaderboard_snapshots` has no column for Spiking's `multiple`, and the spec forbids a schema change. So **archived** Spiking rows have no `multiple`: archive rows fall back to the normal `+N (+P%)` stat, and the RSS spike line reads `Biggest spike: <name> (+N stars this week)` instead of `N× its usual pace`. Live `/rising/` and homepage show the multiple.

## Review Focus

1. **Malformed or stale URL hash** (`#nope`, `#ai/zzz`, `#%E0%A4%A`) — expect the default view (Breakout, all domains), never a thrown error. Pinned in Task 5 (`parseRisingHash` tests).
2. **Switching to Spiking while on 30d, then back** — expect Spiking to show its 7d list and the 30d selection to come back on returning to a size tier. Pinned in Task 5 (`effectiveWindow` tests).
3. **A project whose prior month was negative** (lost stars, then spiked) — expect a finite, positive multiple, not a division blow-up. Pinned in Task 3.
4. **A domain with no Breakout and no Climbing rows** — teaser must render the empty message, not crash or render an empty list. Pinned in Task 1 (`composeTeaser([], [])`) and Task 5 (teaser render).
5. **A tiered archive week missing one tier's rows** (e.g. no Spiking entries that week) — that tab shows the empty message; other tabs unaffected. Pinned in Task 6.

---

### Task 1: Tier definitions and teaser composition

**Files:**
- Create: `scripts/tiers.mjs`
- Test: `test/tiers.test.js`

**Interfaces:**
- Produces:
  - `TIERS: Array<{ key: "breakout"|"climbing"|"giants", label: string, singular: string, minStars: number, maxStars: number }>`
  - `DEFAULT_TIER: "breakout"`
  - `SPIKING_TAB: { key: "spiking", label: "Spiking" }`
  - `tierForStars(stars: number): "breakout"|"climbing"|"giants"`
  - `TEASER_MIN_BREAKOUT: 3`
  - `composeTeaser(breakoutRows: Row[], climbingRows: Row[], { limit = 5, minBreakout = 3 } = {}): Row[]`

- [ ] **Step 1: Write the failing test**

```js
// test/tiers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TIERS, DEFAULT_TIER, SPIKING_TAB, tierForStars, composeTeaser, TEASER_MIN_BREAKOUT } from "../scripts/tiers.mjs";

test("TIERS are breakout/climbing/giants in order, contiguous, with breakout as the default", () => {
  assert.deepEqual(TIERS.map((t) => t.key), ["breakout", "climbing", "giants"]);
  assert.equal(DEFAULT_TIER, "breakout");
  assert.equal(SPIKING_TAB.key, "spiking");
  for (let i = 1; i < TIERS.length; i++) assert.equal(TIERS[i].minStars, TIERS[i - 1].maxStars);
});

test("tierForStars puts each boundary in the upper tier", () => {
  assert.equal(tierForStars(0), "breakout");
  assert.equal(tierForStars(9_999), "breakout");
  assert.equal(tierForStars(10_000), "climbing");
  assert.equal(tierForStars(49_999), "climbing");
  assert.equal(tierForStars(50_000), "giants");
  assert.equal(tierForStars(400_000), "giants");
});

const row = (id, tier = "breakout") => ({ id, tier });

test("composeTeaser returns up to `limit` Breakout rows when there are at least minBreakout", () => {
  const breakout = ["a", "b", "c", "d", "e", "f"].map((id) => row(id));
  const climbing = [row("x", "climbing")];
  assert.deepEqual(composeTeaser(breakout, climbing).map((r) => r.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(composeTeaser(breakout.slice(0, TEASER_MIN_BREAKOUT), climbing).map((r) => r.id), ["a", "b", "c"]);
});

test("composeTeaser fills from Climbing up to `limit` when Breakout has fewer than minBreakout rows", () => {
  const breakout = [row("a"), row("b")];
  const climbing = ["x", "y", "z", "w"].map((id) => row(id, "climbing"));
  assert.deepEqual(composeTeaser(breakout, climbing).map((r) => r.id), ["a", "b", "x", "y", "z"]);
});

test("composeTeaser returns an empty list when both tiers are empty", () => {
  assert.deepEqual(composeTeaser([], []), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tiers.test.js`
Expected: FAIL — `Cannot find module '.../scripts/tiers.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// scripts/tiers.mjs
// Kept byte-identical with awesomemap-data/scripts/tiers.mjs — both repos'
// leaderboard.mjs import it.

/**
 * Star-count size tiers every Rising leaderboard is split into. A project's
 * tier is decided by its current star count as of the leaderboard's `asOf`
 * (see leaderboard.mjs). `minStars` is inclusive, `maxStars` exclusive.
 * Calibrated on 2026-10-19's 7-day pool (1,266 growing projects, median
 * ~12k stars): 555 / 538 / 173 projects per tier. Breakout is the default
 * everywhere — it's what makes "before they get big" literally true.
 */
export const TIERS = [
  { key: "breakout", label: "Breakout", singular: "Breakout", minStars: 0, maxStars: 10_000 },
  { key: "climbing", label: "Climbing", singular: "Climbing", minStars: 10_000, maxStars: 50_000 },
  { key: "giants", label: "Giants", singular: "Giant", minStars: 50_000, maxStars: Infinity },
];

export const DEFAULT_TIER = "breakout";

/** The fourth Rising tab — not a size tier (spans every size), see spiking.mjs. */
export const SPIKING_TAB = { key: "spiking", label: "Spiking" };

/** The tier key for a current star count. */
export function tierForStars(stars) {
  return TIERS.find((tier) => stars >= tier.minStars && stars < tier.maxStars).key;
}

/** A domain teaser with fewer Breakout rows than this is topped up from Climbing. */
export const TEASER_MIN_BREAKOUT = 3;

/**
 * Builds a domain page's "Rising this week" teaser: the top `limit` Breakout
 * rows, or — when Breakout has fewer than `minBreakout` — whatever Breakout
 * has, topped up to `limit` from Climbing, so a domain of mostly-large
 * projects never shows a near-empty teaser. Rows keep their own `tier` so the
 * renderer can tag the Climbing ones.
 */
export function composeTeaser(breakoutRows, climbingRows, { limit = 5, minBreakout = TEASER_MIN_BREAKOUT } = {}) {
  const breakout = breakoutRows.slice(0, limit);
  if (breakout.length >= minBreakout) return breakout;
  return [...breakout, ...climbingRows.slice(0, limit - breakout.length)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tiers.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/tiers.mjs test/tiers.test.js
git commit -m "feat: add Rising size tiers and teaser composition"
```

---

### Task 2: Tier filter and anomaly guard in `computeLeaderboard`

**Files:**
- Modify: `scripts/leaderboard.mjs` (whole file — rewritten below)
- Test: `test/leaderboard.test.js` (append)

**Interfaces:**
- Consumes: `tierForStars` from `scripts/tiers.mjs` (Task 1); `computeVelocity`, `MS_PER_DAY` from `scripts/velocity.mjs`.
- Produces (all exported from `scripts/leaderboard.mjs`):
  - `ANOMALY_MIN_BASELINE_STARS = 10_000`, `ANOMALY_MAX_PERCENT_DELTA = 100`
  - `isAnomalous(velocity: { currentStars, starDelta, percentDelta }): boolean`
  - `toCandidate(domain, project, velocity): Candidate` — `{ id, name, link, image, desc, domain, domainShort, domainSlug, score, starDelta, percentDelta, currentStars, tier }`
  - `dedupeBestById(candidates: Candidate[]): Candidate[]`
  - `rankAgainstYesterday(today: Candidate[], yesterday: Candidate[]): Array<Candidate & { rank, rankDelta }>`
  - `toRow(ranked): Row` — `{ rank, id, name, link, image, desc, domain, domainShort, domainSlug, starDelta, percentDelta, currentStars, rankDelta, tier }`
  - `computeLeaderboard(domains, { scope, windowDays, limit = 20, now = new Date(), tier })` — `tier` optional; rows gain `tier`.
  - `findAnomalies(domains, { windowDays, now = new Date() }): Array<{ id, starDelta, percentDelta, currentStars }>`

- [ ] **Step 1: Write the failing tests** (append to `test/leaderboard.test.js`; update its import line)

Change the import at the top to:

```js
import { computeLeaderboard, findAnomalies, isAnomalous } from "../scripts/leaderboard.mjs";
```

Append:

```js
/** One-domain fixture: each project's history is [08-05, 08-14, 08-15] star counts (NOW is 08-15, so 7d baseline is 08-05 both today and yesterday). */
function tierDomains(projects) {
  return [
    {
      slug: "data-science",
      name: "Data Science",
      projects: projects.map(([id, s0805, s0814, s0815]) => ({
        id,
        name: id,
        link: `https://${id}.example`,
        history: [
          { date: "2026-08-05", stars: s0805 },
          { date: "2026-08-14", stars: s0814 },
          { date: "2026-08-15", stars: s0815 },
        ],
      })),
    },
  ];
}

const SIZED = tierDomains([
  ["small", 5000, 5100, 5200],
  ["mid", 20000, 20500, 21000],
  ["big", 60000, 61000, 62000],
]);

test("computeLeaderboard with a tier keeps only that tier's projects", () => {
  const ids = (tier) => computeLeaderboard(SIZED, { scope: "global", windowDays: 7, now: NOW, tier }).map((r) => r.id);
  assert.deepEqual(ids("breakout"), ["small"]);
  assert.deepEqual(ids("climbing"), ["mid"]);
  assert.deepEqual(ids("giants"), ["big"]);
});

test("computeLeaderboard without a tier keeps every size, and every row carries its tier", () => {
  const result = computeLeaderboard(SIZED, { scope: "global", windowDays: 7, now: NOW });
  assert.equal(result.length, 3);
  assert.deepEqual(Object.fromEntries(result.map((r) => [r.id, r.tier])), { small: "breakout", mid: "climbing", big: "giants" });
});

test("computeLeaderboard puts a project at exactly 10,000 / 50,000 stars in the upper tier", () => {
  const domains = tierDomains([
    ["at10k", 9000, 10000, 10000],
    ["at50k", 45000, 50000, 50000],
  ]);
  const ids = (tier) => computeLeaderboard(domains, { scope: "global", windowDays: 7, now: NOW, tier }).map((r) => r.id);
  assert.deepEqual(ids("breakout"), []);
  assert.deepEqual(ids("climbing"), ["at10k"]);
  assert.deepEqual(ids("giants"), ["at50k"]);
});

test("computeLeaderboard drops a project that crossed 10k overnight from both tiers for that day (no cross-tier rankDelta)", () => {
  const domains = tierDomains([["crosser", 9000, 9900, 10100]]);
  assert.deepEqual(computeLeaderboard(domains, { scope: "global", windowDays: 7, now: NOW, tier: "breakout" }), []);
  assert.deepEqual(computeLeaderboard(domains, { scope: "global", windowDays: 7, now: NOW, tier: "climbing" }), []);
});

test("computeLeaderboard's anomaly guard excludes >100% growth from a 10k+ baseline, and nothing just below either threshold", () => {
  const domains = tierDomains([
    ["anomaly", 10000, 10010, 20200], // +102% from 10,000
    ["small-base", 9999, 10009, 20200], // +102% but baseline < 10k
    ["just-under", 10000, 10010, 19900], // +99% from 10,000
  ]);
  const ids = computeLeaderboard(domains, { scope: "global", windowDays: 7, now: NOW }).map((r) => r.id).sort();
  assert.deepEqual(ids, ["just-under", "small-base"]);
});

test("isAnomalous reads baseline as currentStars - starDelta", () => {
  assert.equal(isAnomalous({ currentStars: 20200, starDelta: 10200, percentDelta: 102 }), true);
  assert.equal(isAnomalous({ currentStars: 20200, starDelta: 10201, percentDelta: 102.03 }), false);
  assert.equal(isAnomalous({ currentStars: 19900, starDelta: 9900, percentDelta: 99 }), false);
});

test("findAnomalies lists each anomalous project once, across domains", () => {
  const domains = [
    ...tierDomains([["anomaly", 10000, 10010, 20200], ["fine", 5000, 5100, 5200]]),
    { ...tierDomains([["anomaly", 10000, 10010, 20200]])[0], slug: "security", name: "Security" },
  ];
  const result = findAnomalies(domains, { windowDays: 7, now: NOW });
  assert.deepEqual(result.map((a) => a.id), ["anomaly"]);
  assert.equal(result[0].starDelta, 10200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/leaderboard.test.js`
Expected: FAIL — `findAnomalies`/`isAnomalous` not exported (SyntaxError on import).

- [ ] **Step 3: Replace `scripts/leaderboard.mjs` with:**

```js
import { computeVelocity, MS_PER_DAY } from "./velocity.mjs";
import { tierForStars } from "./tiers.mjs";

// Anomaly guard: a project more than doubling within one window from an
// already-sizeable base is almost always purchased stars or a data error
// (2026-10-19: morluto/rea, ~87k -> 314k in 7 days), not organic growth.
// Small projects doubling is normal, hence the baseline floor.
export const ANOMALY_MIN_BASELINE_STARS = 10_000;
export const ANOMALY_MAX_PERCENT_DELTA = 100;

/** True when a `computeVelocity` result looks like an implausible jump (see the constants above). */
export function isAnomalous(velocity) {
  const baselineStars = velocity.currentStars - velocity.starDelta;
  return baselineStars >= ANOMALY_MIN_BASELINE_STARS && velocity.percentDelta > ANOMALY_MAX_PERCENT_DELTA;
}

/** The candidate shape every leaderboard (and spiking.mjs) ranks — `score` is what `rankAgainstYesterday` sorts by. */
export function toCandidate(domain, project, velocity) {
  return {
    id: project.id,
    name: project.name,
    link: project.link,
    image: project.image,
    desc: project.desc,
    domain: domain.name,
    domainShort: domain.shortName ?? domain.name,
    domainSlug: domain.slug,
    score: velocity.score,
    starDelta: velocity.starDelta,
    percentDelta: velocity.percentDelta,
    currentStars: velocity.currentStars,
    tier: tierForStars(velocity.currentStars),
  };
}

/** Truncates a project's history to entries on or before `asOf` (a Date). */
function historyAsOf(project, asOf) {
  const asOfDateStr = asOf.toISOString().slice(0, 10);
  return (project.history ?? []).filter((entry) => entry.date <= asOfDateStr);
}

/**
 * For `scope: "global"`, a project listed in more than one domain is
 * deduped to its single best-scoring listing (ties keep whichever domain
 * was encountered first).
 */
export function dedupeBestById(candidates) {
  const bestById = new Map();
  for (const candidate of candidates) {
    const existing = bestById.get(candidate.id);
    if (!existing || candidate.score > existing.score) bestById.set(candidate.id, candidate);
  }
  return [...bestById.values()];
}

/**
 * Collects every eligible candidate for one scope ("global" or a domain
 * slug), as of `asOf`. `asOf` must be a `Date`. A candidate is eligible
 * when `computeVelocity` reports enough history for `windowDays` using
 * only history entries dated on or before `asOf` — this is what lets the
 * same function compute "today's" candidates and "yesterday's" candidates
 * just by varying `asOf`, with no separate stored rank data. `tier`, when
 * set, drops candidates outside that size tier *before* ranking; the tier is
 * decided from the star count as of `asOf`.
 */
function collectCandidates(domains, scope, windowDays, asOf, tier) {
  const relevantDomains = scope === "global" ? domains : domains.filter((d) => d.slug === scope);

  const candidates = [];
  for (const domain of relevantDomains) {
    for (const project of domain.projects) {
      const velocity = computeVelocity(historyAsOf(project, asOf), windowDays, { now: asOf });
      if (!velocity.hasEnoughHistory) continue;
      // A leaderboard called "Rising"/"risers" must never surface a flat or
      // shrinking project — mirrors the filter the removed computeTopRisers
      // used to apply in social-digest.mjs.
      if (velocity.starDelta <= 0) continue;
      if (isAnomalous(velocity)) continue;
      const candidate = toCandidate(domain, project, velocity);
      if (tier && candidate.tier !== tier) continue;
      candidates.push(candidate);
    }
  }

  return scope === "global" ? dedupeBestById(candidates) : candidates;
}

/** Sorts candidates by score descending (ties broken by name) and assigns 1-based `rank`. */
function rankCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return sorted.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/**
 * Ranks today's candidates and diffs each against its rank among
 * yesterday's. Only candidates eligible on both days are kept — intersected
 * by id BEFORE ranking, so both rank spaces cover the same population;
 * otherwise rank numbers gap once ineligible candidates are filtered out,
 * and rankDelta ends up diffing two differently-populated rank spaces.
 */
export function rankAgainstYesterday(todayCandidates, yesterdayCandidates) {
  const yesterdayById = new Map(yesterdayCandidates.map((c) => [c.id, c]));
  const eligibleToday = todayCandidates.filter((c) => yesterdayById.has(c.id));

  const todayRanked = rankCandidates(eligibleToday);
  const yesterdayRanked = rankCandidates(eligibleToday.map((c) => yesterdayById.get(c.id)));
  const yesterdayRankById = new Map(yesterdayRanked.map((c) => [c.id, c.rank]));

  return todayRanked.map((c) => ({ ...c, rankDelta: yesterdayRankById.get(c.id) - c.rank }));
}

/** The public row shape every leaderboard consumer reads. */
export function toRow(c) {
  return {
    rank: c.rank,
    id: c.id,
    name: c.name,
    link: c.link,
    image: c.image,
    desc: c.desc,
    domain: c.domain,
    domainShort: c.domainShort,
    domainSlug: c.domainSlug,
    starDelta: c.starDelta,
    percentDelta: c.percentDelta,
    currentStars: c.currentStars,
    rankDelta: c.rankDelta,
    tier: c.tier,
  };
}

/**
 * Computes a ranked, rank-diffed leaderboard for one scope ("global" or a
 * domain slug), window, and optional size `tier` (a tiers.mjs key; omitted =
 * every size). A project appears only when it has enough history to rank
 * both today and "yesterday" (`now` minus one day) — so every returned entry
 * always has a real prior rank to diff against, and there's no ambiguous
 * "new entry" case to special-case downstream. Projects failing the anomaly
 * guard (`isAnomalous`) never appear. `domains` is a domain list with each
 * project already joined against its own entity (see data-store.mjs's
 * `joinDomainProjects`) — each `{ slug, name, projects }`, where every
 * project carries its own `history` array directly.
 */
export function computeLeaderboard(domains, { scope, windowDays, limit = 20, now = new Date(), tier }) {
  const nowDate = new Date(now);
  const yesterdayDate = new Date(nowDate.getTime() - MS_PER_DAY);

  const today = collectCandidates(domains, scope, windowDays, nowDate, tier);
  const yesterday = collectCandidates(domains, scope, windowDays, yesterdayDate, tier);

  return rankAgainstYesterday(today, yesterday).slice(0, limit).map(toRow);
}

/**
 * Every project (deduped by id across domains) the anomaly guard would
 * exclude from a `windowDays` leaderboard as of `now` — for generate.mjs to
 * log, since `computeLeaderboard` itself drops them silently.
 */
export function findAnomalies(domains, { windowDays, now = new Date() }) {
  const asOf = new Date(now);
  const byId = new Map();
  for (const domain of domains) {
    for (const project of domain.projects) {
      if (byId.has(project.id)) continue;
      const velocity = computeVelocity(historyAsOf(project, asOf), windowDays, { now: asOf });
      if (velocity.hasEnoughHistory && isAnomalous(velocity)) {
        byId.set(project.id, { id: project.id, starDelta: velocity.starDelta, percentDelta: velocity.percentDelta, currentStars: velocity.currentStars });
      }
    }
  }
  return [...byId.values()];
}
```

- [ ] **Step 4: Run the full suite**

Run: `node --test`
Expected: PASS. The pre-existing leaderboard tests still pass unchanged (their fixtures are all under 10k stars and they assert individual fields, not whole rows). If any other test file deep-equals a whole leaderboard row, add `tier: "breakout"` to its expected object.

- [ ] **Step 5: Commit**

```bash
git add scripts/leaderboard.mjs test/leaderboard.test.js
git commit -m "feat: tier filter and anomaly guard for computeLeaderboard"
```

---

### Task 3: Spiking leaderboard

**Files:**
- Create: `scripts/spiking.mjs`
- Test: `test/spiking.test.js`

**Interfaces:**
- Consumes: `computeVelocity`, `MS_PER_DAY` (velocity.mjs); `isAnomalous`, `toCandidate`, `dedupeBestById`, `rankAgainstYesterday`, `toRow` (leaderboard.mjs, Task 2).
- Produces:
  - `SPIKING_WINDOW_DAYS = 7`, `SPIKING_BASELINE_WEEKS = 4`, `SPIKING_MIN_STAR_DELTA = 100`, `SPIKING_MIN_SHARE_OF_STARS = 0.005`, `SPIKING_SMOOTHING = 20`
  - `computeSpiking(domains, { scope, limit = 20, now = new Date() }): Array<Row & { multiple: number, priorWeekly: number, tier: "spiking" }>` — `Row` as in Task 2.

- [ ] **Step 1: Write the failing test**

```js
// test/spiking.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSpiking, SPIKING_SMOOTHING } from "../scripts/spiking.mjs";

const NOW = "2026-08-15T00:00:00.000Z";
const NOW_MS = new Date(NOW).getTime();
const daysAgo = (n) => new Date(NOW_MS - n * 86_400_000).toISOString().slice(0, 10);

/**
 * `points` maps days-ago -> stars. Today's window reads @0 vs @7 and the
 * prior month @7 vs @36 (35-day cutoff falls between); yesterday's reads @1
 * vs @8 and @8 vs @36.
 */
function project(id, points) {
  return {
    id,
    name: id,
    link: `https://${id}.example`,
    history: Object.entries(points).map(([n, stars]) => ({ date: daysAgo(Number(n)), stars })),
  };
}

const SPIKE = project("spike", { 36: 10000, 8: 10400, 7: 10400, 1: 14000, 0: 15000 }); // d7 4600, prior 100/wk
const STEADY = project("steady", { 36: 10000, 8: 13500, 7: 13600, 1: 14400, 0: 14500 }); // d7 900, prior 900/wk

const domain = (projects, slug = "data-science") => ({ slug, name: slug, projects });

test("computeSpiking ranks by this week's gain over the project's own prior weekly pace", () => {
  const rows = computeSpiking([domain([STEADY, SPIKE])], { scope: "global", now: NOW });
  assert.deepEqual(rows.map((r) => r.id), ["spike", "steady"]);
  assert.equal(rows[0].multiple, 4600 / (100 + SPIKING_SMOOTHING));
  assert.equal(rows[0].priorWeekly, 100);
  assert.equal(rows[0].starDelta, 4600);
  assert.equal(rows[0].tier, "spiking");
  assert.equal(rows[0].rank, 1);
  assert.equal(typeof rows[0].rankDelta, "number");
});

test("computeSpiking requires at least 100 stars gained this week", () => {
  const tiny = project("tiny", { 36: 1000, 8: 1000, 7: 1000, 1: 1050, 0: 1099 }); // d7 99
  assert.deepEqual(computeSpiking([domain([tiny])], { scope: "global", now: NOW }), []);
});

test("computeSpiking requires the gain to be at least 0.5% of current stars (filters big-project jitter)", () => {
  // bootstrap-style: ~10/wk normally, +112 this week on 175k stars — a 11x "multiple" that means nothing.
  const jitter = project("jitter", { 36: 174960, 8: 175000, 7: 175000, 1: 175100, 0: 175112 });
  assert.deepEqual(computeSpiking([domain([jitter])], { scope: "global", now: NOW }), []);
});

test("computeSpiking requires 35 days of history", () => {
  const young = project("young", { 20: 100, 8: 200, 7: 200, 1: 900, 0: 1000 });
  assert.deepEqual(computeSpiking([domain([young])], { scope: "global", now: NOW }), []);
});

test("computeSpiking treats a negative prior month as zero pace, giving a finite multiple", () => {
  const recovering = project("recovering", { 36: 5000, 8: 4800, 7: 4800, 1: 5200, 0: 5300 }); // prior -50/wk, d7 500
  const [row] = computeSpiking([domain([recovering])], { scope: "global", now: NOW });
  assert.equal(row.multiple, 500 / SPIKING_SMOOTHING);
  assert.ok(Number.isFinite(row.multiple));
});

test("computeSpiking excludes projects the anomaly guard flags", () => {
  const anomaly = project("anomaly", { 36: 10000, 8: 10000, 7: 10000, 1: 20000, 0: 20500 }); // +105% on 10k
  assert.deepEqual(computeSpiking([domain([anomaly])], { scope: "global", now: NOW }), []);
});

test("computeSpiking dedupes a project listed in two domains for the global scope, and scopes to one domain otherwise", () => {
  const domains = [domain([SPIKE, STEADY]), domain([SPIKE], "security")];
  assert.deepEqual(computeSpiking(domains, { scope: "global", now: NOW }).map((r) => r.id), ["spike", "steady"]);
  assert.deepEqual(computeSpiking(domains, { scope: "security", now: NOW }).map((r) => r.id), ["spike"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spiking.test.js`
Expected: FAIL — `Cannot find module '.../scripts/spiking.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// scripts/spiking.mjs
// Kept byte-identical with awesomemap-data/scripts/spiking.mjs.
import { computeVelocity, MS_PER_DAY } from "./velocity.mjs";
import { isAnomalous, toCandidate, dedupeBestById, rankAgainstYesterday, toRow } from "./leaderboard.mjs";

export const SPIKING_WINDOW_DAYS = 7;
// The project's "usual pace" is its average weekly gain over this many
// weeks, ending where this week's window starts.
export const SPIKING_BASELINE_WEEKS = 4;
// Floors that keep a big multiple from meaning nothing: a handful of stars
// on a usually-dead repo, or ordinary jitter on a huge one (bootstrap going
// 10 -> 112/week on 175k stars was the calibration case).
export const SPIKING_MIN_STAR_DELTA = 100;
export const SPIKING_MIN_SHARE_OF_STARS = 0.005;
// Pseudo-count added to the prior weekly pace so a project with ~no prior
// growth doesn't divide by ~zero.
export const SPIKING_SMOOTHING = 20;

/**
 * This week's gain vs. the project's own prior pace, as of `asOf` — or null
 * when the project isn't eligible (too little history, below a floor, or
 * anomalous). `priorWeekly` can be negative (a project that lost stars);
 * it's clamped to 0 for the multiple so the result stays finite and positive.
 */
function spikingStats(history, asOf) {
  const asOfStr = asOf.toISOString().slice(0, 10);
  const truncated = history.filter((entry) => entry.date <= asOfStr);
  const current = computeVelocity(truncated, SPIKING_WINDOW_DAYS, { now: asOf });
  if (!current.hasEnoughHistory) return null;

  const priorEnd = new Date(asOf.getTime() - SPIKING_WINDOW_DAYS * MS_PER_DAY);
  const priorEndStr = priorEnd.toISOString().slice(0, 10);
  const prior = computeVelocity(
    truncated.filter((entry) => entry.date <= priorEndStr),
    SPIKING_BASELINE_WEEKS * 7,
    { now: priorEnd }
  );
  if (!prior.hasEnoughHistory) return null;

  if (current.starDelta < SPIKING_MIN_STAR_DELTA) return null;
  if (current.starDelta < SPIKING_MIN_SHARE_OF_STARS * current.currentStars) return null;
  if (isAnomalous(current)) return null;

  const priorWeekly = prior.starDelta / SPIKING_BASELINE_WEEKS;
  const multiple = current.starDelta / (Math.max(priorWeekly, 0) + SPIKING_SMOOTHING);
  return { velocity: current, priorWeekly, multiple };
}

function collectSpikingCandidates(domains, scope, asOf) {
  const relevantDomains = scope === "global" ? domains : domains.filter((d) => d.slug === scope);
  const candidates = [];
  for (const domain of relevantDomains) {
    for (const project of domain.projects) {
      const stats = spikingStats(project.history ?? [], asOf);
      if (!stats) continue;
      candidates.push({
        ...toCandidate(domain, project, stats.velocity),
        score: stats.multiple,
        multiple: stats.multiple,
        priorWeekly: stats.priorWeekly,
      });
    }
  }
  return scope === "global" ? dedupeBestById(candidates) : candidates;
}

/**
 * The Spiking leaderboard: projects growing far faster than their own
 * usual pace this week, any size. Same scope/limit/now contract and
 * same today-vs-yesterday rankDelta rule as `computeLeaderboard`
 * (leaderboard.mjs), ranked by `multiple` instead of score. Rows carry
 * `multiple` and `priorWeekly` on top of the usual row shape, and
 * `tier: "spiking"` so renderers can treat them as their own tab.
 */
export function computeSpiking(domains, { scope, limit = 20, now = new Date() }) {
  const nowDate = new Date(now);
  const yesterdayDate = new Date(nowDate.getTime() - MS_PER_DAY);

  const today = collectSpikingCandidates(domains, scope, nowDate);
  const yesterday = collectSpikingCandidates(domains, scope, yesterdayDate);

  return rankAgainstYesterday(today, yesterday)
    .slice(0, limit)
    .map((c) => ({ ...toRow(c), multiple: c.multiple, priorWeekly: c.priorWeekly, tier: "spiking" }));
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/spiking.test.js test/leaderboard.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/spiking.mjs test/spiking.test.js
git commit -m "feat: add Spiking leaderboard (gain vs. own prior pace)"
```

---

### Task 4: Homepage signals — Breakout mover, Spiking replaces Heating up

**Files:**
- Modify: `scripts/this-weeks-signals.mjs` (`pickThisWeeksSignals` and its doc comment; delete `pickHeatingUpProject`; add `pickSpiking`)
- Test: `test/this-weeks-signals.test.js`

**Interfaces:**
- Consumes: `tierForStars`, `DEFAULT_TIER` (tiers.mjs). Spiking rows from `computeSpiking` (Task 3) — only `id`, `multiple`, `starDelta`, `name`, `domainShort`, `desc`, `eventReason` are read.
- Produces: `pickThisWeeksSignals(moverPool, { starThreshold = SMALL_PROJECT_STAR_THRESHOLD, spikingPool = [] } = {})` → `{ mover, spiking, watch, breakout, buzz, losingMomentum }` (no more `heatingUp`).

- [ ] **Step 1: Update and add tests in `test/this-weeks-signals.test.js`**

1. Replace the test at line ~26 ("mover is the candidate with the largest absolute starDelta…") with:

```js
test("pickThisWeeksSignals' mover is the Breakout-tier candidate with the largest absolute starDelta", () => {
  const pool = [
    candidate({ id: "big/big", starDelta: 500, currentStars: 50000 }), // Giants — never the mover
    candidate({ id: "mid/mid", starDelta: 400, currentStars: 12000 }), // Climbing — never the mover
    candidate({ id: "small/small", starDelta: 300, currentStars: 9000 }),
    candidate({ id: "tiny/tiny", starDelta: 20, currentStars: 100 }),
  ];
  const { mover } = pickThisWeeksSignals(pool);
  assert.equal(mover.id, "small/small");
});

test("pickThisWeeksSignals' mover is null when no candidate is in the Breakout tier", () => {
  const { mover } = pickThisWeeksSignals([candidate({ id: "big/big", starDelta: 500, currentStars: 50000 })]);
  assert.equal(mover, null);
});
```

2. Delete the three `heatingUp` tests (lines ~56–91: "heatingUp is the highest-percentDelta…", "heatingUp is null when the pool is empty", "heatingUp skips whichever candidate…").

3. In the test at ~93 ("mover/watch/heatingUp are all null…"), rename it to "mover/watch/breakout are all null…", change the destructuring to `const { mover, watch, breakout } = pickThisWeeksSignals(pool);` and delete the `assert.equal(heatingUp, null);` line.

4. In the breakout test at ~115, change `mover/mover`'s `currentStars: 90000` to `currentStars: 9000` (it must be Breakout to stay the mover).

5. Replace the buzz test at ~136 with:

```js
test("pickThisWeeksSignals' buzz is the candidate with the highest-points in-window eventReason, skipping ids every other upward signal claimed", () => {
  const pool = [
    // Highest starDelta in Breakout -> mover. Also carries the biggest event, but the mover card already shows its own reason line.
    candidate({ id: "mover/mover", starDelta: 900, percentDelta: 5, currentStars: 9000, eventReason: { type: "hn", points: 900 } }),
    candidate({ id: "spike/spike", starDelta: 30, percentDelta: 1, currentStars: 40000, eventReason: { type: "hn", points: 600 } }),
    candidate({ id: "loud/loud", starDelta: 40, percentDelta: 1, currentStars: 40000, eventReason: { type: "hn", points: 300 } }),
    candidate({ id: "quieter/quieter", starDelta: 60, percentDelta: 1, currentStars: 40000, eventReason: { type: "reddit", points: 120 } }),
    candidate({ id: "press/press", starDelta: 80, percentDelta: 1, currentStars: 40000, eventReason: { type: "blog" } }),
  ];
  const spikingPool = [candidate({ id: "spike/spike", multiple: 9, starDelta: 300, currentStars: 40000 })];
  const { mover, spiking, buzz } = pickThisWeeksSignals(pool, { spikingPool });
  assert.equal(mover.id, "mover/mover");
  assert.equal(spiking.id, "spike/spike");
  assert.equal(buzz.id, "loud/loud");
});
```

6. Append:

```js
test("pickThisWeeksSignals' spiking is the highest-multiple Spiking row not already claimed by mover/watch/breakout", () => {
  const pool = [
    candidate({ id: "mover/mover", starDelta: 900, currentStars: 9000 }),
  ];
  const spikingPool = [
    candidate({ id: "mover/mover", multiple: 20, starDelta: 900, currentStars: 9000 }), // claimed by mover
    candidate({ id: "b/b", multiple: 12, starDelta: 500, currentStars: 30000 }),
    candidate({ id: "c/c", multiple: 4, starDelta: 300, currentStars: 70000 }),
  ];
  const { spiking } = pickThisWeeksSignals(pool, { spikingPool });
  assert.equal(spiking.id, "b/b");
});

test("pickThisWeeksSignals' spiking is null when no spikingPool is given or every row is claimed", () => {
  assert.equal(pickThisWeeksSignals([candidate({})]).spiking, null);
  const pool = [candidate({ id: "mover/mover", starDelta: 900, currentStars: 9000 })];
  const spikingPool = [candidate({ id: "mover/mover", multiple: 20, starDelta: 900, currentStars: 9000 })];
  assert.equal(pickThisWeeksSignals(pool, { spikingPool }).spiking, null);
});

test("pickThisWeeksSignals' losingMomentum skips the id spiking claimed", () => {
  const pool = [
    candidate({ id: "slowing/slowing", starDelta: 120, currentStars: 30000, prevStarDelta: 900 }),
  ];
  const spikingPool = [candidate({ id: "slowing/slowing", multiple: 6, starDelta: 120, currentStars: 30000 })];
  const { spiking, losingMomentum } = pickThisWeeksSignals(pool, { spikingPool });
  assert.equal(spiking.id, "slowing/slowing");
  assert.equal(losingMomentum, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/this-weeks-signals.test.js`
Expected: FAIL — mover tests pick `big/big`; `spiking` is `undefined`.

- [ ] **Step 3: Implement**

In `scripts/this-weeks-signals.mjs`:

Add at the top:

```js
import { tierForStars, DEFAULT_TIER } from "./tiers.mjs";
```

Replace the body of `pickThisWeeksSignals` and its signature with:

```js
export function pickThisWeeksSignals(moverPool, { starThreshold = SMALL_PROJECT_STAR_THRESHOLD, spikingPool = [] } = {}) {
  const pool = moverPool.filter((candidate) => candidate.starDelta >= MIN_MEANINGFUL_STAR_DELTA);
  const mover = pickBiggestMover(pool.filter((candidate) => tierForStars(candidate.currentStars) === DEFAULT_TIER));
  const watch = pickOneToWatch(pool, starThreshold);
  const breakout = pickBreakout(pool, new Set([mover?.id, watch?.id].filter(Boolean)));
  const claimedIds = new Set([mover?.id, watch?.id, breakout?.id].filter(Boolean));
  const spiking = pickSpiking(spikingPool, claimedIds);
  if (spiking) claimedIds.add(spiking.id);
  return {
    mover,
    spiking,
    watch,
    breakout,
    buzz: pickBuzz(pool, claimedIds),
    losingMomentum: pickLosingMomentum(moverPool, claimedIds),
  };
}
```

Delete `pickHeatingUpProject` and add in its place:

```js
/** The highest-`multiple` Spiking row (a computeSpiking result) whose id isn't already claimed, or null. */
function pickSpiking(spikingPool, claimedIds) {
  const eligible = spikingPool.filter((candidate) => !claimedIds.has(candidate.id));
  if (eligible.length === 0) return null;
  return eligible.reduce((best, candidate) => (candidate.multiple > best.multiple ? candidate : best));
}
```

Update `pickBiggestMover`'s doc comment to: `/** The candidate with the largest absolute starDelta among the pool it's given — pickThisWeeksSignals passes only Breakout-tier candidates, so the headline card is never a giant. */`

Update `pickThisWeeksSignals`'s doc comment: replace every mention of `heatingUp` with `spiking`, and replace the paragraph explaining why heatingUp excludes mover/watch ids with: "`spikingPool` is the scope's uncapped `computeSpiking` result (spiking.mjs); `spiking` is picked after `mover`/`watch`/`breakout` and skips their ids. `mover` only considers Breakout-tier candidates (tiers.mjs) — the biggest absolute gain overall is almost always a giant."

- [ ] **Step 4: Run tests**

Run: `node --test test/this-weeks-signals.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/this-weeks-signals.mjs test/this-weeks-signals.test.js
git commit -m "feat: Breakout-only biggest mover; Spiking replaces Heating up"
```

---

### Task 5: Tiered `/rising/` page, rising rows, teaser tag, signal card, client filters

**Files:**
- Create: `app/shared/rising-filters.js`
- Create: `test/rising-filters.test.js`
- Modify: `scripts/render-page.mjs` — imports; `renderRisingRow`, `renderRisingRows`, `renderRisingTeaser` (~lines 840–905); `renderSignalCards`/`renderThisWeeksSignals` (~980–1075); `renderRisingWindowVariants`/`renderRisingSection`/`renderRisingPage` (~1139–1285)
- Modify: `app/shared/treemap.css` (append)
- Test: `test/render-page.test.js`

**Interfaces:**
- Consumes: `TIERS`, `DEFAULT_TIER`, `SPIKING_TAB` (tiers.mjs); rows with `tier` (Task 2) and `multiple` (Task 3); signals `{ mover, spiking, watch, breakout, buzz, losingMomentum }` (Task 4).
- Produces:
  - `renderRisingPage(domains, leaderboardsByTier, opts)` where `leaderboardsByTier = { [tierKey | "spiking"]: { [windowDays]: { [scopeKey]: Row[] } } }`; missing entries render as empty.
  - Internal helpers Task 6 reuses: `renderTierBar()`, `renderTieredRows(getRows, scopeKey, { windows, showDomain, basePath })`, `renderRisingFiltersBootstrap(basePath)`, where `getRows(tabKey, windowDays, scopeKey) => Row[]`.
  - `app/shared/rising-filters.js`: `DEFAULT_RISING_STATE`, `parseRisingHash(hash, { tierKeys, domainSlugs })`, `buildRisingHash(state)`, `effectiveWindow(state, firstWindow)`, `initRisingFilters(doc = document)`.
  - DOM contract: `.rising-tier-bar button[data-tier]`, `.rising-tier-explainer[data-tier]`, `.rising-rows[data-tier][data-window]`, `.rising-window-bar button[data-window]`, `.rising-domain-filter button[data-domain]`, `.rising-section[id]`.

- [ ] **Step 1: Write the failing filter-logic tests**

```js
// test/rising-filters.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRisingHash, buildRisingHash, effectiveWindow, DEFAULT_RISING_STATE } from "../app/shared/rising-filters.js";

const OPTS = { tierKeys: ["breakout", "climbing", "giants", "spiking"], domainSlugs: ["artificial-intelligence", "security"] };

test("parseRisingHash reads a domain, a tier, or both, in either order", () => {
  assert.deepEqual(parseRisingHash("#artificial-intelligence", OPTS), { ...DEFAULT_RISING_STATE, domain: "artificial-intelligence" });
  assert.deepEqual(parseRisingHash("#spiking", OPTS), { ...DEFAULT_RISING_STATE, tier: "spiking" });
  assert.deepEqual(parseRisingHash("#security/giants", OPTS), { ...DEFAULT_RISING_STATE, domain: "security", tier: "giants" });
  assert.deepEqual(parseRisingHash("#giants/security", OPTS), { ...DEFAULT_RISING_STATE, domain: "security", tier: "giants" });
});

test("parseRisingHash falls back to the default view for empty, unknown, or malformed hashes", () => {
  for (const hash of ["", "#", "#nope", "#zzz/qqq", "#%E0%A4%A"]) {
    assert.deepEqual(parseRisingHash(hash, OPTS), DEFAULT_RISING_STATE, hash);
  }
  assert.deepEqual(parseRisingHash("#security/zzz", OPTS), { ...DEFAULT_RISING_STATE, domain: "security" });
});

test("buildRisingHash omits defaults, so the default view has no hash", () => {
  assert.equal(buildRisingHash(DEFAULT_RISING_STATE), "");
  assert.equal(buildRisingHash({ ...DEFAULT_RISING_STATE, domain: "security" }), "#security");
  assert.equal(buildRisingHash({ ...DEFAULT_RISING_STATE, tier: "spiking" }), "#spiking");
  assert.equal(buildRisingHash({ ...DEFAULT_RISING_STATE, domain: "security", tier: "giants", window: "30" }), "#security/giants");
});

test("effectiveWindow forces Spiking to the first window but leaves the chosen window intact for size tiers", () => {
  assert.equal(effectiveWindow({ tier: "spiking", window: "30" }, "7"), "7");
  assert.equal(effectiveWindow({ tier: "breakout", window: "30" }, "7"), "30");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/rising-filters.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `app/shared/rising-filters.js`**

```js
// Client-side state for /rising/ and tiered archive week pages: which size
// tier (or Spiking), which window, which domain. Every combination is
// pre-rendered at build time (render-page.mjs's renderTieredRows); this only
// toggles `hidden`. "breakout" and "spiking" are duplicated from
// scripts/tiers.mjs rather than imported — scripts/ is build-time-only and
// never copied into dist/ (same convention as detail-panel.js).
export const DEFAULT_RISING_STATE = { tier: "breakout", window: "7", domain: "all" };
const WINDOW_LOCKED_TIERS = new Set(["spiking"]);

/** Reads `#<domain>`, `#<tier>`, or `#<domain>/<tier>` (either order); unknown parts are ignored. */
export function parseRisingHash(hash, { tierKeys, domainSlugs }) {
  const state = { ...DEFAULT_RISING_STATE };
  let raw;
  try {
    raw = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return state;
  }
  for (const part of raw.split("/")) {
    if (tierKeys.includes(part)) state.tier = part;
    else if (domainSlugs.includes(part)) state.domain = part;
  }
  return state;
}

/** The inverse of parseRisingHash, omitting defaults ("" for the default view). Window isn't encoded. */
export function buildRisingHash(state) {
  const parts = [];
  if (state.domain !== DEFAULT_RISING_STATE.domain) parts.push(state.domain);
  if (state.tier !== DEFAULT_RISING_STATE.tier) parts.push(state.tier);
  return parts.length > 0 ? `#${parts.join("/")}` : "";
}

/** Spiking only exists for the first window; size tiers keep whatever window the visitor chose. */
export function effectiveWindow(state, firstWindow = DEFAULT_RISING_STATE.window) {
  return WINDOW_LOCKED_TIERS.has(state.tier) ? firstWindow : state.window;
}

export function initRisingFilters(doc = document) {
  const tierButtons = [...doc.querySelectorAll(".rising-tier-bar [data-tier]")];
  const windowButtons = [...doc.querySelectorAll(".rising-window-bar [data-window]")];
  const domainButtons = [...doc.querySelectorAll(".rising-domain-filter [data-domain]")];
  const firstWindow = windowButtons[0]?.dataset.window ?? DEFAULT_RISING_STATE.window;

  const state = parseRisingHash(location.hash, {
    tierKeys: tierButtons.map((b) => b.dataset.tier),
    domainSlugs: domainButtons.map((b) => b.dataset.domain).filter((slug) => slug !== "all"),
  });
  state.window = firstWindow;

  function apply() {
    const windowNow = effectiveWindow(state, firstWindow);
    tierButtons.forEach((b) => {
      const active = b.dataset.tier === state.tier;
      b.classList.toggle("rising-tier-button-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    doc.querySelectorAll(".rising-tier-explainer").forEach((p) => {
      p.hidden = p.dataset.tier !== state.tier;
    });
    windowButtons.forEach((b) => {
      b.disabled = WINDOW_LOCKED_TIERS.has(state.tier) && b.dataset.window !== firstWindow;
      b.classList.toggle("treemap-window-button-active", b.dataset.window === windowNow);
    });
    doc.querySelectorAll(".rising-rows").forEach((el) => {
      el.hidden = el.dataset.tier !== state.tier || el.dataset.window !== windowNow;
    });
    if (domainButtons.length > 0) {
      domainButtons.forEach((b) => b.classList.toggle("rising-domain-button-active", b.dataset.domain === state.domain));
      const targetSectionId = state.domain === "all" ? "global" : state.domain;
      doc.querySelectorAll(".rising-section").forEach((section) => {
        section.hidden = section.id !== targetSectionId;
      });
    }
  }

  function commit() {
    apply();
    const hash = buildRisingHash(state);
    history.replaceState(null, "", hash || location.pathname + location.search);
  }

  tierButtons.forEach((b) => b.addEventListener("click", () => { state.tier = b.dataset.tier; commit(); }));
  windowButtons.forEach((b) => b.addEventListener("click", () => { if (!b.disabled) { state.window = b.dataset.window; commit(); } }));
  domainButtons.forEach((b) => b.addEventListener("click", () => { state.domain = b.dataset.domain; commit(); }));
  apply();
}
```

- [ ] **Step 4: Run filter tests**

Run: `node --test test/rising-filters.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Update existing render tests and add new ones (failing)**

In `test/render-page.test.js`:

1. Every `renderRisingPage(<domains>, leaderboardsByWindow, …)` call (13 of them) becomes `renderRisingPage(<domains>, { breakout: leaderboardsByWindow }, …)`.
2. Replace the test at ~598 ("inline script applies the domain filter matching the URL hash…") with:

```js
test("renderRisingPage boots the shared rising-filters module (which reads the URL hash) instead of an inline filter script", () => {
  const html = renderRisingPage([], { breakout: { 7: { global: [] }, 30: { global: [] } } }, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /import \{ initRisingFilters \} from "\/techmap\/shared\/rising-filters\.js";\s*initRisingFilters\(\);/);
  assert.doesNotMatch(html, /applyDomainFilter/);
});
```

3. In the test at ~610 ("domain filter swaps to that domain's own top-20 section…"), delete the two `assert.match` calls on the script text (`targetSectionId` and `querySelectorAll(".rising-section")`); keep the section/heading/Project A assertions.
4. In the test at ~646 ("shows a not-ready placeholder…"), change the expected text to `/No growing projects in this tier this week\./` and add `assert.match(html, /No growing projects in this tier for this domain this week\./);`.
5. Replace the test at ~657 ("renders both window variants…") with:

```js
test("renderRisingPage pre-renders every tab × window, only Breakout 7d visible, and Spiking has no 30d block", () => {
  const html = renderRisingPage([], { breakout: { 7: { global: [] }, 30: { global: [] } } }, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<div class="rising-rows" data-tier="breakout" data-window="7">/);
  assert.match(html, /<div class="rising-rows" data-tier="breakout" data-window="30" hidden>/);
  assert.match(html, /<div class="rising-rows" data-tier="climbing" data-window="7" hidden>/);
  assert.match(html, /<div class="rising-rows" data-tier="giants" data-window="30" hidden>/);
  assert.match(html, /<div class="rising-rows" data-tier="spiking" data-window="7" hidden>/);
  assert.doesNotMatch(html, /data-tier="spiking" data-window="30"/);
});
```

6. Append:

```js
test("renderRisingPage renders the tier tab bar with Breakout active, plus one explainer per tab", () => {
  const html = renderRisingPage([], {}, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<button type="button" role="tab" class="rising-tier-button rising-tier-button-active" data-tier="breakout" aria-selected="true">Breakout<\/button>/);
  assert.match(html, /data-tier="climbing" aria-selected="false">Climbing<\/button>/);
  assert.match(html, /data-tier="giants" aria-selected="false">Giants<\/button>/);
  assert.match(html, /data-tier="spiking" aria-selected="false">Spiking<\/button>/);
  assert.match(html, /<p class="rising-tier-explainer" data-tier="breakout">Projects under 10k stars, ranked by star growth\.<\/p>/);
  assert.match(html, /<p class="rising-tier-explainer" data-tier="spiking" hidden>Projects growing far faster than their own usual pace\.<\/p>/);
  assert.match(html, /Fast-growing projects, grouped by size — start with the ones that haven't hit 10k stars yet\./);
});

test("renderRisingPage shows a Spiking row's multiple instead of its percent", () => {
  const spikingRow = { rank: 1, id: "s/s", name: "Spiker", domain: "AI", starDelta: 5554, percentDelta: 21.8, rankDelta: 0, multiple: 11.94, tier: "spiking" };
  const html = renderRisingPage([], { spiking: { 7: { global: [spikingRow] } } }, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<span class="rising-row-delta">11\.9× its usual pace \(\+5554\)<\/span>/);
});

test("renderDomainPage's teaser tags rows borrowed from Climbing, and only those", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const teaser = [
    { rank: 1, id: "a/a", name: "Project A", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0, tier: "breakout" },
    { rank: 1, id: "b/b", name: "Project B", domain: "Data Science", starDelta: 90, percentDelta: 4, rankDelta: 0, tier: "climbing" },
  ];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", teaser });
  assert.equal((html.match(/<span class="rising-row-tier">Climbing<\/span>/g) ?? []).length, 1);
});

test("renderDomainPage's teaser shows the empty message when the domain has no rows at all", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", teaser: [] });
  assert.match(html, /class="rising-teaser"[\s\S]*Not enough star-history yet for this window\./);
});
```

7. Signal cards: run

```bash
sed -i 's/heatingUp: { id: "c\/c", name: "Project C", domainShort: "Data Science", percentDelta: 12 }/spiking: { id: "c\/c", name: "Project C", domainShort: "Data Science", multiple: 12, starDelta: 400 }/; s/heatingUp: null/spiking: null/; s/heatingUp signal card/spiking signal card/' test/render-page.test.js
```

then append:

```js
test("renderLandingPage's spiking signal card shows the multiple and this week's gain", () => {
  const signals = { mover: null, spiking: { id: "c/c", name: "Project C", domainShort: "Data Science", multiple: 11.94, starDelta: 5554 }, watch: null };
  const html = renderLandingPage([], { defaultOgImage: "/og-default.png", signals });
  assert.match(html, /⚡ Spiking/);
  assert.match(html, /<span class="signal-card-stat">11\.9× its usual pace \(\+5554 stars this week\)<\/span>/);
  assert.doesNotMatch(html, /Heating up/);
});
```

Run: `node --test test/render-page.test.js`
Expected: FAIL (tab bar, data-tier blocks, bootstrap, multiple stat, tier tag, spiking card all missing).

- [ ] **Step 6: Implement in `scripts/render-page.mjs`**

Add to the imports:

```js
import { TIERS, DEFAULT_TIER, SPIKING_TAB } from "./tiers.mjs";
```

Add near the other rising helpers (above `renderRisingRow`):

```js
// The four /rising/ tabs, in display order: the three size tiers, then Spiking.
const RISING_TABS = [...TIERS.map((tier) => ({ key: tier.key, label: tier.label })), SPIKING_TAB];
const TIER_LABELS = Object.fromEntries(TIERS.map((tier) => [tier.key, tier.label]));
const RISING_TAB_EXPLAINERS = {
  breakout: "Projects under 10k stars, ranked by star growth.",
  climbing: "Projects with 10k–50k stars, ranked by star growth.",
  giants: "Projects over 50k stars, ranked by star growth.",
  spiking: "Projects growing far faster than their own usual pace.",
};
```

In `renderRisingRow`, change the signature to `function renderRisingRow(entry, { showDomain, basePath, showTier = false })` and add after the `reasonBadge` const:

```js
  // Spiking rows carry `multiple` (spiking.mjs) — their story is the change
  // of pace, not the percent. Archived Spiking rows have no `multiple` (D1
  // doesn't store it) and fall back to the normal stat.
  const deltaText =
    typeof entry.multiple === "number"
      ? `${entry.multiple.toFixed(1)}× its usual pace (${sign}${entry.starDelta})`
      : `${sign}${entry.starDelta} (${sign}${pct}%)`;
  // Only the domain teaser mixes tiers (composeTeaser tops Breakout up from
  // Climbing); there, tag every non-default-tier row so it doesn't pass as a Breakout.
  const tierTag =
    showTier && entry.tier && entry.tier !== DEFAULT_TIER && TIER_LABELS[entry.tier]
      ? `<span class="rising-row-tier">${escapeHtml(TIER_LABELS[entry.tier])}</span>`
      : "";
```

and in its returned markup put `${tierTag}` on the line after `${reasonBadge}`, and replace `<span class="rising-row-delta">${sign}${entry.starDelta} (${sign}${pct}%)</span>` with `<span class="rising-row-delta">${deltaText}</span>`.

Replace `renderRisingRows` with:

```js
/** Renders a leaderboard's rows, or `emptyMessage` when `entries` is empty (e.g. a domain too new for this window, or with nothing in this tier). */
function renderRisingRows(entries, { showDomain, basePath, showTier = false, emptyMessage = "Not enough star-history yet for this window." }) {
  if (entries.length === 0) {
    return `<p class="rising-empty">${escapeHtml(emptyMessage)}</p>`;
  }
  return `<ol class="rising-rows-list">${entries.map((entry) => renderRisingRow(entry, { showDomain, basePath, showTier })).join("")}</ol>`;
}
```

In `renderRisingTeaser`, change the rows call to `renderRisingRows(entries, { showDomain, basePath, showTier: true })`.

Replace `renderRisingWindowVariants` and `renderRisingSection` with:

```js
/** Spiking is 7-day only (spiking.mjs); size tiers get every window. */
function risingWindowsFor(tabKey, windows) {
  return tabKey === SPIKING_TAB.key ? windows.slice(0, 1) : windows;
}

/**
 * Every tab × window block for one scope, only Breakout + the first window
 * visible initially — rising-filters.js flips `hidden` client-side, so
 * switching never re-fetches or recomputes anything. `getRows(tabKey,
 * windowDays, scopeKey)` returns that block's rows (empty when absent).
 */
function renderTieredRows(getRows, scopeKey, { windows, showDomain, basePath }) {
  const emptyMessage =
    scopeKey === "global" ? "No growing projects in this tier this week." : "No growing projects in this tier for this domain this week.";
  return RISING_TABS.flatMap((tab) =>
    risingWindowsFor(tab.key, windows).map((windowDays) => {
      const visible = tab.key === DEFAULT_TIER && windowDays === windows[0];
      const rows = renderRisingRows(getRows(tab.key, windowDays, scopeKey), { showDomain, basePath, emptyMessage });
      return `<div class="rising-rows" data-tier="${tab.key}" data-window="${windowDays}"${visible ? "" : " hidden"}>${rows}</div>`;
    })
  ).join("");
}

/** The Breakout/Climbing/Giants/Spiking tab bar plus one explainer line per tab. */
function renderTierBar() {
  const buttons = RISING_TABS.map((tab) => {
    const active = tab.key === DEFAULT_TIER;
    return `<button type="button" role="tab" class="rising-tier-button${active ? " rising-tier-button-active" : ""}" data-tier="${tab.key}" aria-selected="${active}">${escapeHtml(tab.label)}</button>`;
  }).join("");
  const explainers = RISING_TABS.map(
    (tab) => `<p class="rising-tier-explainer" data-tier="${tab.key}"${tab.key === DEFAULT_TIER ? "" : " hidden"}>${escapeHtml(RISING_TAB_EXPLAINERS[tab.key])}</p>`
  ).join("");
  return `
    <div class="rising-tier-bar" role="tablist" aria-label="Project size">${buttons}</div>
    ${explainers}`;
}

function renderRisingFiltersBootstrap(basePath) {
  return `
    <script type="module">
      import { initRisingFilters } from "${basePath}/shared/rising-filters.js";
      initRisingFilters();
    </script>`;
}

/** One leaderboard section (heading + every tab × window block), anchorable by `id`. */
function renderRisingSection({ id, heading, getRows, scopeKey, windows, showDomain, basePath, hidden = false }) {
  return `
    <section class="rising-section" id="${escapeHtml(id)}"${hidden ? " hidden" : ""}>
      <h2 class="rising-section-heading">${escapeHtml(heading)}</h2>
      ${renderTieredRows(getRows, scopeKey, { windows, showDomain, basePath })}
    </section>`;
}
```

In `renderRisingPage`:
- Rename the second parameter to `leaderboardsByTier` and update the doc comment's shape description to `{ [tabKey]: { [windowDays]: { global: entries[], [slug]: entries[] } } }` (tab keys from tiers.mjs plus "spiking"; Spiking has only the first window).
- At the top of the function body add:

```js
  const getRows = (tabKey, windowDays, scopeKey) => leaderboardsByTier[tabKey]?.[windowDays]?.[scopeKey] ?? [];
  const windows = RISING_WINDOWS_DAYS;
```

- Both `renderRisingSection({...})` calls: replace `leaderboardsByWindow,` with `getRows, windows,`.
- Change the tagline to `<p class="rising-hero-tagline">Fast-growing projects, grouped by size — start with the ones that haven't hit 10k stars yet.</p>`.
- Insert `${renderTierBar()}` on the line before `${domainFilterBar}`.
- Delete the whole inline `<script>…</script>` block and put `${renderRisingFiltersBootstrap(basePath)}` in its place.
- Change `ogDescription` to `"Fast-growing open-source projects grouped by size, plus the week's sudden spikes — updated daily."`.

In `renderSignalCards`, change the destructured parameter `heatingUp` to `spiking`, and replace the whole `heatingUp && renderSignalCard({...})` entry with:

```js
    spiking &&
      renderSignalCard({
        label: "⚡ Spiking",
        title: spiking.name,
        stat: `${spiking.multiple.toFixed(1)}× its usual pace (+${spiking.starDelta} stars this week)`,
        meta: spiking.domainShort,
        href: `${basePath}/projects/${spiking.id}/`,
        compareId: spiking.id,
        desc: spiking.desc,
        reason: formatEventReason(spiking.eventReason),
      }),
```

Update its doc comment's list "heating-up project" → "spiking project". In `renderThisWeeksSignals`, change `s?.heatingUp` to `s?.spiking` in `hasSignal`.

Append to `app/shared/treemap.css`:

```css
.rising-tier-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 6px;
}

.rising-tier-button {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  color: var(--color-text);
  font-weight: 600;
}

.rising-tier-button-active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}

.rising-tier-explainer {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--color-text-muted, var(--color-text));
}

.rising-row-tier {
  align-self: flex-start;
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.rising-window-bar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

Before committing, check `app/shared/treemap.css` for the actual muted-text variable name (`grep -n "\-\-color-" app/shared/treemap.css | head`) and use it in `.rising-tier-explainer` instead of the fallback chain if one exists.

- [ ] **Step 7: Run tests**

Run: `node --test`
Expected: PASS (whole suite)

- [ ] **Step 8: Commit**

```bash
git add app/shared/rising-filters.js app/shared/treemap.css scripts/render-page.mjs test/rising-filters.test.js test/render-page.test.js
git commit -m "feat: tiered /rising/ tabs, Spiking rows and card, tagged teaser rows"
```

---

### Task 6: Tiered archive week page and RSS

**Files:**
- Modify: `scripts/render-page.mjs` — `renderRisingArchiveWeekPage` (~line 1333)
- Modify: `scripts/rss.mjs` — `formatRiserListHtml` caller in `buildRisingFeed`; add `formatSpikeLineHtml`
- Test: `test/render-page.test.js`, `test/rss.test.js`

**Interfaces:**
- Consumes: `renderTierBar`, `renderTieredRows`, `renderRisingFiltersBootstrap`, `renderRisingRows` (Task 5, same file). Snapshot `{ isoWeek, generatedAt, scopes }` where tiered snapshots have keys `breakout:global`, `climbing:<slug>`, `spiking:global`, … plus legacy `global`/`<slug>`.
- Produces: no new exports.

- [ ] **Step 1: Write failing tests**

Append to `test/render-page.test.js`:

```js
test("renderRisingArchiveWeekPage renders tier tabs for a tiered snapshot, with the empty message for a tier that had no rows", () => {
  const row = (id, extra = {}) => ({ rank: 1, id, name: id, domain: "Data Science", domainShort: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0, ...extra });
  const snapshot = {
    isoWeek: "2026-W43",
    generatedAt: "2026-10-26T08:00:00.000Z",
    scopes: {
      global: [row("a/a")],
      "breakout:global": [row("a/a")],
      "climbing:global": [row("b/b")],
      "giants:global": [],
      "breakout:data-science": [row("a/a")],
    },
  };
  const domains = [{ slug: "data-science", name: "Data Science", shortName: "Data Science" }];
  const html = renderRisingArchiveWeekPage(snapshot, domains, { defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(html, /class="rising-tier-bar"/);
  assert.match(html, /<div class="rising-rows" data-tier="breakout" data-window="7">/);
  assert.match(html, /<div class="rising-rows" data-tier="climbing" data-window="7" hidden>[\s\S]*?b\/b/);
  assert.match(html, /<div class="rising-rows" data-tier="spiking" data-window="7" hidden><p class="rising-empty">No growing projects in this tier this week\.<\/p>/);
  assert.match(html, /initRisingFilters\(\)/);
  assert.match(html, /Hottest in Data Science/);
});

test("renderRisingArchiveWeekPage keeps the legacy single-list layout for a pre-tier snapshot", () => {
  const snapshot = {
    isoWeek: "2026-W35",
    generatedAt: "2026-08-31T08:00:00.000Z",
    scopes: { global: [{ rank: 1, id: "a/a", name: "Project A", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 1 }] },
  };
  const html = renderRisingArchiveWeekPage(snapshot, [], { defaultOgImage: "/og-default.png", basePath: "" });
  assert.doesNotMatch(html, /rising-tier-bar/);
  assert.match(html, /Hottest overall/);
});
```

Append to `test/rss.test.js`:

```js
test("buildRisingFeed lists a tiered snapshot's Breakout risers and its biggest spike", () => {
  const xml = buildRisingFeed(
    [
      {
        isoWeek: "2026-W43",
        generatedAt: "2026-10-26T08:00:00.000Z",
        scopes: {
          global: [{ id: "old/old", name: "Legacy Copy", domain: "AI", starDelta: 1, percentDelta: 1 }],
          "breakout:global": [{ id: "a/a", name: "Small One", domain: "AI", starDelta: 300, percentDelta: 40 }],
          "spiking:global": [{ id: "s/s", name: "Spiker", domain: "Security", starDelta: 5554, percentDelta: 21.8 }],
        },
      },
    ],
    { siteUrl: "https://example.com" }
  );
  assert.match(xml, /Small One/);
  assert.doesNotMatch(xml, /Legacy Copy/);
  assert.match(xml, /Biggest spike: Spiker \(\+5554 stars this week\)/);
});

test("buildRisingFeed falls back to scopes.global and omits the spike line for a pre-tier snapshot", () => {
  const xml = buildRisingFeed(SNAPSHOTS, { siteUrl: "https://example.com" });
  assert.match(xml, /Project B/);
  assert.doesNotMatch(xml, /Biggest spike/);
});
```

Run: `node --test test/render-page.test.js test/rss.test.js`
Expected: FAIL (no tier bar on archive page; feed lists "Legacy Copy"; no spike line).

- [ ] **Step 2: Implement the archive page**

At the top of `renderRisingArchiveWeekPage`'s body, after `const { isoWeek, generatedAt, scopes } = snapshot;`, branch:

```js
  // Snapshots from before tiers (no `breakout:global` key) keep the
  // original single-list layout; tiered ones get the same tabs as /rising/,
  // 7-day only (snapshots are weekly).
  const isTiered = Array.isArray(scopes["breakout:global"]);
  const getRows = (tabKey, _windowDays, scopeKey) => scopes[`${tabKey}:${scopeKey}`] ?? [];
  const hasAnyTieredRows = (scopeKey) => RISING_TABS.some((tab) => getRows(tab.key, 7, scopeKey).length > 0);
```

Then make `globalSection` and `domainSections` conditional:

```js
  const globalSection = isTiered
    ? renderRisingSection({ id: "global", heading: "Hottest overall", getRows, scopeKey: "global", windows: [7], showDomain: true, basePath })
    : `
    <section class="rising-section">
      <h2 class="rising-section-heading">Hottest overall</h2>
      ${renderRisingRows(scopes.global ?? [], { showDomain: true, basePath })}
    </section>`;
  const domainSections = domains
    .map((domain) => {
      const heading = `Hottest in ${domain.shortName ?? domain.name}`;
      if (isTiered) {
        if (!hasAnyTieredRows(domain.slug)) return "";
        return renderRisingSection({ id: domain.slug, heading, getRows, scopeKey: domain.slug, windows: [7], showDomain: false, basePath });
      }
      const entries = scopes[domain.slug] ?? [];
      if (entries.length === 0) return "";
      return `
        <section class="rising-section">
          <h2 class="rising-section-heading">${escapeHtml(heading)}</h2>
          ${renderRisingRows(entries, { showDomain: false, basePath })}
        </section>`;
    })
    .join("");
```

In the page `body`, insert `${isTiered ? renderTierBar() : ""}` right after the closing `</header>`, and `${isTiered ? renderRisingFiltersBootstrap(basePath) : ""}` right before `${renderSiteFooter(basePath)}` (archive pages have no domain filter or window bar; rising-filters.js tolerates both being absent and leaves every section visible).

- [ ] **Step 3: Implement RSS**

In `scripts/rss.mjs`, add below `formatRiserListHtml`:

```js
/**
 * One line naming the week's top Spiking project, or "" when the snapshot
 * has none (every pre-tier snapshot). Archived rows don't carry `multiple`
 * (no D1 column for it), so the line states the gain instead.
 */
function formatSpikeLineHtml(spikingRows) {
  const top = spikingRows?.[0];
  if (!top) return "";
  return `<p>Biggest spike: ${escapeXml(top.name)} (+${top.starDelta} stars this week)</p>`;
}
```

and change the `<description>` line in `buildRisingFeed` to:

```js
      <description>${escapeXml(formatRiserListHtml(snapshot.scopes?.["breakout:global"] ?? snapshot.scopes?.global) + formatSpikeLineHtml(snapshot.scopes?.["spiking:global"]))}</description>
```

Update `formatRiserListHtml`'s doc comment: "`risers` is a snapshot's `scopes["breakout:global"]` (tiered snapshots) or `scopes.global` (older ones)".

Note: the line content is double-escaped through `escapeXml` exactly like the existing list (it's HTML inside an XML text node), so the test regex matches the escaped-once text: `Biggest spike: Spiker (+5554 stars this week)` appears inside `&lt;p&gt;…&lt;/p&gt;`.

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/render-page.mjs scripts/rss.mjs test/render-page.test.js test/rss.test.js
git commit -m "feat: tier tabs on archive weeks; RSS leads with Breakout and the week's spike"
```

---

### Task 7: Wire `generate.mjs` and the detail-panel tier rank

**Files:**
- Create: `app/shared/rank-label.js`
- Create: `test/rank-label.test.js`
- Modify: `app/shared/detail-panel.js:257-283` (`renderDomainRankLine`)
- Modify: `scripts/generate.mjs` (imports ~line 25–30; Pass 2 ~154–166; domainRank ~302–312; teaser ~325; signals ~410–420; `renderRisingPage` call ~439)

**Interfaces:**
- Consumes: `TIERS`, `DEFAULT_TIER`, `composeTeaser` (Task 1); `computeLeaderboard`, `findAnomalies` (Task 2); `computeSpiking`, `SPIKING_WINDOW_DAYS` (Task 3); `pickThisWeeksSignals(pool, { spikingPool })` (Task 4); `renderRisingPage(domains, leaderboardsByTier, …)` (Task 5).
- Produces: `formatDomainRank(rankInfo: { tier, rank } | null | undefined, { windowDays, domainShort }): string | null` in `app/shared/rank-label.js`; leaf field `domainRank: { rising7: { tier, rank } | null, rising30: { tier, rank } | null }`.

- [ ] **Step 1: Write the failing test**

```js
// test/rank-label.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDomainRank } from "../app/shared/rank-label.js";

test("formatDomainRank names the project's own tier, singular", () => {
  assert.equal(formatDomainRank({ tier: "breakout", rank: 3 }, { windowDays: "7", domainShort: "AI" }), "#3 Breakout in AI over 7 days");
  assert.equal(formatDomainRank({ tier: "climbing", rank: 5 }, { windowDays: "30", domainShort: "AI" }), "#5 Climbing in AI over 30 days");
  assert.equal(formatDomainRank({ tier: "giants", rank: 2 }, { windowDays: "7", domainShort: "AI" }), "#2 Giant in AI over 7 days");
});

test("formatDomainRank falls back to 'this domain' and returns null without a rank", () => {
  assert.equal(formatDomainRank({ tier: "breakout", rank: 1 }, { windowDays: "7" }), "#1 Breakout in this domain over 7 days");
  assert.equal(formatDomainRank(null, { windowDays: "7", domainShort: "AI" }), null);
  assert.equal(formatDomainRank(undefined, { windowDays: "7", domainShort: "AI" }), null);
});
```

Run: `node --test test/rank-label.test.js`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `app/shared/rank-label.js`**

```js
// Singular tier labels, duplicated from scripts/tiers.mjs's TIERS[].singular
// rather than imported — scripts/ is build-time-only and never copied into
// dist/ (same convention as detail-panel.js's DEFAULT_MOMENTUM_WINDOW_DAYS).
const TIER_SINGULAR_LABELS = { breakout: "Breakout", climbing: "Climbing", giants: "Giant" };

/**
 * The detail panel's rank line ("#3 Breakout in AI over 7 days") from one
 * window's `domainRank` entry (`{ tier, rank }`, stamped by generate.mjs),
 * or null when the project doesn't rank in that window.
 */
export function formatDomainRank(rankInfo, { windowDays, domainShort }) {
  if (!rankInfo || typeof rankInfo.rank !== "number") return null;
  const label = TIER_SINGULAR_LABELS[rankInfo.tier] ?? "rising";
  const where = domainShort ? `in ${domainShort}` : "in this domain";
  return `#${rankInfo.rank} ${label} ${where} over ${windowDays} days`;
}
```

- [ ] **Step 3: Use it in `app/shared/detail-panel.js`**

Add `import { formatDomainRank } from "./rank-label.js";` to the imports. Replace `renderDomainRankLine` (keep the first paragraph of its doc comment, change the example to "#3 Breakout in AI over 7 days") with:

```js
function renderDomainRankLine(leafData) {
  const key = leafData.activeSizeKey;
  if (!key || key === "popular") return null;

  const text = formatDomainRank(leafData.domainRank?.[key], {
    windowDays: key.replace("rising", ""),
    domainShort: leafData.domainShort,
  });
  if (!text) return null;

  const paragraph = document.createElement("p");
  paragraph.className = "detail-panel-rank";
  paragraph.textContent = text;
  return paragraph;
}
```

Run: `node --test test/rank-label.test.js`
Expected: PASS

- [ ] **Step 4: Wire `scripts/generate.mjs`**

Imports — change/add:

```js
import { computeLeaderboard, findAnomalies } from "./leaderboard.mjs";
import { computeSpiking, SPIKING_WINDOW_DAYS } from "./spiking.mjs";
import { TIERS, DEFAULT_TIER, composeTeaser } from "./tiers.mjs";
```

Replace Pass 2 (the `leaderboardsByWindow` block, ~154–166) with:

```js
// Pass 2: compute every tier's leaderboards (global + one per domain, per
// window), plus the 7-day-only Spiking list — this powers the /rising/ tabs,
// every teaser, and each project's tier rank below. Shape:
// leaderboardsByTier[tabKey][windowDays][scope].
function leaderboardsForEveryScope(compute) {
  const byScope = { global: compute("global") };
  for (const domain of parsedDomains) byScope[domain.slug] = compute(domain.slug);
  return byScope;
}

const leaderboardsByTier = {};
for (const tier of TIERS) {
  leaderboardsByTier[tier.key] = {};
  for (const windowDays of RISING_WINDOWS_DAYS) {
    leaderboardsByTier[tier.key][windowDays] = leaderboardsForEveryScope((scope) =>
      withEventReason(computeLeaderboard(parsedDomains, { scope, windowDays, limit: LEADERBOARD_LIMIT, tier: tier.key }), windowDays)
    );
  }
}
leaderboardsByTier.spiking = {
  [SPIKING_WINDOW_DAYS]: leaderboardsForEveryScope((scope) =>
    withEventReason(computeSpiking(parsedDomains, { scope, limit: LEADERBOARD_LIMIT }), SPIKING_WINDOW_DAYS)
  ),
};

// The anomaly guard drops these silently from every leaderboard above; say
// so in the build log so a real breakout wrongly caught can be spotted.
for (const windowDays of RISING_WINDOWS_DAYS) {
  for (const anomaly of findAnomalies(parsedDomains, { windowDays })) {
    console.warn(
      `Anomaly guard: excluded ${anomaly.id} from ${windowDays}d leaderboards (+${anomaly.starDelta} stars, +${anomaly.percentDelta.toFixed(0)}%)`
    );
  }
}
```

`withEventReason` is defined above Pass 2 already (it's used by the old block) — leave it where it is.

Replace the `domainRank` loop (~306–311) with:

```js
    const domainRank = {};
    for (const windowDays of RISING_WINDOWS_DAYS) {
      let rankInfo = null;
      for (const tier of TIERS) {
        const entry = leaderboardsByTier[tier.key][windowDays][slug].find((row) => row.id === project.id);
        if (entry) {
          rankInfo = { tier: tier.key, rank: entry.rank };
          break;
        }
      }
      domainRank[`rising${windowDays}`] = rankInfo;
    }
```

and update the comment above it: "Each project's rank within its own size tier on its domain's leaderboard, per window — the "#3 Breakout in AI" context the detail panel shows."

Replace the teaser line (~325) with:

```js
  const teaser = composeTeaser(
    leaderboardsByTier[DEFAULT_TIER][TEASER_WINDOW_DAYS][slug],
    leaderboardsByTier.climbing[TEASER_WINDOW_DAYS][slug],
    { limit: TEASER_LIMIT }
  );
```

Replace the two `pickThisWeeksSignals(...)` calls (~410 and ~418) with:

```js
const thisWeeksSignals = pickThisWeeksSignals(globalSignalsPool, {
  spikingPool: withEventReason(computeSpiking(parsedDomains, { scope: "global", limit: Infinity }), SPIKING_WINDOW_DAYS),
});
```

and inside the per-domain loop:

```js
  thisWeeksSignalsByDomain[domain.slug] = pickThisWeeksSignals(domainSignalsPool, {
    spikingPool: withEventReason(computeSpiking(parsedDomains, { scope: domain.slug, limit: Infinity }), SPIKING_WINDOW_DAYS),
  });
```

Change the `renderRisingPage(domains, leaderboardsByWindow, {` call to `renderRisingPage(domains, leaderboardsByTier, {`.

Then confirm nothing still references the old name:

Run: `grep -n "leaderboardsByWindow" scripts/generate.mjs`
Expected: no output.

- [ ] **Step 5: Run the suite and a real build**

Run: `node --test`
Expected: PASS

Run: `npm run generate 2>&1 | tail -20`
Expected: build completes; at least one `Anomaly guard: excluded morluto/rea …` warning (if that project is still in the data); no exceptions.

Run: `grep -c 'data-tier="spiking"' dist/rising/index.html && grep -o 'rising-row-tier">[A-Za-z]*' dist/*/index.html | sort | uniq -c | head`
Expected: a count ≥ 1 for the first; the second may be empty (only domains with < 3 Breakout rows show tags).

- [ ] **Step 6: Commit**

```bash
git add app/shared/rank-label.js app/shared/detail-panel.js scripts/generate.mjs test/rank-label.test.js
git commit -m "feat: build tiered leaderboards, Spiking, teasers and tier ranks"
```

---

### Task 8: awesomemap-data — sync shared modules and write tiered snapshots

Work in `/home/haggai/workspace/awesomemap/awesomemap-data`. First: `git checkout main && git pull --ff-only && git checkout -b feat/rising-tiers`. The repo has an untracked `.agents/` directory — leave it alone and never `git add -A`.

**Files:**
- Create (copied): `scripts/tiers.mjs`, `scripts/spiking.mjs`, `test/tiers.test.js`, `test/spiking.test.js`
- Replace (copied): `scripts/leaderboard.mjs`, `test/leaderboard.test.js`
- Modify: `scripts/leaderboard-snapshot.mjs` (`buildWeeklySnapshot`, `main`'s log line)
- Test: `test/leaderboard-snapshot.test.js` (append)

**Interfaces:**
- Consumes: the three modules from Tasks 1–3, byte-identical. This repo's `velocity.mjs` differs from the frontend's (`RISING_WINDOWS_DAYS = [7, 30, 90]`) but exports the same `computeVelocity`/`MS_PER_DAY`, which is all the copied modules use.
- Produces: `buildWeeklySnapshot(domains, { isoWeek, limit })` returns `{ global, <slug>..., "breakout:global", "climbing:global", "giants:global", "spiking:global", "breakout:<slug>", ... }`.

- [ ] **Step 1: Copy the shared modules and their tests**

```bash
cp ../awesomemap/scripts/tiers.mjs ../awesomemap/scripts/spiking.mjs ../awesomemap/scripts/leaderboard.mjs scripts/
cp ../awesomemap/test/tiers.test.js ../awesomemap/test/spiking.test.js ../awesomemap/test/leaderboard.test.js test/
```

Run: `node --test test/tiers.test.js test/spiking.test.js test/leaderboard.test.js`
Expected: PASS

- [ ] **Step 2: Write the failing snapshot tests** (append to `test/leaderboard-snapshot.test.js`)

```js
test("buildWeeklySnapshot writes every tier and Spiking under <tier>:<scope> keys, for global and each domain", () => {
  const scopes = buildWeeklySnapshot(DOMAINS, { isoWeek: "2026-W33" });
  for (const tab of ["breakout", "climbing", "giants", "spiking"]) {
    for (const scope of ["global", "data-science", "security"]) {
      assert.ok(Array.isArray(scopes[`${tab}:${scope}`]), `${tab}:${scope}`);
    }
  }
});

test("buildWeeklySnapshot's plain scope keys are a copy of Breakout, so existing readers keep working", () => {
  const scopes = buildWeeklySnapshot(DOMAINS, { isoWeek: "2026-W33" });
  assert.deepEqual(scopes.global, scopes["breakout:global"]);
  assert.deepEqual(scopes["data-science"], scopes["breakout:data-science"]);
});
```

Run: `node --test test/leaderboard-snapshot.test.js`
Expected: FAIL — `breakout:global` undefined.

- [ ] **Step 3: Implement**

In `scripts/leaderboard-snapshot.mjs` add imports:

```js
import { computeSpiking } from "./spiking.mjs";
import { TIERS, DEFAULT_TIER } from "./tiers.mjs";
```

Replace `buildWeeklySnapshot` (keep the existing doc comment, and add a paragraph: "Each scope is stored once per size tier and once for Spiking, under `<tier>:<scope>` keys — `leaderboard_snapshots.scope` is a free string, so no schema change. The plain `<scope>` key is still written, as a copy of Breakout, for readers that predate tiers. Spiking rows lose `multiple` on the way into D1 (no column for it); the frontend falls back to the normal stat for them.") with:

```js
export function buildWeeklySnapshot(domains, { isoWeek, limit = SNAPSHOT_LIMIT } = {}) {
  const { end } = isoWeekBounds(isoWeek);
  const scopes = {};
  for (const scope of ["global", ...domains.map((domain) => domain.slug)]) {
    for (const tier of TIERS) {
      scopes[`${tier.key}:${scope}`] = computeLeaderboard(domains, { scope, windowDays: WINDOW_DAYS, limit, now: end, tier: tier.key });
    }
    scopes[`spiking:${scope}`] = computeSpiking(domains, { scope, limit, now: end });
    scopes[scope] = scopes[`${DEFAULT_TIER}:${scope}`];
  }
  return scopes;
}
```

In `main()`, change the log line to:

```js
  console.log(`Saved leaderboard snapshot for ${isoWeek} (${scopes.global.length} Breakout global entries, ${domains.length} domains, ${Object.keys(scopes).length} scope keys).`);
```

- [ ] **Step 4: Run the data repo's full suite**

Run: `node --test`
Expected: PASS. If an existing test asserts the exact set of `Object.keys(scopes)`, update its expectation to include the `<tier>:<scope>` keys.

Run: `cmp scripts/leaderboard.mjs ../awesomemap/scripts/leaderboard.mjs && cmp scripts/tiers.mjs ../awesomemap/scripts/tiers.mjs && cmp scripts/spiking.mjs ../awesomemap/scripts/spiking.mjs && echo IN_SYNC`
Expected: `IN_SYNC`

- [ ] **Step 5: Commit**

```bash
git add scripts/tiers.mjs scripts/spiking.mjs scripts/leaderboard.mjs scripts/leaderboard-snapshot.mjs test/tiers.test.js test/spiking.test.js test/leaderboard.test.js test/leaderboard-snapshot.test.js
git commit -m "feat: tiered and Spiking weekly leaderboard snapshots"
```

---

### Task 9: End-to-end check in the browser

No code changes unless a defect is found (then fix in the owning task's files, re-run `node --test`, and commit as `fix: …`).

- [ ] **Step 1: Build**

Run (in `awesomemap/`): `npm run generate 2>&1 | tail -5`
Expected: completes without exceptions.

- [ ] **Step 2: Open the preview**

Use the `preview_start` tool with name `awesomemap-dist` (defined in `/home/haggai/workspace/awesomemap/.claude/launch.json`, serves `awesomemap/dist` on port 5000).

- [ ] **Step 3: Check `/rising/`**

Navigate to `http://localhost:5000/rising/`, then verify with `read_page`/`find`:
- Breakout tab active; visible rows all have current stars < 10k (spot-check 3 project pages).
- Click Climbing, Giants, Spiking: the visible block changes; Spiking rows read "N× its usual pace"; the 30d button is disabled on Spiking.
- Pick 30d on Breakout → Spiking → Breakout: 30d is selected again.
- Navigate to `/rising/#artificial-intelligence/spiking` and to `/rising/#nope`: the first opens AI + Spiking; the second the default view. `read_console_messages` shows no errors.
- `morluto/rea` appears nowhere on the page (`find` "rea").

- [ ] **Step 4: Check homepage and a domain page**

- `/`: signals show "🔥 Biggest mover" with a project under 10k stars and a "⚡ Spiking" card; no "Heating up".
- One domain page: "Rising this week" teaser shows Breakout rows (and tagged Climbing rows if the domain has < 3 Breakout).
- Open a project's detail panel in Rising mode: rank line reads "#N Breakout|Climbing|Giant in <domain> over 7 days".

- [ ] **Step 5: Mobile + dark**

`resize_window` preset `mobile`: tier bar wraps, no horizontal scroll on `/rising/`. Then `colorScheme: "dark"`: active tab readable. Reset with preset `desktop`.

- [ ] **Step 6: Screenshot for the PR**

Take a `computer` screenshot of `/rising/` (Breakout) and one of the Spiking tab.
