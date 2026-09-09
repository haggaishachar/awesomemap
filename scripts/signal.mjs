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
 * `true` when every *currently trackable* RISING_WINDOWS_DAYS window shows
 * positive growth (a sustained riser — at least two windows must agree;
 * see below), `false` when only the shortest tracked window is positive (a
 * short-term spike), `null` when there's nothing to say — no window has
 * enough history yet, or the shortest tracked window isn't even positive.
 *
 * Degrades to whichever windows currently have enough history rather than
 * requiring all of RISING_WINDOWS_DAYS (7/30/90) up front: a project's
 * rising30/rising90 windows can't have enough history before the catalog
 * itself has accumulated that much snapshot history, so requiring all
 * three meant `sustained` was `null` for literally every project on the
 * site for the catalog's first ~90 days — not just weaker, completely
 * silent, since that's also the only path to a non-null return at all.
 * `rising7` is always the first window to have enough history (it needs
 * the least), so at least one tracked window is guaranteed whenever
 * `hasEnoughHistory` has any entries set.
 *
 * At least two tracked windows must agree to call something "sustained" —
 * with only one window trackable (early on), this can still distinguish a
 * "spike" (that window is positive) from "nothing to say" (it isn't), but
 * never claims "sustained" from a single data point.
 */
function computeSustained(growthByWindow, hasEnoughHistory) {
  const trackedWindows = RISING_WINDOWS_DAYS.filter((windowDays) => hasEnoughHistory?.[`rising${windowDays}`]);
  if (trackedWindows.length === 0) return null;

  if (trackedWindows.length >= 2) {
    const allPositive = trackedWindows.every((windowDays) => growthByWindow[`rising${windowDays}`].starDelta > 0);
    if (allPositive) return true;
  }

  return growthByWindow.rising7.starDelta > 0 ? false : null;
}

// The smallest multiple that still reads as "faster" after buildHeadline's
// toFixed(1) rounding — anything below this renders as the literal,
// self-contradictory "1.0× faster than X", even though the true value is
// >= 1.0. Confirmed: (1.05).toFixed(1) === "1.1", (1.049).toFixed(1) === "1.0".
const RELATIVE_MULTIPLE_FLOOR = 1.05;

/**
 * How many times faster the project grew (7-day window) than its category
 * did over the same period, or `null` when the comparison wouldn't be
 * meaningful: the project's own 7-day growth isn't tracked or isn't
 * positive (nothing to call "faster"), or the category's isn't tracked or
 * isn't positive (dividing by a flat/shrinking baseline isn't a real
 * "faster than" claim), or the project's growth is equal to or slower than
 * its category's (a "faster than" claim requires the project to actually
 * outperform, i.e., a multiple of at least `RELATIVE_MULTIPLE_FLOOR`).
 */
function computeRelativeMultiple(growthByWindow, hasEnoughHistory, categoryGrowth7d) {
  if (!hasEnoughHistory?.rising7) return null;
  const projectPercent = growthByWindow.rising7.percentDelta;
  if (!(projectPercent > 0)) return null;
  if (!categoryGrowth7d?.hasEnoughHistory) return null;
  if (!(categoryGrowth7d.percentDelta > 0)) return null;
  const multiple = projectPercent / categoryGrowth7d.percentDelta;
  return multiple >= RELATIVE_MULTIPLE_FLOOR ? multiple : null;
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
