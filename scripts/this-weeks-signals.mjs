// The largest current star count a project can have and still count as
// "small" for the `watch` signal — calibrated against this repo's tracked
// projects (velocity.mjs notes star counts range from ~500 to ~386k, with
// the 10th percentile around 6,200), so this sits just below that 10th
// percentile rather than at an arbitrary round number.
export const SMALL_PROJECT_STAR_THRESHOLD = 5000;

// The smallest absolute star gain a candidate needs to be treated as an
// actual signal rather than day-to-day noise (a handful of stars a week is
// well within normal jitter for almost any tracked repo). Calibrated the
// same way as SMALL_PROJECT_STAR_THRESHOLD above: this repo's global 7-day
// pool has a starDelta 10th percentile around 4, so 5 sits just above it —
// filtering only the bottom slice, not an arbitrary round number. Without
// this floor, a sparsely-populated scope (e.g. a domain with few eligible
// projects) can end up crowning a project that gained one or two stars all
// week as "one to watch" simply because nothing else in that scope grew
// faster — technically the pool's best percentDelta, but not a real signal.
export const MIN_MEANINGFUL_STAR_DELTA = 5;

/**
 * Picks the landing page's four "this week's signals" highlights — a reason
 * to come back daily, per the homepage-hero backlog item's pairing with a
 * "this week's signals" teaser. All four reuse data generate.mjs already
 * computes elsewhere; this module only selects, it does not derive new
 * growth math.
 *
 * `moverPool` is an *uncapped* global leaderboard for one window (a
 * `computeLeaderboard` result with `limit` high enough to include every
 * eligible candidate, not just the top N) — capping it before this
 * function runs would let a small-but-fast-growing project get cut off
 * before its `percentDelta` is ever compared for `watch`/`heatingUp`.
 * Each candidate may also carry `relativeMultiple`/`categoryName` (joined
 * on by generate.mjs from `signal.mjs`'s `explainSignal`, keyed by id) —
 * `breakout` reads those; a candidate without them is simply never
 * eligible for `breakout`.
 *
 * Every candidate this module considers for `mover`/`watch`/`heatingUp`/
 * `breakout` must first clear `MIN_MEANINGFUL_STAR_DELTA` — see that
 * constant for why. `mover`/`watch`/`breakout` are picked before
 * `heatingUp` so `heatingUp` can exclude their ids — otherwise it'd often
 * just repeat `watch` (percentage growth is usually won by small
 * projects).
 *
 * Each of `mover`/`heatingUp`/`watch`/`breakout` is `null` when no
 * candidate qualifies (e.g. too early in the dataset's life, or nothing in
 * this scope grew meaningfully this week) — `renderThisWeeksSignals` omits
 * that card rather than rendering an empty one.
 */
export function pickThisWeeksSignals(moverPool, { starThreshold = SMALL_PROJECT_STAR_THRESHOLD } = {}) {
  const pool = moverPool.filter((candidate) => candidate.starDelta >= MIN_MEANINGFUL_STAR_DELTA);
  const mover = pickBiggestMover(pool);
  const watch = pickOneToWatch(pool, starThreshold);
  const breakout = pickBreakout(pool, new Set([mover?.id, watch?.id].filter(Boolean)));
  const claimedIds = new Set([mover?.id, watch?.id, breakout?.id].filter(Boolean));
  return {
    mover,
    heatingUp: pickHeatingUpProject(pool, claimedIds),
    watch,
    breakout,
  };
}

/** The candidate with the largest absolute starDelta — deliberately not the top-ranked (by score) candidate, since score already damps large absolute gains in favor of growth rate. */
function pickBiggestMover(pool) {
  if (pool.length === 0) return null;
  return pool.reduce((best, candidate) => (candidate.starDelta > best.starDelta ? candidate : best));
}

/** The highest-percentDelta candidate among those under `starThreshold` current stars, or null if none qualify. */
function pickOneToWatch(pool, starThreshold) {
  const small = pool.filter((candidate) => candidate.currentStars < starThreshold);
  if (small.length === 0) return null;
  return small.reduce((best, candidate) => (candidate.percentDelta > best.percentDelta ? candidate : best));
}

/** The highest-percentDelta candidate in the pool, skipping any id already claimed by another signal — or null if none remain. */
function pickHeatingUpProject(pool, claimedIds) {
  const eligible = pool.filter((candidate) => !claimedIds.has(candidate.id));
  if (eligible.length === 0) return null;
  return eligible.reduce((best, candidate) => (candidate.percentDelta > best.percentDelta ? candidate : best));
}

/**
 * The candidate that grew the most times faster than its own category this
 * week — `relativeMultiple` (how many times a candidate's own 7-day percent
 * growth beat its category's) is precomputed onto each candidate by
 * generate.mjs, reusing `signal.mjs`'s `explainSignal` (the same "3.8×
 * faster than Databases this week" math a project's own detail page already
 * shows). Skips any id already claimed by `mover`/`watch`, and any
 * candidate with no `relativeMultiple` (its own category has too little
 * history to compare against). Null if none remain.
 */
function pickBreakout(pool, claimedIds) {
  const eligible = pool.filter((candidate) => !claimedIds.has(candidate.id) && typeof candidate.relativeMultiple === "number");
  if (eligible.length === 0) return null;
  return eligible.reduce((best, candidate) => (candidate.relativeMultiple > best.relativeMultiple ? candidate : best));
}
