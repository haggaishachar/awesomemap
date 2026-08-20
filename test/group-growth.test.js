import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGroupGrowth, rankGroups } from "../scripts/group-growth.mjs";

const NOW = "2026-08-08T00:00:00.000Z";

/** Builds a 7-day-spanning history for a project that went `from` -> `to` stars. */
function history(from, to) {
  return [
    { date: "2026-08-01", stars: from },
    { date: "2026-08-08", stars: to },
  ];
}

test("computeGroupGrowth reports no history for an empty group", () => {
  const result = computeGroupGrowth([], {}, 7, { now: NOW });
  assert.equal(result.hasEnoughHistory, false);
  assert.equal(result.projectCount, 0);
  assert.equal(result.trackedCount, 0);
  assert.equal(result.starDelta, 0);
  assert.equal(result.percentDelta, 0);
  assert.equal(result.oldestDate, null);
});

test("computeGroupGrowth reports no history when every project is untracked", () => {
  const projects = [
    { id: "a/a", weight: 100 },
    { id: "b/b", weight: 200 },
  ];
  const result = computeGroupGrowth(projects, {}, 7, { now: NOW });
  assert.equal(result.hasEnoughHistory, false);
  assert.equal(result.projectCount, 2);
  assert.equal(result.trackedCount, 0);
  assert.equal(result.starDelta, 0);
});

test("computeGroupGrowth sums star deltas and derives the ratio at group level", () => {
  const projects = [
    { id: "a/a", weight: 1100 },
    { id: "b/b", weight: 2200 },
  ];
  const historyById = {
    "a/a": history(1000, 1100),
    "b/b": history(2000, 2200),
  };
  const result = computeGroupGrowth(projects, historyById, 7, { now: NOW });

  assert.equal(result.trackedCount, 2);
  assert.equal(result.totalStars, 3300);
  assert.equal(result.baselineStars, 3000);
  assert.equal(result.starDelta, 300);
  assert.equal(result.percentDelta, 10);
  assert.equal(result.hasEnoughHistory, true);
});

test("computeGroupGrowth excludes untracked projects from BOTH totals, so coverage gaps never manufacture growth", () => {
  // b/b has no history. If its 5,000 stars leaked into totalStars but not
  // baselineStars, the group would report +5,100 stars of fictional growth.
  const projects = [
    { id: "a/a", weight: 1100 },
    { id: "b/b", weight: 5000 },
  ];
  const historyById = { "a/a": history(1000, 1100) };
  const result = computeGroupGrowth(projects, historyById, 7, { now: NOW });

  assert.equal(result.projectCount, 2);
  assert.equal(result.trackedCount, 1, "coverage is exposed rather than hidden");
  assert.equal(result.totalStars, 1100, "untracked stars stay out of the total");
  assert.equal(result.baselineStars, 1000);
  assert.equal(result.starDelta, 100);
  assert.equal(result.percentDelta, 10);
});

test("computeGroupGrowth is a group-level ratio, not an average of per-project percentages", () => {
  // The tiny project tripled (+200%); the large one moved +1%. An average of
  // per-project percentages would report ~100% growth for the group. The
  // honest group figure is 1,020 / 100,020 -> ~1.02%.
  const projects = [
    { id: "tiny/tiny", weight: 30 },
    { id: "big/big", weight: 101000 },
  ];
  const historyById = {
    "tiny/tiny": history(10, 30),
    "big/big": history(100000, 101000),
  };
  const result = computeGroupGrowth(projects, historyById, 7, { now: NOW });

  assert.equal(result.starDelta, 1020);
  assert.equal(result.baselineStars, 100010);
  assert.ok(result.percentDelta < 2, `expected a group ratio near 1%, got ${result.percentDelta}`);
});

test("computeGroupGrowth reports a negative percent for a declining group", () => {
  const projects = [{ id: "a/a", weight: 900 }];
  const historyById = { "a/a": history(1000, 900) };
  const result = computeGroupGrowth(projects, historyById, 7, { now: NOW });

  assert.equal(result.starDelta, -100);
  assert.equal(result.percentDelta, -10);
  assert.equal(result.hasEnoughHistory, true);
});

