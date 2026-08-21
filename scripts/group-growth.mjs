import { computeVelocity } from "./velocity.mjs";

/**
 * Aggregates star growth over a *group* of projects — a whole domain, or one
 * category within a domain. Both callers want the same question answered
 * ("how much did this slice of the ecosystem move?"), so they share this one
 * function; only the grouping differs.
 *
 * `projects` is the raw `data/<slug>.json` project shape (needs `id` and
 * `weight`); `historyById` maps project id to that project's
 * `data/history/<slug>.json` entries.
 *
 * Two deliberate choices:
 *
 * 1. Only projects with enough history for `windowDays` contribute, and they
 *    contribute to `totalStars` and `baselineStars` *both* or neither. Letting
 *    an untracked project's stars into the total but not the baseline would
 *    manufacture growth out of a coverage gap — a domain where half the
 *    projects aren't snapshotted yet would appear to be exploding.
 *    `trackedCount` vs `projectCount` surfaces that coverage instead of hiding
 *    it.
 *
 * 2. The percentage is derived once at group level (summed delta over summed
 *    baseline), not by averaging per-project percentages. Averaging would let
 *    one 30-star project that tripled outweigh fifty established projects, and
 *    report a domain as growing 100% when it actually moved 1%.
 *
 * Note this does NOT use `computeVelocity`'s `score`. That formula's sqrt
 * smoothing exists to damp noise when a single project's star count is small
 * (see SCORE_SMOOTHING_CONSTANT in velocity.mjs); a group's denominator is the
 * sum over dozens of projects, so a plain ratio is both stable and directly
 * explainable to a reader ("this domain grew 1.4% this week").
 */
export function computeGroupGrowth(projects, historyById = {}, windowDays, { now } = {}) {
  let trackedCount = 0;
  let totalStars = 0;
  let starDelta = 0;
  let oldestDate = null;

  for (const project of projects) {
    const entries = historyById[project.id] ?? [];
    const velocity = computeVelocity(entries, windowDays, { now });

    // Tracked or not, the earliest snapshot we've seen tells the UI when
    // tracking began — that's what an insufficient-history group displays
    // instead of a fabricated 0%.
    if (velocity.oldestDate !== null && (oldestDate === null || velocity.oldestDate < oldestDate)) {
      oldestDate = velocity.oldestDate;
    }

    if (!velocity.hasEnoughHistory) continue;

    trackedCount += 1;
    starDelta += velocity.starDelta;
    totalStars += currentStarsOf(entries, project);
  }

  const baselineStars = totalStars - starDelta;
  const percentDelta = baselineStars > 0 ? (starDelta / baselineStars) * 100 : 0;

  return {
    projectCount: projects.length,
    trackedCount,
    totalStars,
    baselineStars,
    starDelta,
    percentDelta,
    hasEnoughHistory: trackedCount > 0,
    oldestDate,
  };
}

/**
 * The project's star count as of its latest snapshot, falling back to the
 * hand-maintained `weight`. Taking it from the same history array the delta
 * came from keeps `totalStars` and `starDelta` consistent with each other, so
 * the derived baseline is exact rather than approximately right.
 */
function currentStarsOf(entries, project) {
  let latest = null;
  for (const entry of entries) {
    if (latest === null || entry.date > latest.date) latest = entry;
  }
  if (latest !== null) return latest.stars;
  return typeof project.weight === "number" ? project.weight : 0;
}

/**
 * Sorts groups (domains or categories) by percent growth, descending, and
 * stamps a 1-based `rank`. Each input is `{ key, growth }` where `growth` is a
 * `computeGroupGrowth` result; extra fields are preserved.
 *
 * Groups with no history sort last rather than mixing in at their zeroed
 * percent — "we haven't measured this yet" is not the same claim as "this
 * didn't move", and a domain we know nothing about must never outrank one that
 * genuinely shrank. Ties break on `key` so the generated HTML is deterministic
 * across builds.
 */
export function rankGroups(groups) {
  return [...groups]
    .sort((a, b) => {
      const aTracked = a.growth.hasEnoughHistory;
      const bTracked = b.growth.hasEnoughHistory;
      if (aTracked !== bTracked) return aTracked ? -1 : 1;
      return b.growth.percentDelta - a.growth.percentDelta || a.key.localeCompare(b.key);
    })
    .map((group, index) => ({ ...group, rank: index + 1 }));
}
