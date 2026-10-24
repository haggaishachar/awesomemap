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

test("pickThisWeeksSignals' watch skips the id mover already claimed, so one project never fills both cards", () => {
  const pool = [
    candidate({ id: "both/both", starDelta: 900, percentDelta: 38, currentStars: 3300 }),
    candidate({ id: "next/next", starDelta: 50, percentDelta: 20, currentStars: 400 }),
  ];
  const { mover, watch } = pickThisWeeksSignals(pool);
  assert.equal(mover.id, "both/both");
  assert.equal(watch.id, "next/next");
});

test("pickThisWeeksSignals' watch is null when no candidate is under the star threshold", () => {
  const pool = [candidate({ id: "big/big", currentStars: SMALL_PROJECT_STAR_THRESHOLD + 1 })];
  const { watch } = pickThisWeeksSignals(pool);
  assert.equal(watch, null);
});

test("pickThisWeeksSignals' mover/watch/breakout are all null when every candidate is below MIN_MEANINGFUL_STAR_DELTA, even though one is technically the pool's best", () => {
  const pool = [
    candidate({ id: "apache/mahout", starDelta: 2, percentDelta: 0.09, currentStars: 2305 }),
    candidate({ id: "quiet/quiet", starDelta: 1, percentDelta: 0.02, currentStars: 500 }),
  ];
  const { mover, watch, breakout } = pickThisWeeksSignals(pool);
  assert.equal(mover, null);
  assert.equal(watch, null);
  assert.equal(breakout, null);
});

test("pickThisWeeksSignals excludes only the below-floor candidates, not the whole pool, once at least one candidate clears MIN_MEANINGFUL_STAR_DELTA", () => {
  const pool = [
    candidate({ id: "apache/mahout", starDelta: MIN_MEANINGFUL_STAR_DELTA - 1, percentDelta: 90, currentStars: 2305 }), // would otherwise win watch on percentDelta alone
    candidate({ id: "real/mover", starDelta: MIN_MEANINGFUL_STAR_DELTA, percentDelta: 3, currentStars: 500 }),
  ];
  const { mover, watch } = pickThisWeeksSignals(pool);
  assert.equal(mover.id, "real/mover");
  assert.equal(watch, null); // real/mover is the only one above the floor, and mover already claimed it
});

test("pickThisWeeksSignals' breakout is the highest-relativeMultiple candidate, skipping ids mover/watch already claimed", () => {
  const pool = [
    // Highest starDelta -> mover.
    candidate({ id: "mover/mover", starDelta: 900, percentDelta: 5, currentStars: 9000, relativeMultiple: 5 }), // would win breakout too if not excluded
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

test("pickThisWeeksSignals' buzz is null when no unclaimed candidate has an eventReason", () => {
  const pool = [candidate({ id: "a/a", starDelta: 50, currentStars: 9000, eventReason: { type: "hn", points: 100 } }), candidate({ id: "b/b", starDelta: 10 })];
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

/** A Breakout-tier candidate that absorbs mover, leaving every other candidate unclaimed (none are small enough for watch). */
function upwardClaimers() {
  return [candidate({ id: "claim-mover/claim-mover", starDelta: 50000, percentDelta: 1, currentStars: 9000 })];
}

test("pickThisWeeksSignals' losingMomentum is the biggest absolute week-over-week slowdown among projects whose gain at least halved", () => {
  const pool = [
    candidate({ id: "mover/mover", starDelta: 90000, percentDelta: 1, currentStars: 9000, prevStarDelta: 900000 }), // would win, but mover claimed it
    candidate({ id: "spiking/spiking", starDelta: 50, percentDelta: 99, currentStars: 90000, prevStarDelta: 5000 }), // likewise, claimed by spiking
    candidate({ id: "cooled/cooled", starDelta: 300, currentStars: 90000, prevStarDelta: 2000 }), // slowed by 1,700
    candidate({ id: "stalled/stalled", starDelta: 10, currentStars: 90000, prevStarDelta: 400 }), // slowed by 390
    candidate({ id: "steady/steady", starDelta: 120, currentStars: 90000, prevStarDelta: 200 }), // didn't halve
  ];
  const spikingPool = [candidate({ id: "spiking/spiking", multiple: 8, starDelta: 50, currentStars: 90000 })];
  const { losingMomentum } = pickThisWeeksSignals(pool, { spikingPool });
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
