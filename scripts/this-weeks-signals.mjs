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

// The smallest prior-week star gain a project needs before a slowdown
// counts as "losing momentum" — without it, a project going from +8 to +2
// would qualify, which is noise, not a story. Calibrated against this
// repo's tracked projects: the prior-week starDelta 90th percentile sits
// around 110, so 100 limits the card to projects that genuinely had a big
// week before this one.
export const MIN_PRIOR_WEEK_STAR_DELTA = 100;

// How far this week's gain must have fallen relative to last week's to
// count as "losing momentum": at most this fraction of last week's gain
// (0.5 = growth at least halved). Ordinary week-to-week wobble on a steady
// project stays well inside this.
export const MOMENTUM_DROP_RATIO = 0.5;

/**
 * Picks the landing page's six "this week's signals" highlights — a reason
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
 * Two more optional per-candidate fields feed the last two picks:
 * `eventReason` (joined on by generate.mjs's `withEventReason`) for `buzz`,
 * and `prevStarDelta` (the same-length window's star gain one week
 * earlier, joined on by generate.mjs) for `losingMomentum`.
 *
 * Every candidate this module considers for `mover`/`watch`/`heatingUp`/
 * `breakout`/`buzz` must first clear `MIN_MEANINGFUL_STAR_DELTA` — see that
 * constant for why. `losingMomentum` deliberately doesn't: a project whose
 * gain collapsed to a couple of stars is exactly the story it tells, and
 * `MIN_PRIOR_WEEK_STAR_DELTA` guards it against noise instead. `mover`/`watch`/`breakout` are picked before
 * `heatingUp` so `heatingUp` can exclude their ids — otherwise it'd often
 * just repeat `watch` (percentage growth is usually won by small
 * projects).
 *
 * `buzz` and `losingMomentum` are picked last, skipping every id the four
 * upward signals already claimed — a mover that also had the week's
 * biggest HN post already shows that as its own card's reason line, and a
 * project shouldn't read as both "biggest mover" and "losing momentum".
 *
 * Each of `mover`/`heatingUp`/`watch`/`breakout`/`buzz`/`losingMomentum` is `null` when no
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
  const heatingUp = pickHeatingUpProject(pool, claimedIds);
  if (heatingUp) claimedIds.add(heatingUp.id);
  return {
    mover,
    heatingUp,
    watch,
    breakout,
    buzz: pickBuzz(pool, claimedIds),
    losingMomentum: pickLosingMomentum(moverPool, claimedIds),
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

/**
 * The unclaimed candidate with the most notable in-window external mention
 * — highest `eventReason.points` (a blog event carries none, so it only wins
 * when nothing pointed is left), ties going to the bigger starDelta. Null
 * when no unclaimed candidate has an `eventReason` (the common case: these
 * events are sparse, see sources.md).
 */
function pickBuzz(pool, claimedIds) {
  const eligible = pool.filter((candidate) => !claimedIds.has(candidate.id) && candidate.eventReason);
  if (eligible.length === 0) return null;
  const points = (candidate) => candidate.eventReason.points ?? 0;
  return eligible.reduce((best, candidate) =>
    points(candidate) > points(best) || (points(candidate) === points(best) && candidate.starDelta > best.starDelta) ? candidate : best
  );
}

/**
 * The unclaimed candidate whose weekly star gain fell the most in absolute
 * terms, among those that had a real prior week (`prevStarDelta >=
 * MIN_PRIOR_WEEK_STAR_DELTA`) and whose gain this week is at most
 * `MOMENTUM_DROP_RATIO` of it. Ranked by absolute slowdown so last week's
 * big spike cooling off beats a mid-sized project's proportionally similar
 * dip. A candidate still losing stars outright (negative `starDelta`) is
 * skipped — that's usually GitHub pruning spam stars, not a momentum story.
 */
function pickLosingMomentum(pool, claimedIds) {
  const eligible = pool.filter(
    (candidate) =>
      !claimedIds.has(candidate.id) &&
      typeof candidate.prevStarDelta === "number" &&
      candidate.prevStarDelta >= MIN_PRIOR_WEEK_STAR_DELTA &&
      candidate.starDelta >= 0 &&
      candidate.starDelta <= candidate.prevStarDelta * MOMENTUM_DROP_RATIO
  );
  if (eligible.length === 0) return null;
  const slowdown = (candidate) => candidate.prevStarDelta - candidate.starDelta;
  return eligible.reduce((best, candidate) => (slowdown(candidate) > slowdown(best) ? candidate : best));
}
