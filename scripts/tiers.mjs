// scripts/tiers.mjs
// Kept byte-identical with awesomemap-data/scripts/tiers.mjs — both repos'
// leaderboard.mjs import it.

/**
 * Star-count size tiers every Rising leaderboard is split into. A project's
 * tier is decided by its current star count as of the leaderboard's `asOf`
 * (see leaderboard.mjs). `minStars` is inclusive, `maxStars` exclusive.
 * Calibrated on 2026-10-19's 7-day pool (1,266 growing projects, median
 * ~12k stars): 555 / 538 / 173 projects per tier. Breakout is the default
 * everywhere — it's what makes "before they get big" literally true.
 */
export const TIERS = [
  { key: "breakout", label: "Breakout", singular: "Breakout", minStars: 0, maxStars: 10_000 },
  { key: "climbing", label: "Climbing", singular: "Climbing", minStars: 10_000, maxStars: 50_000 },
  { key: "giants", label: "Giants", singular: "Giant", minStars: 50_000, maxStars: Infinity },
];

export const DEFAULT_TIER = "breakout";

/** The fourth Rising tab — not a size tier (spans every size), see spiking.mjs. */
export const SPIKING_TAB = { key: "spiking", label: "Spiking" };

/** The tier key for a current star count. */
export function tierForStars(stars) {
  return TIERS.find((tier) => stars >= tier.minStars && stars < tier.maxStars).key;
}

/** A domain teaser with fewer Breakout rows than this is topped up from Climbing. */
export const TEASER_MIN_BREAKOUT = 3;

/**
 * Builds a domain page's "Rising this week" teaser: the top `limit` Breakout
 * rows, or — when Breakout has fewer than `minBreakout` — whatever Breakout
 * has, topped up to `limit` from Climbing, so a domain of mostly-large
 * projects never shows a near-empty teaser. Rows keep their own `tier` so the
 * renderer can tag the Climbing ones.
 */
export function composeTeaser(breakoutRows, climbingRows, { limit = 5, minBreakout = TEASER_MIN_BREAKOUT } = {}) {
  const breakout = breakoutRows.slice(0, limit);
  if (breakout.length >= minBreakout) return breakout;
  return [...breakout, ...climbingRows.slice(0, limit - breakout.length)];
}
