import { test } from "node:test";
import assert from "node:assert/strict";
import { pickThisWeeksSignals, SMALL_PROJECT_STAR_THRESHOLD, MIN_MEANINGFUL_STAR_DELTA } from "../scripts/this-weeks-signals.mjs";

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
    candidate({ id: "slow/slow", starDelta: 10, percentDelta: 2, currentStars: 9000 }),
    candidate({ id: "fast/fast", starDelta: 10, percentDelta: 40, currentStars: 8000 }),
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

// Regression coverage for a real case: apache/mahout gaining +2 stars in a
// week (a 0.09% move, indistinguishable from ordinary day-to-day jitter)
// still won a sparsely-populated domain's "one to watch" simply because
// nothing else in that scope grew faster — technically the pool's best
// percentDelta, but not an actual signal. mover/watch/heatingUp/breakout
// must all refuse to pick a candidate that never clears
// MIN_MEANINGFUL_STAR_DELTA, even when it's the only candidate available.
test("pickThisWeeksSignals' mover/watch/heatingUp are all null when every candidate is below MIN_MEANINGFUL_STAR_DELTA, even though one is technically the pool's best", () => {
  const pool = [
    candidate({ id: "apache/mahout", starDelta: 2, percentDelta: 0.09, currentStars: 2305 }),
    candidate({ id: "quiet/quiet", starDelta: 1, percentDelta: 0.02, currentStars: 500 }),
  ];
  const { mover, watch, heatingUp, breakout } = pickThisWeeksSignals(pool);
  assert.equal(mover, null);
  assert.equal(watch, null);
  assert.equal(heatingUp, null);
  assert.equal(breakout, null);
});

test("pickThisWeeksSignals excludes only the below-floor candidates, not the whole pool, once at least one candidate clears MIN_MEANINGFUL_STAR_DELTA", () => {
  const pool = [
    candidate({ id: "apache/mahout", starDelta: MIN_MEANINGFUL_STAR_DELTA - 1, percentDelta: 90, currentStars: 2305 }), // would otherwise win watch on percentDelta alone
    candidate({ id: "real/mover", starDelta: MIN_MEANINGFUL_STAR_DELTA, percentDelta: 3, currentStars: 500 }),
  ];
  const { mover, watch } = pickThisWeeksSignals(pool);
  assert.equal(mover.id, "real/mover");
  assert.equal(watch.id, "real/mover");
});

test("pickThisWeeksSignals' breakout is the highest-relativeMultiple candidate, skipping ids mover/watch already claimed", () => {
  const pool = [
    // Highest starDelta -> mover.
    candidate({ id: "mover/mover", starDelta: 900, percentDelta: 5, currentStars: 90000, relativeMultiple: 5 }), // would win breakout too if not excluded
    // Highest percentDelta among small projects -> watch.
    candidate({ id: "watch/watch", starDelta: 20, percentDelta: 60, currentStars: 100, relativeMultiple: 4 }),
    candidate({ id: "breakout/breakout", starDelta: 30, percentDelta: 10, currentStars: 20000, relativeMultiple: 3 }),
    candidate({ id: "no-multiple/no-multiple", starDelta: 15, percentDelta: 8, currentStars: 15000 }), // no relativeMultiple at all
  ];
  const { mover, watch, breakout } = pickThisWeeksSignals(pool);
  assert.equal(mover.id, "mover/mover");
  assert.equal(watch.id, "watch/watch");
  assert.equal(breakout.id, "breakout/breakout");
});

test("pickThisWeeksSignals' breakout is null when no candidate carries a relativeMultiple", () => {
  const pool = [candidate({ id: "a/a", relativeMultiple: undefined })];
  const { breakout } = pickThisWeeksSignals(pool);
  assert.equal(breakout, null);
});
