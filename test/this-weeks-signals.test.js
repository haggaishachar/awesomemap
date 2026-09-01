import { test } from "node:test";
import assert from "node:assert/strict";
import { pickThisWeeksSignals, SMALL_PROJECT_STAR_THRESHOLD } from "../scripts/this-weeks-signals.mjs";

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

test("pickThisWeeksSignals' mover is the candidate with the largest absolute starDelta, not the highest score/rank", () => {
  const pool = [
    candidate({ id: "big/big", starDelta: 500, currentStars: 50000 }),
    candidate({ id: "small/small", starDelta: 20, currentStars: 100 }),
  ];
  const { mover } = pickThisWeeksSignals(pool);
  assert.equal(mover.id, "big/big");
});

test("pickThisWeeksSignals' mover is null when the pool is empty", () => {
  const { mover } = pickThisWeeksSignals([]);
  assert.equal(mover, null);
});

test("pickThisWeeksSignals' watch is the highest-percentDelta candidate among those under the small-project star threshold", () => {
  const pool = [
    candidate({ id: "big/big", percentDelta: 300, currentStars: 50000 }), // too big to be "small"
    candidate({ id: "small-slow/small-slow", percentDelta: 10, currentStars: 200 }),
    candidate({ id: "small-fast/small-fast", percentDelta: 80, currentStars: 300 }),
  ];
  const { watch } = pickThisWeeksSignals(pool);
  assert.equal(watch.id, "small-fast/small-fast");
});

test("pickThisWeeksSignals' watch is null when no candidate is under the star threshold", () => {
  const pool = [candidate({ id: "big/big", currentStars: SMALL_PROJECT_STAR_THRESHOLD + 1 })];
  const { watch } = pickThisWeeksSignals(pool);
  assert.equal(watch, null);
});

test("pickThisWeeksSignals' heatingUp is the highest-percentDelta project in the pool", () => {
  const pool = [
    candidate({ id: "slow/slow", starDelta: 1, percentDelta: 2, currentStars: 9000 }),
    candidate({ id: "fast/fast", starDelta: 1, percentDelta: 40, currentStars: 8000 }),
  ];
  const { heatingUp } = pickThisWeeksSignals(pool);
  assert.equal(heatingUp.id, "fast/fast");
});

test("pickThisWeeksSignals' heatingUp is null when the pool is empty", () => {
  const { heatingUp } = pickThisWeeksSignals([]);
  assert.equal(heatingUp, null);
});

test("pickThisWeeksSignals' heatingUp skips whichever candidate mover or watch already claimed", () => {
  const pool = [
    // Highest starDelta -> mover. Also has the highest percentDelta, so it
    // would win heatingUp too if heatingUp didn't exclude it.
    candidate({ id: "mover/mover", starDelta: 900, percentDelta: 90, currentStars: 90000 }),
    // Highest percentDelta among small projects -> watch.
    candidate({ id: "watch/watch", starDelta: 5, percentDelta: 60, currentStars: 100 }),
    // Next-highest percentDelta once mover and watch are excluded.
    candidate({ id: "heating/heating", starDelta: 10, percentDelta: 30, currentStars: 20000 }),
  ];
  const { mover, watch, heatingUp } = pickThisWeeksSignals(pool);
  assert.equal(mover.id, "mover/mover");
  assert.equal(watch.id, "watch/watch");
  assert.equal(heatingUp.id, "heating/heating");
});
