import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTodaysSignals, SMALL_PROJECT_STAR_THRESHOLD } from "../scripts/todays-signals.mjs";

/** Minimal leaderboard-candidate shape (a computeLeaderboard row). */
function candidate(overrides) {
  return {
    id: "a/a",
    name: "Project A",
    domain: "Data Science",
    domainShort: "Data Science",
    domainSlug: "data-science",
    starDelta: 10,
    percentDelta: 5,
    currentStars: 1000,
    ...overrides,
  };
}

test("pickTodaysSignals' mover is the candidate with the largest absolute starDelta, not the highest score/rank", () => {
  const pool = [
    candidate({ id: "big/big", starDelta: 500, currentStars: 50000 }),
    candidate({ id: "small/small", starDelta: 20, currentStars: 100 }),
  ];
  const { mover } = pickTodaysSignals(pool, []);
  assert.equal(mover.id, "big/big");
});

test("pickTodaysSignals' mover is null when the pool is empty", () => {
  const { mover } = pickTodaysSignals([], []);
  assert.equal(mover, null);
});

test("pickTodaysSignals' watch is the highest-percentDelta candidate among those under the small-project star threshold", () => {
  const pool = [
    candidate({ id: "big/big", percentDelta: 300, currentStars: 50000 }), // too big to be "small"
    candidate({ id: "small-slow/small-slow", percentDelta: 10, currentStars: 200 }),
    candidate({ id: "small-fast/small-fast", percentDelta: 80, currentStars: 300 }),
  ];
  const { watch } = pickTodaysSignals(pool, []);
  assert.equal(watch.id, "small-fast/small-fast");
});

test("pickTodaysSignals' watch is null when no candidate is under the star threshold", () => {
  const pool = [candidate({ id: "big/big", currentStars: SMALL_PROJECT_STAR_THRESHOLD + 1 })];
  const { watch } = pickTodaysSignals(pool, []);
  assert.equal(watch, null);
});

test("pickTodaysSignals' ecosystem is the domain with the highest tracked growth, carrying its percentDelta", () => {
  const domains = [
    { slug: "security", shortName: "Security", growth: { hasEnoughHistory: true, percentDelta: 2 } },
    { slug: "ai", shortName: "AI", growth: { hasEnoughHistory: true, percentDelta: 9 } },
  ];
  const { ecosystem } = pickTodaysSignals([], domains);
  assert.equal(ecosystem.slug, "ai");
  assert.equal(ecosystem.percentDelta, 9);
});

test("pickTodaysSignals' ecosystem is null when no domain has enough history to rank", () => {
  const domains = [{ slug: "security", shortName: "Security", growth: { hasEnoughHistory: false, percentDelta: 0 } }];
  const { ecosystem } = pickTodaysSignals([], domains);
  assert.equal(ecosystem, null);
});
