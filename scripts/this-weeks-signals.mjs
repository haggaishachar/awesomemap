// The largest current star count a project can have and still count as
// "small" for the `watch` signal — calibrated against this repo's tracked
// projects (velocity.mjs notes star counts range from ~500 to ~386k, with
// the 10th percentile around 6,200), so this sits just below that 10th
// percentile rather than at an arbitrary round number.
export const SMALL_PROJECT_STAR_THRESHOLD = 5000;

/**
 * Picks the landing page's three "this week's signals" highlights — a reason
 * to come back daily, per the homepage-hero backlog item's pairing with a
 * "this week's signals" teaser. All three reuse data generate.mjs already
 * computes elsewhere; this module only selects, it does not derive new
 * growth math.
 *
 * `moverPool` is an *uncapped* global leaderboard for one window (a
 * `computeLeaderboard` result with `limit` high enough to include every
 * eligible candidate, not just the top N) — capping it before this
 * function runs would let a small-but-fast-growing project get cut off
 * before its `percentDelta` is ever compared for `watch`/`heatingUp`.
 *
 * Each of `mover`/`heatingUp`/`watch` is `null` when no candidate
 * qualifies (e.g. too early in the dataset's life) — `renderThisWeeksSignals`
 * omits that card rather than rendering an empty one. `mover` and `watch`
 * are picked first so `heatingUp` can exclude their ids — otherwise it'd
 * often just repeat `watch` (percentage growth is usually won by small
 * projects).
 */
export function pickThisWeeksSignals(moverPool, { starThreshold = SMALL_PROJECT_STAR_THRESHOLD } = {}) {
  const mover = pickBiggestMover(moverPool);
  const watch = pickOneToWatch(moverPool, starThreshold);
  const claimedIds = new Set([mover?.id, watch?.id].filter(Boolean));
  return {
    mover,
    heatingUp: pickHeatingUpProject(moverPool, claimedIds),
    watch,
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