test("computeGroupGrowth treats a zero-star baseline as 0% rather than dividing by zero", () => {
  const projects = [{ id: "a/a", weight: 10 }];
  const historyById = { "a/a": history(0, 10) };
  const result = computeGroupGrowth(projects, historyById, 7, { now: NOW });

  assert.equal(result.starDelta, 10);
  assert.equal(result.baselineStars, 0);
  assert.equal(result.percentDelta, 0);
  assert.ok(Number.isFinite(result.percentDelta));
});

test("computeGroupGrowth ignores a window longer than the available history", () => {
  const projects = [{ id: "a/a", weight: 1100 }];
  const historyById = { "a/a": history(1000, 1100) };

  const result30 = computeGroupGrowth(projects, historyById, 30, { now: NOW });
  assert.equal(result30.hasEnoughHistory, false);
  assert.equal(result30.trackedCount, 0);

  const result7 = computeGroupGrowth(projects, historyById, 7, { now: NOW });
  assert.equal(result7.hasEnoughHistory, true);
});

test("computeGroupGrowth reports the earliest snapshot across the group as oldestDate, even when the window is insufficient", () => {
  const projects = [
    { id: "a/a", weight: 100 },
    { id: "b/b", weight: 200 },
  ];
  const historyById = {
    "a/a": [{ date: "2026-08-05", stars: 100 }],
    "b/b": [{ date: "2026-08-03", stars: 200 }],
  };
  const result = computeGroupGrowth(projects, historyById, 30, { now: NOW });

  assert.equal(result.hasEnoughHistory, false);
  assert.equal(result.oldestDate, "2026-08-03", "so the UI can say when tracking started");
});

test("computeGroupGrowth falls back to project.weight when a tracked project's history lacks a latest entry", () => {
  const projects = [{ id: "a/a", weight: 1100 }];
  const historyById = { "a/a": history(1000, 1100) };
  const withHistory = computeGroupGrowth(projects, historyById, 7, { now: NOW });
  assert.equal(withHistory.totalStars, 1100);

  // A project with no weight and no history contributes nothing rather than NaN.
  const result = computeGroupGrowth([{ id: "b/b" }], {}, 7, { now: NOW });
  assert.equal(result.totalStars, 0);
  assert.ok(Number.isFinite(result.starDelta));
});

test("rankGroups orders by percent growth descending and assigns 1-based ranks", () => {
  const groups = [
    { key: "slow", growth: { percentDelta: 0.3, hasEnoughHistory: true } },
    { key: "fast", growth: { percentDelta: 2.5, hasEnoughHistory: true } },
    { key: "mid", growth: { percentDelta: 1.1, hasEnoughHistory: true } },
  ];
  const ranked = rankGroups(groups);
  assert.deepEqual(
    ranked.map((g) => g.key),
    ["fast", "mid", "slow"],
  );
  assert.deepEqual(
    ranked.map((g) => g.rank),
    [1, 2, 3],
  );
});

test("rankGroups sorts untracked groups last regardless of their zeroed percent", () => {
  const groups = [
    { key: "untracked", growth: { percentDelta: 0, hasEnoughHistory: false } },
    { key: "declining", growth: { percentDelta: -5, hasEnoughHistory: true } },
    { key: "growing", growth: { percentDelta: 1, hasEnoughHistory: true } },
  ];
  const ranked = rankGroups(groups);
  assert.deepEqual(
    ranked.map((g) => g.key),
    ["growing", "declining", "untracked"],
    "a domain with no data must not outrank a domain that genuinely shrank",
  );
});

test("rankGroups breaks ties on key so the build output is deterministic", () => {
  const groups = [
    { key: "b", growth: { percentDelta: 1, hasEnoughHistory: true } },
    { key: "a", growth: { percentDelta: 1, hasEnoughHistory: true } },
  ];
  assert.deepEqual(
    rankGroups(groups).map((g) => g.key),
    ["a", "b"],
  );
});
