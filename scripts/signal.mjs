import { RISING_WINDOWS_DAYS } from "./velocity.mjs";

/**
 * Derives a short "why is this interesting" narrative from a project's own
 * per-window growth (as built by `computeProjectSizing` in velocity.mjs)
 * and its category's 7-day growth (a `computeGroupGrowth` result, e.g. one
 * entry of `categoryGrowthBySlug` in generate.mjs). Pure — no I/O, no
 * knowledge of HTML or routing, same shape as group-growth.mjs's/
 * tag-growth.mjs's other derivation functions.
 *
 * `growthByWindow`/`hasEnoughHistory` are a project's own `growth`/
 * `hasEnoughHistory` objects, each keyed `rising7`/`rising30`/`rising90`.
 * `categoryGrowth7d` is the project's category's 7-day `computeGroupGrowth`
 * result (may be `undefined` for a category with no growth data at all —
 * e.g. one that's brand new). `categoryName` only words the relative-growth
 * clause; passing it as `undefined` degrades to the sustained-only clause.
 *
 * Returns `{ sustained, relativeMultiple, headline }` — see
 * `computeSustained`/`computeRelativeMultiple`/`buildHeadline` below for
 * what each means and when each is `null`.
 */
export function explainSignal({ growthByWindow, hasEnoughHistory, categoryGrowth7d, categoryName }) {
  const sustained = computeSustained(growthByWindow, hasEnoughHistory);
  const relativeMultiple = computeRelativeMultiple(growthByWindow, hasEnoughHistory, categoryGrowth7d);
  const headline = buildHeadline(sustained, relativeMultiple, categoryName);
  return { sustained, relativeMultiple, headline };
}

/**
 * `true` when every RISING_WINDOWS_DAYS window shows positive growth (a
 * sustained riser), `false` when only the shortest window does (a
 * short-term spike), `null` when there's nothing to say — either a window
 * is missing history, or the shortest window isn't even positive.
 */
function computeSustained(growthByWindow, hasEnoughHistory) {
  const allTracked = RISING_WINDOWS_DAYS.every((windowDays) => hasEnoughHistory?.[`rising${windowDays}`]);
  if (!allTracked) return null;

  const allPositive = RISING_WINDOWS_DAYS.every((windowDays) => growthByWindow[`rising${windowDays}`].starDelta > 0);
  if (allPositive) return true;

  return growthByWindow.rising7.starDelta > 0 ? false : null;
}

/**
 * How many times faster the project grew (7-day window) than its category
 * did over the same period, or `null` when the comparison wouldn't be
 * meaningful: the project's own 7-day growth isn't tracked or isn't
 * positive (nothing to call "faster"), or the category's isn't tracked or
 * isn't positive (dividing by a flat/shrinking baseline isn't a real
 * "faster than" claim), or the project's growth is equal to or slower than
 * its category's (a "faster than" claim requires the project to actually
 * outperform, i.e., a multiple of at least 1.0).
 */
function computeRelativeMultiple(growthByWindow, hasEnoughHistory, categoryGrowth7d) {
  if (!hasEnoughHistory?.rising7) return null;
  const projectPercent = growthByWindow.rising7.percentDelta;
  if (!(projectPercent > 0)) return null;
  if (!categoryGrowth7d?.hasEnoughHistory) return null;
  if (!(categoryGrowth7d.percentDelta > 0)) return null;
  const multiple = projectPercent / categoryGrowth7d.percentDelta;
  return multiple >= 1 ? multiple : null;
}

/** Composes whichever of the two clauses is available into one sentence, or `null` if neither is. */
function buildHeadline(sustained, relativeMultiple, categoryName) {
  const sustainedClause = sustained === true ? "Growing steadily" : sustained === false ? "Recent spike" : null;
  const relativeClause =
    typeof relativeMultiple === "number" && categoryName
      ? `${relativeMultiple.toFixed(1)}× faster than ${categoryName} this week`
      : null;

  if (sustainedClause && relativeClause) return `${sustainedClause}, ${relativeClause}`;
  if (sustainedClause) return `${sustainedClause} this week`;
  if (relativeClause) return relativeClause;
  return null;
}
