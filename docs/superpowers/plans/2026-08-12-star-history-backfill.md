# Star History Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-time, resumable CLI script that reconstructs ~120 days
of daily star-count history per tool from GitHub's stargazers API, so
Rising mode has real data instead of the single 2026-08-08 snapshot it has
today.

**Architecture:** A new `scripts/backfill-history.mjs`, built the same way
`scripts/snapshot-history.mjs` is: small pure functions (reconstruction
math, checkpoint bookkeeping, rate-limit timing, pagination walk) unit
tested in isolation, composed by a thin, untested `main()` that does the
actual file/network I/O. All four pure/testable pieces land in this one
file, built up task by task.

**Tech Stack:** Node.js (`node --test`), no new dependencies. Reuses
`parseGhRepo`/`createGetJson`/`withRetry`/`defaultIsRetryable` from
`scripts/enrich-domain.mjs` and `appendSnapshotEntry`/`pruneOldEntries`
from `scripts/snapshot-history.mjs` — do not duplicate any of these.

## Global Constraints

- Retention window: 120 days (matches `MAX_AGE_DAYS` in
  `snapshot-history.mjs`).
- No cap on pages walked per tool — rate-limit handling (not a page cap)
  is what keeps this safe for high-star-velocity repos.
- Rate-limit buffer: sleep until `X-RateLimit-Reset` when
  `X-RateLimit-Remaining` drops below 50, and treat a 403 with
  `X-RateLimit-Remaining: 0` as retryable (sleep, then retry) rather than
  a normal failure.
- Checkpoint file path: `data/history/.backfill-checkpoint.json`, git-ignored.
- Stargazers pagination: `per_page=100`, `Accept: application/vnd.github.star+json`.
- This script is invoked manually (`node scripts/backfill-history.mjs`) and
  is **not** added to any GitHub Actions workflow.

---

### Task 1: Reconstruct daily history from star events

**Files:**
- Create: `scripts/backfill-history.mjs`
- Test: `test/backfill-history.test.js`

**Interfaces:**
- Produces: `reconstructDailyHistory(starEvents, currentStars, { now = new Date(), retentionDays = 120 } = {})` → `Array<{ date: string, stars: number }>`, one entry per calendar day from `today - retentionDays` days to today (inclusive), sorted ascending by date. `starEvents` is `Array<{ starred_at: string }>` (ISO 8601 timestamps, any order).

- [ ] **Step 1: Write the failing tests**

Create `test/backfill-history.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructDailyHistory } from "../scripts/backfill-history.mjs";

test("reconstructDailyHistory computes the star count at the end of each day from currentStars minus later events", () => {
  const currentStars = 10;
  const starEvents = [
    { starred_at: "2026-08-09T12:00:00.000Z" },
    { starred_at: "2026-08-10T08:00:00.000Z" },
    { starred_at: "2026-08-11T20:00:00.000Z" },
  ];

  const result = reconstructDailyHistory(starEvents, currentStars, {
    now: "2026-08-12T00:00:00.000Z",
    retentionDays: 3,
  });

  assert.deepEqual(result, [
    { date: "2026-08-09", stars: 8 }, // 2 events strictly after this day (08-10, 08-11)
    { date: "2026-08-10", stars: 9 }, // 1 event strictly after this day (08-11)
    { date: "2026-08-11", stars: 10 }, // 0 events strictly after this day
    { date: "2026-08-12", stars: 10 },
  ]);
});

test("reconstructDailyHistory returns a flat count across every day when there are no recent star events", () => {
  const result = reconstructDailyHistory([], 5, {
    now: "2026-08-12T00:00:00.000Z",
    retentionDays: 2,
  });

  assert.deepEqual(result, [
    { date: "2026-08-10", stars: 5 },
    { date: "2026-08-11", stars: 5 },
    { date: "2026-08-12", stars: 5 },
  ]);
});

test("reconstructDailyHistory's earliest entry is exactly retentionDays before now", () => {
  const result = reconstructDailyHistory([], 1, {
    now: "2026-08-12T00:00:00.000Z",
    retentionDays: 1,
  });

  assert.deepEqual(result, [
    { date: "2026-08-11", stars: 1 },
    { date: "2026-08-12", stars: 1 },
  ]);
});

test("reconstructDailyHistory correctly shows 0 stars for days before a young repo's first star, with no special-casing needed", () => {
  const currentStars = 3;
  const starEvents = [
    { starred_at: "2026-08-11T01:00:00.000Z" },
    { starred_at: "2026-08-11T05:00:00.000Z" },
    { starred_at: "2026-08-11T09:00:00.000Z" },
  ];

  const result = reconstructDailyHistory(starEvents, currentStars, {
    now: "2026-08-12T00:00:00.000Z",
    retentionDays: 5,
  });

  assert.deepEqual(result, [
    { date: "2026-08-07", stars: 0 },
    { date: "2026-08-08", stars: 0 },
    { date: "2026-08-09", stars: 0 },
    { date: "2026-08-10", stars: 0 },
    { date: "2026-08-11", stars: 3 }, // all 3 events happened during this day, not after it
    { date: "2026-08-12", stars: 3 },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/backfill-history.test.js`
