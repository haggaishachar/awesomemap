export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The lowest positive size a project's rising score can ever be. d3's
// treemap requires strictly positive weights, so a declining or
// no-history project still renders a (negligible) tile instead of vanishing
// or breaking layout.
const SCORE_FLOOR = 0.01;

/** Rising windows this feature supports, in days. */
export const RISING_WINDOWS_DAYS = [7, 30, 90];

/**
 * Computes a growth-velocity score for one project from its raw star-count
 * history. `history` is an array of `{ date: "YYYY-MM-DD", stars }`
 * entries in any order; `windowDays` is how far back to measure growth.
 *
 * The baseline snapshot is the entry closest to (but not after)
 * `windowDays` ago — a missed snapshot day doesn't break the lookup, it
 * just measures from whatever's closest available. `hasEnoughHistory` is
 * false when even the oldest snapshot is younger than the window, since
 * there's no data point far back enough to measure the full window from.
 *
 * `score = starDelta / sqrt(max(currentStars, 1))`, floored at
 * `SCORE_FLOOR` so it's always a valid positive treemap weight, even for
 * a shrinking project.
 */
export function computeVelocity(history, windowDays, { now = new Date() } = {}) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const oldestDate = sorted.length > 0 ? sorted[0].date : null;

  if (sorted.length === 0) {
    return { score: SCORE_FLOOR, hasEnoughHistory: false, starDelta: 0, percentDelta: 0, oldestDate };
  }

  const currentStars = sorted[sorted.length - 1].stars;
  const cutoff = new Date(now).getTime() - windowDays * MS_PER_DAY;

  let baseline = null;
  for (const entry of sorted) {
    if (new Date(entry.date).getTime() <= cutoff) baseline = entry;
    else break;
  }

  if (baseline === null) {
    return { score: SCORE_FLOOR, hasEnoughHistory: false, starDelta: 0, percentDelta: 0, oldestDate };
  }

  const starDelta = currentStars - baseline.stars;
  const percentDelta = baseline.stars > 0 ? (starDelta / baseline.stars) * 100 : 0;
  const rawScore = starDelta / Math.sqrt(Math.max(currentStars, 1));

  return { score: Math.max(rawScore, SCORE_FLOOR), hasEnoughHistory: true, starDelta, percentDelta, oldestDate };
}

/**
 * Builds the full `{ sizes, hasEnoughHistory, growth }` structure
 * `generate.mjs` embeds onto a project's leaf node: one size per mode
 * (`popular` plus one `rising<N>` per supported window), whether each
 * rising window has enough history, and the growth stats behind each
 * rising size (used by the detail panel).
 */
export function computeProjectSizing(project, historyEntries = [], { now } = {}) {
  const sizes = { popular: typeof project.weight === "number" ? project.weight : 1 };
  const hasEnoughHistory = {};
  const growth = {};

  for (const windowDays of RISING_WINDOWS_DAYS) {
    const key = `rising${windowDays}`;
    const result = computeVelocity(historyEntries, windowDays, { now });
    sizes[key] = result.score;
    hasEnoughHistory[key] = result.hasEnoughHistory;
    growth[key] = { starDelta: result.starDelta, percentDelta: result.percentDelta, oldestDate: result.oldestDate };
  }

  return { sizes, hasEnoughHistory, growth };
}

/**
 * Given projects that have already been through `computeProjectSizing`
 * (i.e. each has a `sizes` object), returns the ids of any project whose
 * `sizes` contains a non-numeric, non-finite, or non-positive value — a
 * broken tile should never reach production. Mirrors `enrich-domain.mjs`'s
 * `findInvalidWeights` for this feature's own `sizes` field.
 */
export function findInvalidSizes(projects) {
  const bad = [];
  for (const project of projects) {
    const sizes = project.sizes ?? {};
    const values = ["popular", ...RISING_WINDOWS_DAYS.map((d) => `rising${d}`)].map((key) => sizes[key]);
    const invalid = values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0);
    if (invalid) bad.push(project.id);
  }
  return bad;
}
