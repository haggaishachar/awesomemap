# Rising Projects View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Rising" sizing mode (alongside today's "Popular" mode) to every domain map, sizing tiles by GitHub star-growth velocity over a selectable 7/30/90-day window instead of only by total star count.

**Architecture:** A new daily-cron script snapshots every tool's star count into `data/history/<slug>.json`. A new pure `scripts/velocity.mjs` module turns that history into a growth score per tool per window. `generate.mjs` precomputes all four size values (`popular`, `rising7/30/90`) at build time and bakes them into the generated page; the client-side `layout.js`/`treemap.js`/`detail-panel.js` read whichever value the active mode+window selects, with no extra network call.

**Tech Stack:** Node.js (ESM), `d3-hierarchy`, Node's built-in `node --test` runner, GitHub Actions, vanilla DOM JS (no framework).

## Global Constraints

- Velocity formula: `score = starDelta / sqrt(max(currentStars, 1))`, floored at `SCORE_FLOOR = 0.01` (a d3 treemap weight must be strictly positive).
- Supported rising windows: 7, 30, 90 days (`RISING_WINDOWS_DAYS`).
- History retention: 120 days (`MAX_AGE_DAYS`) — comfortably past the longest window, with headroom.
- No history backfill — the snapshot job starts capturing from its ship date; a 90-day window isn't meaningful until ~90 days of real snapshots exist.
- The curated schema (`data/<slug>.json`) is unchanged. `weight` still means "current star count" and still drives Popular-mode sizing exactly as today.
- New pure logic lives in `.mjs` modules under `scripts/` or `app/shared/`, unit-tested with Node's built-in test runner (`test/*.test.js`) — matching this project's existing convention (see `test/enrich-domain.test.js`, `test/build-tree.test.js`, `test/layout.test.js`).
- Orchestration/I/O glue (`generate.mjs`'s top-level script body, `snapshot-history.mjs`'s `main()`) and DOM code (`treemap.js`, `detail-panel.js`) are **not** unit tested, matching this project's existing convention (`generate.mjs`, `enrich-domain.mjs`'s `main()`, and `treemap.js`/`detail-panel.js` have none today either) — verified manually instead.
- A tool that doesn't yet have enough history for the selected window renders at its floor size with a visual "insufficient history" marker, never a silent fallback to a different metric.
- `RISING_WINDOWS_DAYS = [7, 30, 90]` is intentionally defined twice — once in `scripts/velocity.mjs` (build-time) and once inline in `app/shared/treemap.js` (browser-time) — because `scripts/` is never copied into `dist/`. Keep both lists in sync if a window is ever added or removed.

---

### Task 1: Velocity scoring — `computeVelocity`

**Files:**
- Create: `scripts/velocity.mjs`
- Test: `test/velocity.test.js`