Expected: FAIL — `scripts/backfill-history.mjs` doesn't exist yet (or `reconstructDailyHistory` is not exported).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/backfill-history.mjs` with:

```js
import { MS_PER_DAY } from "./velocity.mjs";

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Reconstructs one `{date, stars}` entry per calendar day from
 * `today - retentionDays` days to today (inclusive) out of a repo's
 * current star count plus the trailing window of star events collected by
 * `fetchTrailingStarEvents`. For any day `d` in that range,
 * `stars_at_end_of_day(d) = currentStars - count(events with starred_at
 * strictly after the end of day d)` — exact as long as `starEvents`
 * includes every star gained since `d` (true for any `d` at or after the
 * cutoff the caller walked back to). Days before a repo's first star
 * naturally compute to 0 with no special-casing, since every collected
 * event counts as "after" that day.
 */
export function reconstructDailyHistory(starEvents, currentStars, { now = new Date(), retentionDays = 120 } = {}) {
  const nowMs = new Date(now).getTime();
  const todayMs = new Date(isoDate(nowMs)).getTime();
  const cutoffMs = todayMs - retentionDays * MS_PER_DAY;

  const eventTimesMs = starEvents.map((event) => new Date(event.starred_at).getTime());

  const entries = [];
  for (let dayMs = cutoffMs; dayMs <= todayMs; dayMs += MS_PER_DAY) {
    const endOfDayMs = dayMs + MS_PER_DAY - 1;
    const eventsAfter = eventTimesMs.filter((eventMs) => eventMs > endOfDayMs).length;
    entries.push({ date: isoDate(dayMs), stars: currentStars - eventsAfter });
  }
  return entries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/backfill-history.test.js`
