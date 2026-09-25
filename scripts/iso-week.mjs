import { MS_PER_DAY } from "./velocity.mjs";

const ISO_WEEK_LABEL_PATTERN = /^(\d{4})-W(\d{2})$/;

/**
 * Returns the UTC-midnight Date for the Monday of `date`'s ISO week.
 * ISO weeks run Monday-Sunday; `getUTCDay()` returns 0 for Sunday, so it's
 * remapped to 7 to make "days since Monday" a simple 1-based subtraction.
 */
function mondayOf(date) {
  const utcDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = utcDay.getUTCDay() || 7;
  utcDay.setUTCDate(utcDay.getUTCDate() - (dayOfWeek - 1));
  return utcDay;
}

/**
 * Returns `date`'s ISO week label, e.g. "2026-W39". The label's year is
 * the ISO week-year (the year owning the Thursday of that week), which can
 * differ from `date`'s calendar year for the first/last few days of
 * January/December.
 */
export function isoWeekLabel(date) {
  const monday = mondayOf(date);
  // The Thursday of an ISO week always falls in the week's ISO week-year,
  // and ISO week 1 is defined as the week containing the year's first
  // Thursday - so counting Thursdays from Jan 1 of the Thursday's own year
  // gives the week number directly.
  const thursday = new Date(monday);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursdayWeekStart = mondayOf(new Date(Date.UTC(isoYear, 0, 4)));
  const weekNumber = Math.round((monday - firstThursdayWeekStart) / (MS_PER_DAY * 7)) + 1;
  return `${isoYear}-W${String(weekNumber).padStart(2, "0")}`;
}

/**
 * Returns the `{ start, end }` UTC bounds of the ISO week named by
 * `isoWeek` (e.g. "2026-W39"): `start` is Monday 00:00:00.000 UTC, `end`
 * is the following Sunday 23:59:59.999 UTC.
 */
export function isoWeekBounds(isoWeek) {
  const match = ISO_WEEK_LABEL_PATTERN.exec(isoWeek);
  if (!match) {
    throw new Error(`Invalid ISO week label: ${isoWeek}`);
  }
  const [, yearStr, weekStr] = match;
  const isoYear = Number(yearStr);
  const weekNumber = Number(weekStr);
  const firstThursdayWeekStart = mondayOf(new Date(Date.UTC(isoYear, 0, 4)));
  const start = new Date(firstThursdayWeekStart.getTime() + (weekNumber - 1) * MS_PER_DAY * 7);
  const end = new Date(start.getTime() + MS_PER_DAY * 7 - 1);
  return { start, end };
}

/** Returns the ISO week label (e.g. "2026-W39") containing `now`. */
export function currentIsoWeek(now = new Date()) {
  return isoWeekLabel(now instanceof Date ? now : new Date(now));
}
