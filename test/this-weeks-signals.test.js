import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickThisWeeksSignals,
  SMALL_PROJECT_STAR_THRESHOLD,
  MIN_MEANINGFUL_STAR_DELTA,
  MIN_PRIOR_WEEK_STAR_DELTA,
  MOMENTUM_DROP_RATIO,
} from "../scripts/this-weeks-signals.mjs";

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

test("pickThisWeeksSignals' buzz is the candidate with the highest-points in-window eventReason, skipping ids every other upward signal claimed", () => {
  const pool = [
    // Highest starDelta -> mover. Also carries the biggest event, but the
    // mover card already shows its own reason line.
    candidate({ id: "mover/mover", starDelta: 900, percentDelta: 5, currentStars: 90000, eventReason: { type: "hn", points: 900 } }),
    // Highest percentDelta among the rest -> heatingUp, so it's claimed too.
    candidate({ id: "heating/heating", starDelta: 30, percentDelta: 50, currentStars: 40000, eventReason: { type: "hn", points: 600 } }),
    candidate({ id: "loud/loud", starDelta: 40, percentDelta: 1, currentStars: 40000, eventReason: { type: "hn", points: 300 } }),
    candidate({ id: "quieter/quieter", starDelta: 60, percentDelta: 1, currentStars: 40000, eventReason: { type: "reddit", points: 120 } }),
    candidate({ id: "press/press", starDelta: 80, percentDelta: 1, currentStars: 40000, eventReason: { type: "blog" } }),
  ];
  const { mover, heatingUp, buzz } = pickThisWeeksSignals(pool);
  assert.equal(mover.id, "mover/mover");
  assert.equal(heatingUp.id, "heating/heating");
  assert.equal(buzz.id, "loud/loud");
});

test("pickThisWeeksSignals' buzz is null when no unclaimed candidate has an eventReason", () => {
  const pool = [candidate({ id: "a/a", starDelta: 50, currentStars: 90000, eventReason: { type: "hn", points: 100 } }), candidate({ id: "b/b", starDelta: 10 })];
  const { mover, buzz } = pickThisWeeksSignals(pool);
  assert.equal(mover.id, "a/a");
  assert.equal(buzz, null);
});

test("pickThisWeeksSignals' buzz ignores candidates below MIN_MEANINGFUL_STAR_DELTA, even with a big mention", () => {
  const pool = [
    candidate({ id: "a/a", starDelta: 50 }),
    candidate({ id: "noise/noise", starDelta: MIN_MEANINGFUL_STAR_DELTA - 1, eventReason: { type: "hn", points: 500 } }),
  ];
  assert.equal(pickThisWeeksSignals(pool).buzz, null);
});

/** A pool of three candidates that absorb mover/heatingUp, leaving every other candidate unclaimed (none are small enough for watch). */
function upwardClaimers() {
  return [
    candidate({ id: "claim-mover/claim-mover", starDelta: 50000, percentDelta: 1, currentStars: 900000 }),
    candidate({ id: "claim-heating/claim-heating", starDelta: 50, percentDelta: 99, currentStars: 90000 }),
  ];
}

test("pickThisWeeksSignals' losingMomentum is the biggest absolute week-over-week slowdown among projects whose gain at least halved", () => {
  const pool = [
    candidate({ id: "mover/mover", starDelta: 90000, percentDelta: 1, currentStars: 900000, prevStarDelta: 900000 }), // would win, but mover claimed it
    candidate({ id: "heating/heating", starDelta: 50, percentDelta: 99, currentStars: 90000, prevStarDelta: 5000 }), // likewise, claimed by heatingUp
    candidate({ id: "cooled/cooled", starDelta: 300, currentStars: 90000, prevStarDelta: 2000 }), // slowed by 1,700
    candidate({ id: "stalled/stalled", starDelta: 10, currentStars: 90000, prevStarDelta: 400 }), // slowed by 390
    candidate({ id: "steady/steady", starDelta: 120, currentStars: 90000, prevStarDelta: 200 }), // didn't halve
  ];
  const { losingMomentum } = pickThisWeeksSignals(pool);
  assert.equal(losingMomentum.id, "cooled/cooled");
});

test("pickThisWeeksSignals' losingMomentum requires a real prior week (MIN_PRIOR_WEEK_STAR_DELTA) and a drop of at least MOMENTUM_DROP_RATIO", () => {
  const smallPrior = [candidate({ id: "a/a", starDelta: 1, prevStarDelta: MIN_PRIOR_WEEK_STAR_DELTA - 1 })];
  assert.equal(pickThisWeeksSignals(smallPrior).losingMomentum, null);

  const notHalved = [...upwardClaimers(), candidate({ id: "b/b", starDelta: 60, currentStars: 90000, prevStarDelta: 100 })];
  assert.equal(pickThisWeeksSignals(notHalved).losingMomentum, null);

  const exactlyHalved = [...upwardClaimers(), candidate({ id: "b/b", starDelta: 100 * MOMENTUM_DROP_RATIO, currentStars: 90000, prevStarDelta: 100 })];
  assert.equal(pickThisWeeksSignals(exactlyHalved).losingMomentum.id, "b/b");
});

test("pickThisWeeksSignals' losingMomentum skips candidates with no prevStarDelta, and ones still losing stars outright", () => {
  const pool = [
    candidate({ id: "a/a", starDelta: 1000 }),
    candidate({ id: "no-prior/no-prior", starDelta: 6 }),
    candidate({ id: "shrinking/shrinking", starDelta: -40, prevStarDelta: 500 }),
  ];
  assert.equal(pickThisWeeksSignals(pool).losingMomentum, null);
});