Expected: PASS (4/4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-history.mjs test/backfill-history.test.js
git commit -m "feat: add reconstructDailyHistory for star history backfill

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Checkpoint bookkeeping

**Files:**
- Modify: `scripts/backfill-history.mjs`
- Modify: `test/backfill-history.test.js`

**Interfaces:**
- Consumes: none beyond Task 1 (no new imports needed).
- Produces: `isToolComplete(checkpoint, toolId)` → `boolean`;
  `withCompletedTool(checkpoint, toolId)` → new checkpoint object. Both
  operate on a plain `{ completedToolIds: string[] }` object — I/O (reading
  and writing that object to/from `data/history/.backfill-checkpoint.json`)
  is added later in Task 5's `main()`, not here.

- [ ] **Step 1: Write the failing tests**

Append to `test/backfill-history.test.js`:

```js
import { isToolComplete, withCompletedTool } from "../scripts/backfill-history.mjs";

test("isToolComplete is false for a tool not yet in the checkpoint", () => {
  const checkpoint = { completedToolIds: ["facebook/react"] };
  assert.equal(isToolComplete(checkpoint, "vuejs/vue"), false);
});

test("isToolComplete is true for a tool already in the checkpoint", () => {
  const checkpoint = { completedToolIds: ["facebook/react"] };
  assert.equal(isToolComplete(checkpoint, "facebook/react"), true);
});

test("withCompletedTool adds a tool id to the checkpoint", () => {
  const checkpoint = { completedToolIds: ["facebook/react"] };
  const result = withCompletedTool(checkpoint, "vuejs/vue");
  assert.deepEqual(result, { completedToolIds: ["facebook/react", "vuejs/vue"] });
});

test("withCompletedTool is a no-op when the tool id is already present", () => {
  const checkpoint = { completedToolIds: ["facebook/react"] };
  const result = withCompletedTool(checkpoint, "facebook/react");
  assert.deepEqual(result, checkpoint);
});
```

(Update the existing `import { reconstructDailyHistory } from "../scripts/backfill-history.mjs";` line at the top of the file into one combined import instead of adding a second import line: `import { reconstructDailyHistory, isToolComplete, withCompletedTool } from "../scripts/backfill-history.mjs";`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/backfill-history.test.js`
Expected: FAIL — `isToolComplete`/`withCompletedTool` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/backfill-history.mjs`:

```js
/**
 * A tool counts as "complete" once a previous run's backward walk reached
 * either the retention cutoff or page 1 of its stargazers list (see
 * fetchTrailingStarEvents) and its history was written. Tracked by tool
 * id in a checkpoint file rather than inferred from the history file's
 * oldest date, since a repo younger than the retention window would
 * otherwise never look "done."
 */
export function isToolComplete(checkpoint, toolId) {
  return checkpoint.completedToolIds.includes(toolId);
}

export function withCompletedTool(checkpoint, toolId) {
  if (checkpoint.completedToolIds.includes(toolId)) return checkpoint;
  return { completedToolIds: [...checkpoint.completedToolIds, toolId] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/backfill-history.test.js`
Expected: PASS (8/8 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-history.mjs test/backfill-history.test.js
git commit -m "feat: add checkpoint bookkeeping for star history backfill

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Rate-limit-aware getJson

**Files:**
- Modify: `scripts/backfill-history.mjs`
- Modify: `test/backfill-history.test.js`

**Interfaces:**
- Consumes: `withRetry` from `./enrich-domain.mjs` (the same export `enrich-domain.mjs`'s own `createGetJson` uses; its default `isRetryable` — `defaultIsRetryable`, network errors and 5xx — is used unchanged, so it doesn't need importing separately here).
- Produces: `msUntilReset(resetAtEpochSeconds, { now = Date.now() } = {})` → `number` (milliseconds, always ≥ 1000); `createRateLimitAwareGetJson(token, { fetchImpl = fetch, sleep, now = () => Date.now(), rateLimitBuffer = 50 } = {})` → `(url: string) => Promise<any>`, a `getJson`-shaped function sending `Accept: application/vnd.github.star+json`.

- [ ] **Step 1: Write the failing tests**

Append to `test/backfill-history.test.js` (update the top import line again to add `msUntilReset, createRateLimitAwareGetJson`):

```js
import { /* ...existing names, */ msUntilReset, createRateLimitAwareGetJson } from "../scripts/backfill-history.mjs";

test("msUntilReset returns the time until the reset timestamp plus a 1s safety margin", () => {
  // resetAt = 1000 (epoch seconds) = 1,000,000 ms; now = 500,000 ms
  assert.equal(msUntilReset(1000, { now: 500_000 }), 501_000);
});

test("msUntilReset never returns negative — floors at 0 plus the safety margin", () => {
  // resetAt already in the past relative to now
  assert.equal(msUntilReset(100, { now: 500_000 }), 1000);
});

function fakeHeaders(values) {
  return { get: (name) => values[name.toLowerCase()] ?? null };
}

function fakeRateLimitFetchSequence(outcomes) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url) => {
    const outcome = outcomes[Math.min(i, outcomes.length - 1)];
    i += 1;
    calls.push(url);
    return {
      ok: outcome.status < 400,
      status: outcome.status,
      statusText: outcome.statusText ?? "",
      headers: fakeHeaders(outcome.headers ?? {}),
      json: async () => outcome.body,
    };
  };
  return { fetchImpl, calls };
}

test("createRateLimitAwareGetJson sleeps until reset and retries when 403'd with remaining=0", async () => {
  const { fetchImpl, calls } = fakeRateLimitFetchSequence([
    { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000" } },
    { status: 200, body: [{ starred_at: "2026-08-11T00:00:00Z" }], headers: { "x-ratelimit-remaining": "200", "x-ratelimit-reset": "2000" } },
  ]);
  const sleeps = [];
  const getJson = createRateLimitAwareGetJson("fake-token", {
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
    now: () => 500_000,
  });

  const result = await getJson("https://api.github.com/repos/facebook/react/stargazers?page=3");

  assert.deepEqual(result, [{ starred_at: "2026-08-11T00:00:00Z" }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [501_000]); // msUntilReset(1000, { now: 500_000 })
});

test("createRateLimitAwareGetJson proactively sleeps after a successful response with low remaining budget", async () => {
  const { fetchImpl } = fakeRateLimitFetchSequence([
    { status: 200, body: [], headers: { "x-ratelimit-remaining": "10", "x-ratelimit-reset": "1000" } },
  ]);
  const sleeps = [];
  const getJson = createRateLimitAwareGetJson("fake-token", {
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
    now: () => 500_000,
    rateLimitBuffer: 50,
  });

  const result = await getJson("https://api.github.com/repos/facebook/react/stargazers?page=1");

  assert.deepEqual(result, []);
  assert.deepEqual(sleeps, [501_000]);
});

test("createRateLimitAwareGetJson does not sleep when remaining is comfortably above the buffer", async () => {
  const { fetchImpl } = fakeRateLimitFetchSequence([
    { status: 200, body: [], headers: { "x-ratelimit-remaining": "500", "x-ratelimit-reset": "1000" } },
  ]);
  const sleeps = [];
  const getJson = createRateLimitAwareGetJson("fake-token", {
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
    now: () => 500_000,
    rateLimitBuffer: 50,
  });

  await getJson("https://api.github.com/repos/facebook/react/stargazers?page=1");

  assert.deepEqual(sleeps, []);
});

test("createRateLimitAwareGetJson does not retry a persistent non-rate-limit 404", async () => {
  const { fetchImpl, calls } = fakeRateLimitFetchSequence([
    { status: 404, statusText: "Not Found", headers: { "x-ratelimit-remaining": "500", "x-ratelimit-reset": "1000" } },
  ]);
  const getJson = createRateLimitAwareGetJson("fake-token", {
    fetchImpl,
    sleep: async () => {},
    now: () => 500_000,
  });

  await assert.rejects(
    () => getJson("https://api.github.com/repos/facebook/react/stargazers?page=99"),
    (err) => err.status === 404,
  );
  assert.equal(calls.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/backfill-history.test.js`
Expected: FAIL — `msUntilReset`/`createRateLimitAwareGetJson` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/backfill-history.mjs` (also add `import { withRetry } from "./enrich-domain.mjs";` to the top import block):

```js
/** Milliseconds to wait before `resetAtEpochSeconds`, plus a 1s safety margin. Never negative. */
export function msUntilReset(resetAtEpochSeconds, { now = Date.now() } = {}) {
  return Math.max(0, resetAtEpochSeconds * 1000 - now) + 1000;
}

/**
 * Builds a GitHub API getJson for the stargazers walk: layers GitHub
 * rate-limit handling on top of the same retry machinery createGetJson
 * (enrich-domain.mjs) uses for network errors and 5xx. A 403 response
 * with X-RateLimit-Remaining: 0 is handled by sleeping until
 * X-RateLimit-Reset and then retrying the same request in an internal
 * loop — deliberately *not* by throwing into withRetry, since withRetry's
 * own backoff sleep would otherwise stack on top of the reset sleep. After
 * every successful response, if remaining budget has dropped below
 * `rateLimitBuffer`, this also sleeps until reset before returning, so a
 * long backward walk paces itself instead of bursting into the limit.
 * withRetry still wraps this for its original purpose — network errors
 * and 5xx — via the default `defaultIsRetryable`.
 */
export function createRateLimitAwareGetJson(
  token,
  { fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(), rateLimitBuffer = 50 } = {},
) {
  const rawGetJson = async (url) => {
    for (;;) {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.star+json" },
      });
      const remaining = Number(res.headers.get("x-ratelimit-remaining"));
      const resetAt = Number(res.headers.get("x-ratelimit-reset"));

      if (!res.ok) {
        if (res.status === 403 && remaining === 0) {
          await sleep(msUntilReset(resetAt, { now: now() }));
          continue; // retry the same request now that the window has reset
        }
        const err = new Error(`${res.status} ${res.statusText} for ${url}`);
        err.status = res.status;
        throw err;
      }

      const body = await res.json();
      if (Number.isFinite(remaining) && Number.isFinite(resetAt) && remaining < rateLimitBuffer) {
        await sleep(msUntilReset(resetAt, { now: now() }));
      }
      return body;
    }
  };

  return (url) => withRetry(() => rawGetJson(url), { sleep });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/backfill-history.test.js`
Expected: PASS (13/13 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-history.mjs test/backfill-history.test.js
git commit -m "feat: add rate-limit-aware getJson for star history backfill

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Walk the stargazers list backward

**Files:**
- Modify: `scripts/backfill-history.mjs`
- Modify: `test/backfill-history.test.js`

**Interfaces:**
- Consumes: a `getJson`-shaped function (matches `createRateLimitAwareGetJson`'s return type from Task 3, but any `(url) => Promise<Array<{starred_at: string}>>` works — tests inject a fake).
- Produces: `fetchTrailingStarEvents(getJson, owner, repo, { stargazersCount, cutoffDate, perPage = 100 })` → `Promise<Array<{ starred_at: string }>>`.

- [ ] **Step 1: Write the failing tests**

Append to `test/backfill-history.test.js` (add `fetchTrailingStarEvents` to the top import):

```js
function fakeStargazerPages(pagesByNumber) {
  const calls = [];
  const getJson = async (url) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    return pagesByNumber[page] ?? [];
  };
  return { getJson, calls };
}

test("fetchTrailingStarEvents walks backward from the last page and stops once the cutoff is reached", async () => {
  const pages = {
    1: [{ starred_at: "2026-01-01T00:00:00Z" }, { starred_at: "2026-01-02T00:00:00Z" }],
    2: [{ starred_at: "2026-06-01T00:00:00Z" }, { starred_at: "2026-06-02T00:00:00Z" }],
    3: [{ starred_at: "2026-08-11T00:00:00Z" }],
  };
  const { getJson, calls } = fakeStargazerPages(pages);

  const events = await fetchTrailingStarEvents(getJson, "facebook", "react", {
    stargazersCount: 5,
    cutoffDate: "2026-06-01T00:00:00Z",
    perPage: 2,
  });

  assert.deepEqual(events, [...pages[3], ...pages[2]]);
  assert.equal(calls.length, 2); // page 3, then page 2 — page 1 never fetched
  assert.ok(calls[0].includes("page=3"));
  assert.ok(calls[1].includes("page=2"));
});

test("fetchTrailingStarEvents walks all the way to page 1 when the cutoff is never reached (young repo)", async () => {
  const pages = {
    1: [{ starred_at: "2026-07-01T00:00:00Z" }, { starred_at: "2026-07-02T00:00:00Z" }],
    2: [{ starred_at: "2026-08-01T00:00:00Z" }],
  };
  const { getJson, calls } = fakeStargazerPages(pages);

  const events = await fetchTrailingStarEvents(getJson, "facebook", "react", {
    stargazersCount: 3,
    cutoffDate: "2020-01-01T00:00:00Z",
    perPage: 2,
  });

  assert.deepEqual(events, [...pages[2], ...pages[1]]);
  assert.equal(calls.length, 2);
});

test("fetchTrailingStarEvents returns an empty array without calling getJson for a repo with zero stars", async () => {
  const { getJson, calls } = fakeStargazerPages({});

  const events = await fetchTrailingStarEvents(getJson, "facebook", "react", {
    stargazersCount: 0,
    cutoffDate: "2026-06-01T00:00:00Z",
  });

  assert.deepEqual(events, []);
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/backfill-history.test.js`
Expected: FAIL — `fetchTrailingStarEvents` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/backfill-history.mjs`:

```js
/**
 * Walks a repo's stargazers list (ascending by starred_at, oldest first)
 * backward from its last page, collecting every star event down to (and
 * including) the page that first reaches `cutoffDate`, or all the way to
 * page 1 if the repo has fewer stars than that. No cap on pages walked —
 * rate-limit handling in `getJson` (see createRateLimitAwareGetJson) is
 * what keeps a high-star-velocity repo safe, not a page limit here.
 */
export async function fetchTrailingStarEvents(getJson, owner, repo, { stargazersCount, cutoffDate, perPage = 100 }) {
  if (stargazersCount <= 0) return [];

  const totalPages = Math.ceil(stargazersCount / perPage);
  const cutoffMs = new Date(cutoffDate).getTime();
  const events = [];

  for (let page = totalPages; page >= 1; page -= 1) {
    const pageEvents = await getJson(
      `https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=${perPage}&page=${page}`,
    );
    events.push(...pageEvents);
    const oldestOnPage = pageEvents[0];
    if (!oldestOnPage || new Date(oldestOnPage.starred_at).getTime() <= cutoffMs) break;
  }

  return events;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/backfill-history.test.js`
Expected: PASS (16/16 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-history.mjs test/backfill-history.test.js
git commit -m "feat: add backward stargazers pagination walk for history backfill

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire up the CLI, checkpoint file I/O, and .gitignore

**Files:**
- Modify: `scripts/backfill-history.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `reconstructDailyHistory`, `isToolComplete`, `withCompletedTool`, `createRateLimitAwareGetJson`, `fetchTrailingStarEvents` (all from this same file, Tasks 1–4); `parseGhRepo`, `createGetJson` from `./enrich-domain.mjs`; `appendSnapshotEntry`, `pruneOldEntries` from `./snapshot-history.mjs`; `MS_PER_DAY` from `./velocity.mjs`.
- Produces: the `main()` CLI entry point. Not unit tested — thin I/O
  orchestration, same convention as `snapshot-history.mjs`'s and
  `enrich-domain.mjs`'s `main()` — verified manually in Task 6.

This task has no test-first cycle (it's the untested orchestration layer,
per the established convention in this codebase). Write it directly, then
verify by inspection and a dry-run-style manual check in Task 6.

- [ ] **Step 1: Add the checkpoint file to `.gitignore`**

Append one line to `.gitignore`:

```
data/history/.backfill-checkpoint.json
```

- [ ] **Step 2: Add checkpoint I/O and `main()` to `scripts/backfill-history.mjs`**

Add these imports to the top of `scripts/backfill-history.mjs`: two new
import lines, plus `parseGhRepo` and `createGetJson` added to the existing
`from "./enrich-domain.mjs"` import line from Task 3 (which already
imports `withRetry` from there — extend that line rather than adding a
second one):

```js
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseGhRepo, createGetJson, withRetry } from "./enrich-domain.mjs";
import { appendSnapshotEntry, pruneOldEntries } from "./snapshot-history.mjs";
```

Append to the end of `scripts/backfill-history.mjs`:

```js
const DATA_DIR = "data";
const HISTORY_DIR = "data/history";
const CHECKPOINT_PATH = `${HISTORY_DIR}/.backfill-checkpoint.json`;
const RETENTION_DAYS = 120;
const PER_PAGE = 100;

function loadCheckpoint() {
  return existsSync(CHECKPOINT_PATH) ? JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8")) : { completedToolIds: [] };
}

function saveCheckpoint(checkpoint) {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2) + "\n");
}

// CLI entry point: node scripts/backfill-history.mjs
// One-time, resumable backfill of data/history/<slug>.json from the
// GitHub stargazers API, across every tool in every data/<slug>.json. Not
// part of any scheduled workflow — run manually once. Safe to interrupt
// and rerun: already-completed tools are skipped via the checkpoint file.
// Thin I/O orchestration, not unit tested (same convention as
// generate.mjs / enrich-domain.mjs / snapshot-history.mjs's main()) —
// verified manually in Task 6.
async function main() {
  const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const repoInfoGetJson = createGetJson(token);
  const stargazersGetJson = createRateLimitAwareGetJson(token);

  const domainFiles = readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"));

  let toolsAttempted = 0;
  let toolsBackfilled = 0;
  let toolsSkipped = 0;

  for (const file of domainFiles) {
    const domain = JSON.parse(readFileSync(`${DATA_DIR}/${file}`, "utf8"));
    const historyPath = `${HISTORY_DIR}/${domain.slug}.json`;
    const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : {};
    let checkpoint = loadCheckpoint();

    let backfilled = 0;
    let skipped = 0;
    let failed = 0;

    for (const tool of domain.tools) {
      const repo = parseGhRepo(tool.id);
      if (!repo) continue;
      toolsAttempted += 1;

      if (isToolComplete(checkpoint, tool.id)) {
        skipped += 1;
        toolsSkipped += 1;
        continue;
      }

      try {
        const repoData = await repoInfoGetJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
        const currentStars = repoData.stargazers_count;
        const now = new Date();
        const cutoffDate = new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY).toISOString();

        const starEvents = await fetchTrailingStarEvents(stargazersGetJson, repo.owner, repo.repo, {
          stargazersCount: currentStars,
          cutoffDate,
          perPage: PER_PAGE,
        });

        const reconstructed = reconstructDailyHistory(starEvents, currentStars, { now, retentionDays: RETENTION_DAYS });
        const existing = history[tool.id] ?? [];
        const merged = reconstructed.reduce((entries, snapshot) => appendSnapshotEntry(entries, snapshot), existing);
        history[tool.id] = pruneOldEntries(merged, { now, maxAgeDays: RETENTION_DAYS });

        checkpoint = withCompletedTool(checkpoint, tool.id);
        writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
        saveCheckpoint(checkpoint);

        backfilled += 1;
        toolsBackfilled += 1;
      } catch (err) {
        failed += 1;
        console.error(`Warning: failed to backfill "${tool.id}": ${err.message}`);
      }
    }

    console.log(`${historyPath}: ${backfilled} backfilled, ${skipped} already complete, ${failed} failed`);
  }

  if (toolsAttempted > 0 && toolsBackfilled === 0 && toolsSkipped === 0) {
    console.error(
      `Error: 0/${toolsAttempted} tool(s) were successfully backfilled or already marked complete — ` +
        "this looks like a systemic failure (e.g. an invalid/expired token or a GitHub outage), not isolated per-tool flakiness.",
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS, all existing suites plus all 16 `backfill-history.test.js` tests green.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-history.mjs .gitignore
git commit -m "feat: wire up backfill-history.mjs CLI entry point

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Manual verification against one real domain

**Files:** none (verification only)

- [ ] **Step 1: Back up one domain's history file**

```bash
cp data/history/mobile-dev.json /tmp/mobile-dev-history-backup.json
```

- [ ] **Step 2: Temporarily point the script at just that one domain**

The script reads every file in `data/`, so for a quick single-domain check,
run it against a scratch copy of just `mobile-dev.json`:

```bash
mkdir -p /tmp/backfill-check/data
cp data/mobile-dev.json /tmp/backfill-check/data/
mkdir -p /tmp/backfill-check/data/history
cd /tmp/backfill-check && node /home/haggai/workspace/techmap/scripts/backfill-history.mjs
```

(This runs the real script against real GitHub API data for the ~46
mobile-dev tools — expect it to take a few minutes given the stargazers
walk, and to print one `backfilled`/`already complete`/`failed` summary
line.)

- [ ] **Step 3: Inspect the result**

```bash
node -e "
const h = require('/tmp/backfill-check/data/history/mobile-dev.json');
const sample = Object.entries(h)[0];
console.log(sample[0], '->', sample[1].length, 'entries');
console.log(sample[1].slice(0, 3));
"
```

Expected: more than one entry per tool (up to ~120, fewer for
lower-velocity or younger repos), spanning distinct dates.

- [ ] **Step 4: Confirm Rising mode picks it up**

```bash
cd /home/haggai/workspace/techmap
node -e "
import('./scripts/velocity.mjs').then(({ computeVelocity }) => {
  const h = JSON.parse(require('fs').readFileSync('/tmp/backfill-check/data/history/mobile-dev.json', 'utf8'));
  const [id, entries] = Object.entries(h)[0];
  console.log(id, computeVelocity(entries, 30));
});
"
```

Expected: `hasEnoughHistory: true` for the 30-day window (and 90-day, if
the repo is old enough) — the entire point of this backfill.

- [ ] **Step 5: Clean up the scratch directory**

```bash
rm -rf /tmp/backfill-check /tmp/mobile-dev-history-backup.json
```

No commit for this task — it's a dry run against a scratch copy, not the
real `data/history/*.json`. The actual full backfill run (all 5 domains,
241 tools) is a separate, deliberate one-time operation the user runs
themselves once this plan's code is merged — see the spec's Deployment
section.