**Interfaces:**
- Produces: `computeVelocity(history, windowDays, { now } = {})` → `{ score, hasEnoughHistory, starDelta, percentDelta, oldestDate }`. `history` is an array of `{ date: "YYYY-MM-DD", stars: number }` in any order. `now` (optional, injectable for tests) is anything `new Date(now)` accepts.
- Produces: `RISING_WINDOWS_DAYS` = `[7, 30, 90]`.
- Produces: `MS_PER_DAY` = `24 * 60 * 60 * 1000` (re-exported for `snapshot-history.mjs`'s pruning logic in Task 3).

- [ ] **Step 1: Write the failing tests**

Create `test/velocity.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVelocity } from "../scripts/velocity.mjs";

const NOW = "2026-08-08T00:00:00.000Z";

test("computeVelocity reports no history for an empty history array", () => {
  const result = computeVelocity([], 30, { now: NOW });
  assert.equal(result.hasEnoughHistory, false);
  assert.equal(result.starDelta, 0);
  assert.equal(result.percentDelta, 0);
  assert.equal(result.oldestDate, null);
  assert.ok(result.score > 0, "score must stay positive so the treemap never gets a zero/negative weight");
});

test("computeVelocity uses a snapshot exactly at the window boundary", () => {
  const history = [
    { date: "2026-07-09", stars: 100 }, // exactly 30 days before NOW
    { date: "2026-08-08", stars: 150 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.hasEnoughHistory, true);
  assert.equal(result.starDelta, 50);
  assert.equal(result.percentDelta, 50);
});

test("computeVelocity is insufficient for a window longer than the available history, even if a shorter window works", () => {
  const history = [
    { date: "2026-08-01", stars: 100 }, // only 7 days of history before NOW
    { date: "2026-08-08", stars: 120 },
  ];
  assert.equal(computeVelocity(history, 30, { now: NOW }).hasEnoughHistory, false);

  const result7 = computeVelocity(history, 7, { now: NOW });
  assert.equal(result7.hasEnoughHistory, true);
  assert.equal(result7.starDelta, 20);
});

test("computeVelocity resolves to the closest snapshot at or before the window boundary when there's a gap", () => {
  const history = [
    { date: "2026-07-01", stars: 80 },
    { date: "2026-07-05", stars: 90 }, // closest to the cutoff (2026-07-09) without going past it
    { date: "2026-08-08", stars: 150 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.starDelta, 60); // 150 - 90, not 150 - 80
});

test("computeVelocity floors the score at a small positive epsilon for a declining project", () => {
  const history = [
    { date: "2026-07-09", stars: 500 },
    { date: "2026-08-08", stars: 100 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.starDelta, -400);
  assert.ok(result.score > 0, "score must never be zero or negative");
});

test("computeVelocity reports oldestDate as the earliest snapshot's date, even when history is insufficient for the window", () => {
  const history = [
    { date: "2026-08-01", stars: 100 },
    { date: "2026-08-08", stars: 120 },
  ];
  const insufficient = computeVelocity(history, 30, { now: NOW });
  assert.equal(insufficient.hasEnoughHistory, false);
  assert.equal(insufficient.oldestDate, "2026-08-01");

  const sufficient = computeVelocity(history, 7, { now: NOW });
  assert.equal(sufficient.oldestDate, "2026-08-01");
});

test("computeVelocity treats a zero-star baseline as 0% growth rather than dividing by zero", () => {
  const history = [
    { date: "2026-07-09", stars: 0 },
    { date: "2026-08-08", stars: 10 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.starDelta, 10);
  assert.equal(result.percentDelta, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern=computeVelocity`
Expected: FAIL — `scripts/velocity.mjs` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `scripts/velocity.mjs`:

```js
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The lowest positive size a tool's rising score can ever be. d3's
// treemap requires strictly positive weights, so a declining or
// no-history tool still renders a (negligible) tile instead of vanishing
// or breaking layout.
const SCORE_FLOOR = 0.01;

/** Rising windows this feature supports, in days. */
export const RISING_WINDOWS_DAYS = [7, 30, 90];

/**
 * Computes a growth-velocity score for one tool from its raw star-count
 * history. `history` is an array of `{ date: "YYYY-MM-DD", stars }`
 * entries in any order; `windowDays` is how far back to measure growth.
 *
 * The baseline snapshot is the entry closest to (but not after)
 * `windowDays` ago — a missed snapshot day doesn't break the lookup, it
 * just measures from whatever's closest available. `hasEnoughHistory` is
 * false when even the oldest snapshot is younger than the window, since
 * there's no data point far back enough to measure the full window from.
 *
 * `score = starDelta / sqrt(max(currentStars, 1))`, floored at
 * `SCORE_FLOOR` so it's always a valid positive treemap weight, even for
 * a shrinking project.
 */
export function computeVelocity(history, windowDays, { now = new Date() } = {}) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const oldestDate = sorted.length > 0 ? sorted[0].date : null;

  if (sorted.length === 0) {
    return { score: SCORE_FLOOR, hasEnoughHistory: false, starDelta: 0, percentDelta: 0, oldestDate };
  }

  const currentStars = sorted[sorted.length - 1].stars;
  const cutoff = new Date(now).getTime() - windowDays * MS_PER_DAY;

  let baseline = null;
  for (const entry of sorted) {
    if (new Date(entry.date).getTime() <= cutoff) baseline = entry;
    else break;
  }

  if (baseline === null) {
    return { score: SCORE_FLOOR, hasEnoughHistory: false, starDelta: 0, percentDelta: 0, oldestDate };
  }

  const starDelta = currentStars - baseline.stars;
  const percentDelta = baseline.stars > 0 ? (starDelta / baseline.stars) * 100 : 0;
  const rawScore = starDelta / Math.sqrt(Math.max(currentStars, 1));

  return { score: Math.max(rawScore, SCORE_FLOOR), hasEnoughHistory: true, starDelta, percentDelta, oldestDate };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern=computeVelocity`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/velocity.mjs test/velocity.test.js
git commit -m "feat: add computeVelocity for star-growth scoring"
```

---

### Task 2: Velocity scoring — `computeToolSizing` and `findInvalidSizes`

**Files:**
- Modify: `scripts/velocity.mjs`
- Test: `test/velocity.test.js`

**Interfaces:**
- Consumes: `computeVelocity`, `RISING_WINDOWS_DAYS` from Task 1 (same file).
- Produces: `computeToolSizing(tool, historyEntries = [], { now } = {})` → `{ sizes, hasEnoughHistory, growth }`, where `sizes` is `{ popular, rising7, rising30, rising90 }`, `hasEnoughHistory` is `{ rising7, rising30, rising90 }` (booleans), and `growth` is `{ rising7, rising30, rising90 }`, each `{ starDelta, percentDelta, oldestDate }`. Consumed by `generate.mjs` in Task 7.
- Produces: `findInvalidSizes(tools)` → array of tool ids whose `sizes` has a non-numeric/non-finite/non-positive value. Consumed by `generate.mjs` in Task 7.

- [ ] **Step 1: Write the failing tests**

Append to `test/velocity.test.js`:

```js
import { computeToolSizing, findInvalidSizes, RISING_WINDOWS_DAYS } from "../scripts/velocity.mjs";

test("computeToolSizing builds sizes/hasEnoughHistory/growth for every rising window plus popular", () => {
  const tool = { id: "a/a", weight: 1000 };
  const history = [
    { date: "2026-05-10", stars: 700 }, // ~90 days before NOW
    { date: "2026-08-08", stars: 1000 },
  ];
  const result = computeToolSizing(tool, history, { now: NOW });

  assert.equal(result.sizes.popular, 1000);
  for (const windowDays of RISING_WINDOWS_DAYS) {
    const key = `rising${windowDays}`;
    assert.equal(typeof result.sizes[key], "number");
    assert.equal(typeof result.hasEnoughHistory[key], "boolean");
    assert.ok(result.growth[key]);
  }
});

test("computeToolSizing defaults popular to 1 when the tool has no weight", () => {
  const result = computeToolSizing({ id: "a/a" }, [], { now: NOW });
  assert.equal(result.sizes.popular, 1);
});

test("computeToolSizing marks every rising window as insufficient when there's no history at all", () => {
  const result = computeToolSizing({ id: "a/a", weight: 5 }, [], { now: NOW });
  for (const windowDays of RISING_WINDOWS_DAYS) {
    assert.equal(result.hasEnoughHistory[`rising${windowDays}`], false);
  }
});

test("findInvalidSizes flags a tool with a non-positive or missing size, and leaves valid tools alone", () => {
  const tools = [
    { id: "good", sizes: { popular: 10, rising7: 0.5, rising30: 0.2, rising90: 0.1 } },
    { id: "bad-zero", sizes: { popular: 0, rising7: 1, rising30: 1, rising90: 1 } },
    { id: "bad-missing", sizes: { popular: 10, rising7: 1, rising30: 1 } },
  ];
  assert.deepEqual(findInvalidSizes(tools), ["bad-zero", "bad-missing"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="computeToolSizing|findInvalidSizes"`
Expected: FAIL — both functions are undefined.

- [ ] **Step 3: Write the implementation**

Append to `scripts/velocity.mjs`:

```js
/**
 * Builds the full `{ sizes, hasEnoughHistory, growth }` structure
 * `generate.mjs` embeds onto a tool's leaf node: one size per mode
 * (`popular` plus one `rising<N>` per supported window), whether each
 * rising window has enough history, and the growth stats behind each
 * rising size (used by the detail panel).
 */
export function computeToolSizing(tool, historyEntries = [], { now } = {}) {
  const sizes = { popular: typeof tool.weight === "number" ? tool.weight : 1 };
  const hasEnoughHistory = {};
  const growth = {};

  for (const windowDays of RISING_WINDOWS_DAYS) {
    const key = `rising${windowDays}`;
    const result = computeVelocity(historyEntries, windowDays, { now });
    sizes[key] = result.score;
    hasEnoughHistory[key] = result.hasEnoughHistory;
    growth[key] = { starDelta: result.starDelta, percentDelta: result.percentDelta, oldestDate: result.oldestDate };
  }

  return { sizes, hasEnoughHistory, growth };
}

/**
 * Given tools that have already been through `computeToolSizing` (i.e.
 * each has a `sizes` object), returns the ids of any tool whose `sizes`
 * contains a non-numeric, non-finite, or non-positive value — a broken
 * tile should never reach production. Mirrors `enrich-domain.mjs`'s
 * `findInvalidWeights` for this feature's own `sizes` field.
 */
export function findInvalidSizes(tools) {
  const bad = [];
  for (const tool of tools) {
    const sizes = tool.sizes ?? {};
    const values = ["popular", ...RISING_WINDOWS_DAYS.map((d) => `rising${d}`)].map((key) => sizes[key]);
    const invalid = values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0);
    if (invalid) bad.push(tool.id);
  }
  return bad;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="velocity|Velocity|ToolSizing|InvalidSizes"`
Expected: PASS (all `velocity.test.js` tests, 11 total)

- [ ] **Step 5: Commit**

```bash
git add scripts/velocity.mjs test/velocity.test.js
git commit -m "feat: add computeToolSizing and findInvalidSizes"
```

---

### Task 3: Snapshot history — pure append/prune functions

**Files:**
- Create: `scripts/snapshot-history.mjs`
- Test: `test/snapshot-history.test.js`

**Interfaces:**
- Consumes: `MS_PER_DAY` from `scripts/velocity.mjs` (Task 1).
- Produces: `appendSnapshotEntry(entries, snapshot)` → new array, `snapshot` is `{ date, stars }`. Consumed by Task 4's `main()`.
- Produces: `pruneOldEntries(entries, { now, maxAgeDays } = {})` → new array. Consumed by Task 4's `main()`.

- [ ] **Step 1: Write the failing tests**

Create `test/snapshot-history.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendSnapshotEntry, pruneOldEntries } from "../scripts/snapshot-history.mjs";

test("appendSnapshotEntry appends a new day's entry, keeping entries sorted by date", () => {
  const entries = [{ date: "2026-08-06", stars: 100 }];
  const result = appendSnapshotEntry(entries, { date: "2026-08-07", stars: 110 });
  assert.deepEqual(result, [
    { date: "2026-08-06", stars: 100 },
    { date: "2026-08-07", stars: 110 },
  ]);
});

test("appendSnapshotEntry replaces (not duplicates) an existing same-date entry", () => {
  const entries = [
    { date: "2026-08-06", stars: 100 },
    { date: "2026-08-07", stars: 110 },
  ];
  const result = appendSnapshotEntry(entries, { date: "2026-08-07", stars: 115 });
  assert.deepEqual(result, [
    { date: "2026-08-06", stars: 100 },
    { date: "2026-08-07", stars: 115 },
  ]);
});

test("appendSnapshotEntry sorts an out-of-order insert into place", () => {
  const entries = [{ date: "2026-08-07", stars: 110 }];
  const result = appendSnapshotEntry(entries, { date: "2026-08-01", stars: 90 });
  assert.deepEqual(result, [
    { date: "2026-08-01", stars: 90 },
    { date: "2026-08-07", stars: 110 },
  ]);
});

test("pruneOldEntries drops entries older than maxAgeDays relative to now", () => {
  const entries = [
    { date: "2026-01-01", stars: 10 }, // way older than 120 days before NOW below
    { date: "2026-05-01", stars: 50 },
    { date: "2026-08-08", stars: 100 },
  ];
  const result = pruneOldEntries(entries, { now: "2026-08-08T00:00:00.000Z", maxAgeDays: 120 });
  assert.deepEqual(result, [
    { date: "2026-05-01", stars: 50 },
    { date: "2026-08-08", stars: 100 },
  ]);
});

test("pruneOldEntries keeps an entry exactly at the maxAgeDays boundary", () => {
  const entries = [
    { date: "2026-04-10", stars: 40 }, // exactly 120 days before NOW below
    { date: "2026-08-08", stars: 100 },
  ];
  const result = pruneOldEntries(entries, { now: "2026-08-08T00:00:00.000Z", maxAgeDays: 120 });
  assert.deepEqual(result, entries);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="appendSnapshotEntry|pruneOldEntries"`
Expected: FAIL — `scripts/snapshot-history.mjs` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `scripts/snapshot-history.mjs`:

```js
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseGhRepo, createGetJson } from "./enrich-domain.mjs";
import { MS_PER_DAY } from "./velocity.mjs";

const DATA_DIR = "data";
const HISTORY_DIR = "data/history";
const MAX_AGE_DAYS = 120;

/**
 * Inserts today's `{ date, stars }` snapshot into a tool's history array,
 * keeping entries sorted ascending by date. A snapshot sharing an existing
 * entry's date replaces that entry rather than duplicating it, so running
 * the job twice in one day is a no-op the second time.
 */
export function appendSnapshotEntry(entries, snapshot) {
  const withoutSameDate = entries.filter((entry) => entry.date !== snapshot.date);
  return [...withoutSameDate, snapshot].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Drops entries older than `maxAgeDays` relative to `now`. 120 days
 * comfortably covers the longest supported rising window (90 days) with
 * headroom, keeping history files small and bounded.
 */
export function pruneOldEntries(entries, { now = new Date(), maxAgeDays = MAX_AGE_DAYS } = {}) {
  const cutoff = new Date(now).getTime() - maxAgeDays * MS_PER_DAY;
  return entries.filter((entry) => new Date(entry.date).getTime() >= cutoff);
}

function todayIso(now) {
  return new Date(now).toISOString().slice(0, 10);
}

// CLI entry point: node scripts/snapshot-history.mjs
// Snapshots every tool in every data/<slug>.json into
// data/history/<slug>.json. Thin I/O orchestration, not unit tested (same
// convention as generate.mjs / enrich-domain.mjs's main()) — verified
// manually in Task 4.
async function main() {
  const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const getJson = createGetJson(token);
  mkdirSync(HISTORY_DIR, { recursive: true });

  const today = todayIso(new Date());
  const domainFiles = readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"));

  for (const file of domainFiles) {
    const domain = JSON.parse(readFileSync(`${DATA_DIR}/${file}`, "utf8"));
    const historyPath = `${HISTORY_DIR}/${domain.slug}.json`;
    const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : {};

    let fetched = 0;
    let failed = 0;
    for (const tool of domain.tools) {
      const repo = parseGhRepo(tool.id);
      if (!repo) continue;
      try {
        const repoData = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
        const existing = history[tool.id] ?? [];
        const withToday = appendSnapshotEntry(existing, { date: today, stars: repoData.stargazers_count });
        history[tool.id] = pruneOldEntries(withToday, { now: new Date() });
        fetched += 1;
      } catch (err) {
        failed += 1;
        console.error(`Warning: failed to snapshot "${tool.id}": ${err.message}`);
      }
    }

    writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
    console.log(`${historyPath}: ${fetched} snapshot(s) recorded, ${failed} failed`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="appendSnapshotEntry|pruneOldEntries"`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/snapshot-history.mjs test/snapshot-history.test.js
git commit -m "feat: add snapshot-history append/prune logic"
```

---

### Task 4: Snapshot history — manual verification of the CLI

**Files:**
- None (no code changes — this task exercises Task 3's `main()` against real fixture data).

- [ ] **Step 1: Run the script against the real repo data**

```bash
node scripts/snapshot-history.mjs
```

Expected: for each `data/*.json` domain, a `data/history/<slug>.json` file is created (or updated) and a summary line like `data/history/data-science.json: 44/44 snapshot(s) recorded, 0 failed` is printed. Requires `gh auth token` to succeed locally (same precondition as `enrich-domain.mjs`).

- [ ] **Step 2: Inspect one history file**

```bash
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('data/history/data-science.json','utf8'))['scikit-learn/scikit-learn'], null, 2))"
```

Expected: an array with exactly one `{ date: "<today>", stars: <number> }` entry.

- [ ] **Step 3: Re-run and confirm idempotency**

```bash
node scripts/snapshot-history.mjs
node -e "console.log(JSON.parse(require('fs').readFileSync('data/history/data-science.json','utf8'))['scikit-learn/scikit-learn'].length)"
```

Expected: still `1` (today's entry was replaced in place, not duplicated).

- [ ] **Step 4: Commit the fixture history produced by this run**

This gives the repo real starting history data rather than shipping the feature with every domain at "no history yet."

```bash
git add data/history
git commit -m "chore: seed initial star-history snapshot"
```

---

### Task 5: Daily snapshot GitHub Action

**Files:**
- Create: `.github/workflows/snapshot-history.yml`

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/snapshot-history.yml`:

```yaml
name: Snapshot Star History

on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: snapshot-history
  cancel-in-progress: false

jobs:
  snapshot:
    runs-on: ubuntu-latest
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: node scripts/snapshot-history.mjs
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/history
          if git diff --cached --quiet; then
            echo "No history changes to commit."
          else
            git commit -m "chore: snapshot star history"
            git push
          fi
```

- [ ] **Step 2: Verify the workflow is syntactically valid**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/snapshot-history.yml')); print('OK')" 2>/dev/null \
  || node -e "require('.github/workflows/snapshot-history.yml')" 2>&1 | grep -q "Cannot find module" \
  && echo "manual review only (no YAML parser available locally) — re-check indentation by eye"
```

Expected: either `OK`, or (if no local YAML parser is available) a reminder to double-check indentation by eye — GitHub itself will reject a malformed workflow file when the branch is pushed, visible as a red X / parse error on the Actions tab.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/snapshot-history.yml
git commit -m "feat: add daily star-history snapshot workflow"
```

(This step is fully verified end-to-end in Task 12, after pushing the branch, via `gh workflow run snapshot-history.yml --ref <branch>`.)

---

### Task 6: `layout.js` — size mode parameter

**Files:**
- Modify: `app/shared/layout.js:9-17`
- Test: `test/layout.test.js`

**Interfaces:**
- Produces: `weightOf(nodeData, sizeKey = "popular")` — signature change, backward compatible (existing 1-arg calls keep working). Consumed by Task 9 (`treemap.js` doesn't call this directly, but `buildHierarchy` does).
- Produces: `buildHierarchy(rootData, sizeKey = "popular")` — signature change, backward compatible. Consumed by Task 9's `treemap.js`.

- [ ] **Step 1: Write the failing tests**

Append to `test/layout.test.js`:

```js
test("weightOf reads the sizes object for a given sizeKey when present", () => {
  assert.equal(weightOf({ id: "a", weight: 42, sizes: { popular: 42, rising30: 7.5 } }, "rising30"), 7.5);
});

test("weightOf falls back to weight/1 when sizes lacks the requested key", () => {
  assert.equal(weightOf({ id: "a", weight: 42, sizes: { popular: 42 } }, "rising30"), 42);
  assert.equal(weightOf({ id: "a", sizes: {} }, "rising30"), 1);
});

test("buildHierarchy sums using the given sizeKey's sizes value instead of weight", () => {
  const data = {
    id: "root",
    children: [
      {
        id: "cat",
        children: [
          { id: "a", weight: 10, sizes: { popular: 10, rising30: 2 } },
          { id: "b", weight: 20, sizes: { popular: 20, rising30: 8 } },
        ],
      },
    ],
  };
  const root = buildHierarchy(data, "rising30");
  assert.equal(root.value, 10);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="sizeKey"`
Expected: FAIL — `weightOf`/`buildHierarchy` ignore the second argument (still return popular/weight-based values).

- [ ] **Step 3: Write the implementation**

Replace `app/shared/layout.js:1-17` with:

```js
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";

/**
 * Value accessor used by d3's hierarchy.sum(). Category nodes (nodes with
 * children) contribute nothing of their own — their size comes entirely
 * from their descendants. A leaf contributes its `sizes[sizeKey]` value
 * when present (the precomputed Popular/Rising size for the active mode),
 * falling back to its `weight` (or `1` if that's missing too) — so older
 * data without a `sizes` object, or a `sizeKey` no `sizes` entry exists
 * for, never breaks layout.
 */
export function weightOf(nodeData, sizeKey = "popular") {
  if (nodeData.children && nodeData.children.length > 0) return 0;
  const sizes = nodeData.sizes;
  if (sizes && typeof sizes[sizeKey] === "number") return sizes[sizeKey];
  return typeof nodeData.weight === "number" ? nodeData.weight : 1;
}

/**
 * Wraps the raw JSON tree in a d3 hierarchy with values summed via
 * weightOf for the given `sizeKey` ("popular", "rising7", "rising30", or
 * "rising90").
 */
export function buildHierarchy(rootData, sizeKey = "popular") {
  return hierarchy(rootData, (d) => d.children).sum((d) => weightOf(d, sizeKey));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="layout|weightOf|buildHierarchy|sizeKey"`
Expected: PASS — all existing `layout.test.js` tests still pass (backward compatible defaults), plus the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add app/shared/layout.js test/layout.test.js
git commit -m "feat: parameterize layout sizing by sizeKey"
```

---

### Task 7: Wire sizing into the generator

**Files:**
- Modify: `scripts/generate.mjs:2, 58-61`
- Modify: `test/build-tree.test.js` (regression test only — no production code change needed here)

**Interfaces:**
- Consumes: `computeToolSizing`, `findInvalidSizes` from `scripts/velocity.mjs` (Tasks 1–2).
- Consumes: `buildTree` from `scripts/build-tree.mjs` (unchanged — it already spreads every extra tool field, including `sizes`/`hasEnoughHistory`/`growth`, onto the leaf node, since it does `{ ...leafFields, name: ..., desc: ... }`).

- [ ] **Step 1: Write the failing regression test confirming build-tree already carries the new fields**

Append to `test/build-tree.test.js`:

```js
test("carries arbitrary extra leaf fields (e.g. sizes/hasEnoughHistory/growth) through unchanged", () => {
  const tools = [
    {
      id: "scikit-learn",
      path: ["Classic ML"],
      sizes: { popular: 100, rising7: 0.5, rising30: 1.2, rising90: 2.1 },
      hasEnoughHistory: { rising7: true, rising30: true, rising90: false },
      growth: { rising7: { starDelta: 5, percentDelta: 5, oldestDate: "2026-08-01" } },
    },
  ];
  const tree = buildTree(tools, ROOT);
  const leaf = tree.children[0].children[0];
  assert.deepEqual(leaf.sizes, tools[0].sizes);
  assert.deepEqual(leaf.hasEnoughHistory, tools[0].hasEnoughHistory);
  assert.deepEqual(leaf.growth, tools[0].growth);
});
```

- [ ] **Step 2: Run the test to confirm it already passes**

Run: `npm test -- --test-name-pattern="carries arbitrary extra leaf fields"`
Expected: PASS immediately — `buildTree` already spreads unknown fields through; this test is a regression guard for that behavior, which `generate.mjs`'s new sizing step (below) depends on.

- [ ] **Step 3: Wire history + sizing into `generate.mjs`**

Modify the import line at `scripts/generate.mjs:2`:

```js
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, cpSync, existsSync } from "node:fs";
import { buildTree } from "./build-tree.mjs";
import { renderDomainPage, renderLandingPage } from "./render-page.mjs";
import { computeToolSizing, findInvalidSizes } from "./velocity.mjs";
```

Replace `scripts/generate.mjs:58-61` (the two-line comment plus `buildTree` call):

```js
  const historyPath = `${DATA_DIR}/history/${slug}.json`;
  const toolHistory = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : {};

  const sizedTools = domain.tools.map((tool) => {
    const { sizes, hasEnoughHistory, growth } = computeToolSizing(tool, toolHistory[tool.id] ?? []);
    return { ...tool, sizes, hasEnoughHistory, growth };
  });

  const invalidSizeIds = findInvalidSizes(sizedTools);
  if (invalidSizeIds.length > 0) {
    throw new Error(`${domainPath}: invalid computed size(s) for tool id(s): ${invalidSizeIds.join(", ")}`);
  }

  // Tool `image` values (when present) are already direct URLs into the
  // tool's source repo — set by `enrich-domain.mjs` — so no local
  // resolution or copying is needed here.
  const tree = buildTree(sizedTools, { id: slug, name: domain.name });
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests still pass (no `data/history/*.json` file is required; a domain with none gets `toolHistory = {}`, and every tool falls back to `hasEnoughHistory: false` on every rising window per `computeToolSizing`'s defaults).

- [ ] **Step 5: Manually verify the generator emits sizes**

```bash
node scripts/generate.mjs
grep -o '"rising30":[0-9.]*' dist/data-science/index.html | head -3
```

Expected: at least one `"rising30":<number>` match inside the inlined map-data JSON.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate.mjs test/build-tree.test.js
git commit -m "feat: compute and embed rising sizes at build time"
```

---

### Task 8: Treemap styles for mode bar and insufficient-history tiles

**Files:**
- Modify: `app/shared/treemap.css`

- [ ] **Step 1: Add the new styles**

Insert after the `.treemap-breadcrumb` / `.treemap-crumb-sep` block (after `app/shared/treemap.css:117`, before the `.detail-panel` block):

```css
.treemap-mode-bar {
  max-width: 1000px;
  margin: 12px auto 0;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}

.treemap-mode-button,
.treemap-window-button {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--color-text);
  font: inherit;
}

.treemap-mode-button-active,
.treemap-window-button-active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}

.treemap-window-group {
  display: flex;
  gap: 4px;
  margin-left: 8px;
}

.treemap-box-insufficient-history {
  background-image: repeating-linear-gradient(
    45deg,
    var(--color-border),
    var(--color-border) 4px,
    transparent 4px,
    transparent 8px
  );
  opacity: 0.6;
}
```

Also add growth-line styling right after `.detail-panel-link` (after `app/shared/treemap.css:161`):

```css
.detail-panel-growth {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  margin: 8px 0;
}
```

- [ ] **Step 2: Manually verify**

```bash
npm run dev
```

Open http://localhost:5000/data-science/ and confirm no CSS errors in the browser console (the mode bar/hatch classes aren't in the DOM yet until Task 9 — this step just confirms the stylesheet itself is valid and loads).

- [ ] **Step 3: Commit**

```bash
git add app/shared/treemap.css
git commit -m "feat: add rising-mode toggle and insufficient-history styles"
```

---

### Task 9: Treemap mode toggle and window selector UI

**Files:**
- Modify: `app/shared/treemap.js` (full-file rewrite of the existing `mountTreemap`)

**Interfaces:**
- Consumes: `buildHierarchy(rootData, sizeKey)` from Task 6.
- Produces: `onLeafClick(leafData)` now receives `{ ...node.data, activeSizeKey }`, where `activeSizeKey` is `"popular"`, `"rising7"`, `"rising30"`, or `"rising90"`. Consumed by Task 10's `detail-panel.js`.

- [ ] **Step 1: Replace `app/shared/treemap.js` in full**

```js
import { buildHierarchy, computeLayout, projectRect } from "./layout.js";

const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 600;
// Deliberately duplicated from scripts/velocity.mjs's RISING_WINDOWS_DAYS
// rather than imported: scripts/ is a build-time-only Node directory that
// generate.mjs never copies into dist/, so this browser module can't
// import from it. Keep both lists in sync if a window is ever added.
const RISING_WINDOWS_DAYS = [7, 30, 90];

/**
 * Mounts a treemap for `mapData` into `container`. A leaf's `image`, when
 * present, is already a direct URL into its source repo. `onLeafClick(leafData)`,
 * if given, is called when a leaf box is clicked (categories zoom instead
 * of firing this callback) — `leafData` is the leaf's data plus an
 * `activeSizeKey` field naming the size mode active when it was clicked
 * ("popular", "rising7", "rising30", or "rising90"), so the detail panel
 * can show the right stat.
 */
export function mountTreemap(container, mapData, onLeafClick) {
  let sizeMode = "popular"; // "popular" | "rising"
  let risingWindow = 30;
  let root = computeLayout(buildHierarchy(mapData, activeSizeKey()), STAGE_WIDTH, STAGE_HEIGHT);
  let focusNode = root;
  let focusIdPath = [root.data.id];

  container.innerHTML = "";
  const modeBar = document.createElement("div");
  modeBar.className = "treemap-mode-bar";
  const breadcrumb = document.createElement("div");
  breadcrumb.className = "treemap-breadcrumb";
  const stage = document.createElement("div");
  stage.className = "treemap-stage";
  stage.style.width = `${STAGE_WIDTH}px`;
  stage.style.height = `${STAGE_HEIGHT}px`;
  container.appendChild(modeBar);
  container.appendChild(breadcrumb);
  container.appendChild(stage);

  function activeSizeKey() {
    return sizeMode === "popular" ? "popular" : `rising${risingWindow}`;
  }

  function setSizeMode(nextMode, nextWindow) {
    sizeMode = nextMode;
    risingWindow = nextWindow;
    root = computeLayout(buildHierarchy(mapData, activeSizeKey()), STAGE_WIDTH, STAGE_HEIGHT);
    focusNode = findNodeByIdPath(root, focusIdPath);
    renderModeBar();
    renderBreadcrumb();
    renderLevel();
  }

  function findNodeByIdPath(node, idPath) {
    let current = node;
    for (const id of idPath.slice(1)) {
      const next = current.children?.find((child) => child.data.id === id);
      if (!next) break;
      current = next;
    }
    return current;
  }

  function zoomTo(node) {
    focusNode = node;
    focusIdPath = node.ancestors().reverse().map((ancestor) => ancestor.data.id);
    renderBreadcrumb();
    renderLevel();
  }

  function renderModeBar() {
    modeBar.innerHTML = "";

    modeBar.appendChild(
      renderModeButton("Popular", sizeMode === "popular", () => setSizeMode("popular", risingWindow))
    );
    modeBar.appendChild(
      renderModeButton("Rising", sizeMode === "rising", () => setSizeMode("rising", risingWindow))
    );

    if (sizeMode === "rising") {
      const windowGroup = document.createElement("span");
      windowGroup.className = "treemap-window-group";
      for (const windowDays of RISING_WINDOWS_DAYS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className =
          "treemap-window-button" + (windowDays === risingWindow ? " treemap-window-button-active" : "");
        button.textContent = `${windowDays}d`;
        button.addEventListener("click", () => setSizeMode("rising", windowDays));
        windowGroup.appendChild(button);
      }
      modeBar.appendChild(windowGroup);
    }
  }

  function renderModeButton(label, isActive, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "treemap-mode-button" + (isActive ? " treemap-mode-button-active" : "");
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderBreadcrumb() {
    breadcrumb.innerHTML = "";
    const trail = focusNode.ancestors().reverse(); // root ... focusNode
    trail.forEach((node, index) => {
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.className = "treemap-crumb";
      crumb.textContent = node.data.name;
      crumb.disabled = index === trail.length - 1;
      crumb.addEventListener("click", () => zoomTo(node));
      breadcrumb.appendChild(crumb);
      if (index < trail.length - 1) {
        const sep = document.createElement("span");
        sep.className = "treemap-crumb-sep";
        sep.textContent = " › ";
        breadcrumb.appendChild(sep);
      }
    });
  }

  function renderLevel() {
    stage.innerHTML = "";
    const focusRect = { x0: focusNode.x0, y0: focusNode.y0, x1: focusNode.x1, y1: focusNode.y1 };
    for (const child of focusNode.children ?? []) {
      const rect = projectRect(child, focusRect, STAGE_WIDTH, STAGE_HEIGHT);
      stage.appendChild(renderBox(child, rect));
    }
  }

  function renderBox(node, rect) {
    const key = activeSizeKey();
    const insufficientHistory =
      sizeMode === "rising" && node.data.hasEnoughHistory && node.data.hasEnoughHistory[key] === false;

    const box = document.createElement("div");
    box.className = node.children
      ? "treemap-box treemap-category"
      : "treemap-box treemap-leaf" + (insufficientHistory ? " treemap-box-insufficient-history" : "");
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const label = document.createElement("span");
    label.className = "treemap-label";
    label.textContent = node.data.name;
    box.appendChild(label);

    if (!node.children && node.data.image) {
      const img = document.createElement("img");
      img.className = "treemap-logo";
      img.src = node.data.image;
      img.alt = node.data.name;
      img.onerror = () => img.replaceWith(renderFallbackLogo(node.data.name));
      box.insertBefore(img, label);
    }

    if (node.children) {
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        zoomTo(node);
      });
    } else if (onLeafClick) {
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        onLeafClick({ ...node.data, activeSizeKey: key });
      });
    }

    return box;
  }

  renderModeBar();
  renderBreadcrumb();
  renderLevel();

  return { zoomTo, root };
}

function renderFallbackLogo(name) {
  const fallback = document.createElement("span");
  fallback.className = "treemap-logo-fallback";
  fallback.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return fallback;
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — `treemap.js` has no automated tests today (DOM code, verified manually per this project's existing convention), so this step confirms nothing else broke.

- [ ] **Step 3: Manually verify in the browser**

```bash
npm run dev
```

Open http://localhost:5000/data-science/ and confirm:
- A "Popular"/"Rising" toggle appears above the breadcrumb, "Popular" active by default.
- Clicking "Rising" reveals a 7d/30d/90d selector (30d active by default) and re-sizes the tiles.
- Switching windows re-sizes tiles again without a page reload.
- Zooming into a category, then switching modes, keeps you zoomed into the same category (focus is preserved).
- Tools without 90 days of history (right after Task 4's fixture-seeding, likely all of them) show the diagonal-hatch styling in Rising mode at the 90d window.

- [ ] **Step 4: Commit**

```bash
git add app/shared/treemap.js
git commit -m "feat: add Popular/Rising mode toggle and window selector"
```

---

### Task 10: Detail panel growth stat

**Files:**
- Modify: `app/shared/detail-panel.js`

**Interfaces:**
- Consumes: `leafData.activeSizeKey`, `leafData.growth`, `leafData.hasEnoughHistory` (all set by Task 9's `treemap.js` / Task 7's `generate.mjs`).

- [ ] **Step 1: Replace `app/shared/detail-panel.js` in full**

```js
/**
 * Creates a slide-in detail panel appended to `container`. A leaf's
 * `image`, when present, is already a direct URL into its source repo.
 * `leafData` passed to `open()` may carry an `activeSizeKey` field (set by
 * treemap.js) naming the size mode active when the leaf was clicked; when
 * it's a "rising*" key, a growth-stat line is shown using the leaf's
 * `growth`/`hasEnoughHistory` data for that window. Returns { open(leafData), close() }.
 */
export function createDetailPanel(container) {
  const panel = document.createElement("aside");
  panel.className = "detail-panel";
  container.appendChild(panel);

  function close() {
    panel.classList.remove("detail-panel-open");
    panel.innerHTML = "";
  }

  function open(leafData) {
    panel.innerHTML = "";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "detail-panel-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.addEventListener("click", close);
    panel.appendChild(closeButton);

    if (leafData.image) {
      const img = document.createElement("img");
      img.className = "detail-panel-logo";
      img.src = leafData.image;
      img.alt = leafData.name;
      img.onerror = () => img.remove();
      panel.appendChild(img);
    }

    const title = document.createElement("h2");
    title.textContent = leafData.name;
    panel.appendChild(title);

    const growthLine = renderGrowthLine(leafData);
    if (growthLine) panel.appendChild(growthLine);

    if (leafData.desc) {
      const desc = document.createElement("p");
      desc.textContent = leafData.desc;
      panel.appendChild(desc);
    }

    if (leafData.id) {
      const ghFrame = document.createElement("iframe");
      ghFrame.className = "detail-panel-gh-button";
      ghFrame.src = githubStarButtonUrl(leafData.id);
      ghFrame.width = "170";
      ghFrame.height = "30";
      ghFrame.frameBorder = "0";
      ghFrame.scrolling = "no";
      ghFrame.title = "GitHub Stars";
      panel.appendChild(ghFrame);
    }

    if (leafData.link) {
      const link = document.createElement("a");
      link.className = "detail-panel-link";
      link.href = leafData.link;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Visit site ↗";
      panel.appendChild(link);
    }

    panel.classList.add("detail-panel-open");
  }

  return { open, close };
}

/**
 * Builds the Rising-mode growth line ("+340 stars (+18%) in 30 days", or
 * an insufficient-history notice) for `leafData.activeSizeKey`. Returns
 * `null` for Popular mode (no `activeSizeKey`, or `"popular"`) — there's
 * no growth stat to show there.
 */
function renderGrowthLine(leafData) {
  const key = leafData.activeSizeKey;
  if (!key || key === "popular") return null;

  const paragraph = document.createElement("p");
  paragraph.className = "detail-panel-growth";

  const windowDays = key.replace("rising", "");
  const stats = leafData.growth?.[key];

  if (leafData.hasEnoughHistory?.[key] === false) {
    paragraph.textContent = stats?.oldestDate
      ? `Not enough history yet — first tracked ${stats.oldestDate}.`
      : "Not enough history yet.";
    return paragraph;
  }

  if (!stats) return null;

  const sign = stats.starDelta >= 0 ? "+" : "";
  const percent = Math.round(stats.percentDelta);
  paragraph.textContent = `${sign}${stats.starDelta} stars (${sign}${percent}%) in ${windowDays} days`;
  return paragraph;
}

/**
 * Builds a ghbtns.com star-count button URL from a "owner/repo" shorthand
 * (the `id` field's format). Using the iframe embed (rather than the
 * buttons.github.io script, which only scans the DOM once at page load)
 * works correctly for buttons added dynamically after the page has loaded.
 */
function githubStarButtonUrl(repoShorthand) {
  const [user, repo] = repoShorthand.split("/");
  return `https://ghbtns.com/github-btn.html?user=${user}&repo=${repo}&type=star&count=true`;
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — `detail-panel.js` has no automated tests today (DOM code, same convention as `treemap.js`), so this confirms nothing else broke.

- [ ] **Step 3: Manually verify in the browser**

```bash
npm run dev
```

Open http://localhost:5000/data-science/, switch to Rising mode, click a leaf tile, and confirm the detail panel shows either a growth line ("+N stars (+M%) in 30 days") or, for a tool without enough history, "Not enough history yet — first tracked \<date>." Switch back to Popular mode and click a leaf — confirm no growth line appears.

- [ ] **Step 4: Commit**

```bash
git add app/shared/detail-panel.js
git commit -m "feat: show growth stat in detail panel for Rising mode"
```

---

### Task 11: Document the new data file and fields

**Files:**
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Add a new section**

Add after the existing "Adding a new map" section in `CONTRIBUTING.md`:

```markdown
## Star history & Rising mode

Every domain map has a second sizing mode, "Rising," that sizes tiles by
star-growth velocity (7/30/90-day windows) instead of total star count.
This is entirely generated data — nothing here is hand-authored:

- `data/history/<slug>.json` is a per-tool star-count snapshot log,
  written daily by `.github/workflows/snapshot-history.yml` (running
  `scripts/snapshot-history.mjs`). It's keyed by tool `id`, each value an
  array of `{ date, stars }` entries, pruned to the last 120 days.
- `scripts/generate.mjs` reads that history at build time and computes
  each tool's `sizes` (`popular`, `rising7`, `rising30`, `rising90`),
  `hasEnoughHistory`, and `growth` fields via `scripts/velocity.mjs` —
  these never need to be set by hand in `data/<slug>.json`.
- A brand-new tool (or a brand-new domain) simply has no history yet;
  it renders in Rising mode with a "not enough history" marker until the
  daily snapshot job has run long enough to cover the selected window.
- To manually trigger a snapshot run locally: `node
  scripts/snapshot-history.mjs` (requires `gh auth token`, same as
  `enrich-domain.mjs`).
```

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: document star-history and Rising mode"
```

---

### Task 12: End-to-end verification

**Files:**
- None (verification only).

- [ ] **Step 1: Run the full automated test suite**

```bash
npm test
```

Expected: all tests pass, including the new `velocity.test.js` and `snapshot-history.test.js` files and the extended `layout.test.js`/`build-tree.test.js`.

- [ ] **Step 2: Full local generate + serve**

```bash
npm run generate && npx --yes serve dist -l 5000
```

Confirm every domain's full page (`/data-science/`, `/web-dev/`, etc.) and its `/embed/<slug>/` counterpart both show the Popular/Rising toggle and behave identically (embeds have the same mode bar and window selector, per this feature's scope).

- [ ] **Step 3: Push the branch and dispatch the snapshot workflow manually**

```bash
git push -u origin <branch-name>
gh workflow run snapshot-history.yml --ref <branch-name>
gh run watch
```

Expected: the run succeeds, and `git pull` afterward shows an updated `data/history/*.json` commit pushed by the bot (or "No history changes to commit." in the log if run the same day as Task 4's seed).

- [ ] **Step 4: Confirm `deploy.yml` still builds cleanly**

```bash
BASE_PATH=/awesomemap SITE_URL=https://haggaishachar.github.io node scripts/generate.mjs
```

Expected: exits 0, no thrown errors (this is the exact invocation shape `deploy.yml` uses in CI).
