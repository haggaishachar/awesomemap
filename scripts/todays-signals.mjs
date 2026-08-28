import { rankGroups } from "./group-growth.mjs";

// The largest current star count a project can have and still count as
// "small" for the `watch` signal — calibrated against this repo's tracked
// projects (velocity.mjs notes star counts range from ~500 to ~386k, with
// the 10th percentile around 6,200), so this sits just below that 10th
// percentile rather than at an arbitrary round number.
export const SMALL_PROJECT_STAR_THRESHOLD = 5000;

/**
 * Picks the landing page's three "today's signals" highlights — a reason
 * to come back daily, per the homepage-hero backlog item's pairing with a
 * "today's signals" teaser. All three reuse data generate.mjs already
 * computes elsewhere; this module only selects, it does not derive new
 * growth math.
 *
 * `moverPool` is an *uncapped* global leaderboard for one window (a
 * `computeLeaderboard` result with `limit` high enough to include every
 * eligible candidate, not just the top N) — capping it before this
 * function runs would let a small-but-fast-growing project get cut off
 * before its `percentDelta` is ever compared for `watch`. `domains` is the
 * same `{ slug, shortName, growth }` list the landing page's own map-card
 * ordering ranks via `rankGroups`.
 *
 * Each of `mover`/`ecosystem`/`watch` is `null` when no candidate
 * qualifies (e.g. too early in the dataset's life) — `renderTodaysSignals`
 * omits that card rather than rendering an empty one.
 */
export function pickTodaysSignals(moverPool, domains, { starThreshold = SMALL_PROJECT_STAR_THRESHOLD } = {}) {
  return {
    mover: pickBiggestMover(moverPool),
    ecosystem: pickHeatingUpEcosystem(domains),
    watch: pickOneToWatch(moverPool, starThreshold),
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

/**
 * The top domain by growth rate, via the same `rankGroups` ordering the
 * landing page's map cards already use — untracked domains sort last, so a
 * tracked top entry is only missing when every domain is untracked.
 */
function pickHeatingUpEcosystem(domains) {
  if (domains.length === 0) return null;
  const ranked = rankGroups(domains.map((domain) => ({ key: domain.slug, domain, growth: domain.growth })));
  const top = ranked[0];
  if (!top.growth.hasEnoughHistory) return null;
  return { ...top.domain, percentDelta: top.growth.percentDelta };
}
