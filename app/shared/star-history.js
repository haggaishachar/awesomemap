/**
 * Pure helpers for the detail panel's GitHub-stars link and star-history
 * sparkline. Kept dependency- and DOM-free (mirrors `layout.js`'s split
 * from `treemap.js`) so the geometry and formatting are unit-testable
 * without a browser; `detail-panel.js` does the DOM wiring around these.
 */

const CHART_WIDTH = 160;
const CHART_HEIGHT = 40;
const CHART_PADDING = 4;

/** Builds the direct GitHub repo URL from an `id` ("owner/repo") field. */
export function githubRepoUrl(id) {
  return `https://github.com/${id}`;
}

/** Formats a numeric star count with thousands separators, or `null` if `weight` isn't a number. */
export function formatStarCount(weight) {
  return typeof weight === "number" && Number.isFinite(weight) ? weight.toLocaleString("en-US") : null;
}

function sortSeries(series) {
  return [...series].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Looks up `id`'s `{date, stars}` series in a fetched `history.json` blob
 * (a per-domain, build-time-generated map of `{ [id]: [{date, stars}] }` —
 * one entry per project's own `history` array, see generate.mjs's Pass 3),
 * sorted oldest-first. Returns `[]` when the id has no history yet (new
 * project, or a domain with no tracked projects at all).
 */
export function starHistoryFor(historyData, id) {
  const series = historyData?.[id];
  if (!Array.isArray(series)) return [];
  return sortSeries(series);
}

/**
 * Sorts a project entity's own `history` array oldest-first — the
 * build-time equivalent of `starHistoryFor`'s lookup, for callers that
 * already have one project's series in hand (e.g. generate.mjs building a
 * compare record or a project page) rather than a fetched multi-project
 * blob. Returns `[]` for anything that isn't a real array (e.g. a
 * brand-new project with no snapshots yet).
 */
export function sortedHistory(series) {
  return Array.isArray(series) ? sortSeries(series) : [];
}

/**
 * Builds a small SVG sparkline path plotting `series` (oldest-first,
 * from `starHistoryFor`) across a fixed-size chart, scaled so the
 * series' min/max stars span the chart's full height. Returns `null`
 * when there are fewer than 2 points — a single point has no trend to
 * draw, matching the "not enough history yet" degradation used
 * elsewhere in the detail panel.
 */
export function buildSparklinePath(series) {
  if (!Array.isArray(series) || series.length < 2) return null;

  const stars = series.map((entry) => entry.stars);
  const min = Math.min(...stars);
  const max = Math.max(...stars);
  const innerWidth = CHART_WIDTH - CHART_PADDING * 2;
  const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const xStep = innerWidth / (series.length - 1);

  const points = series.map((entry, i) => {
    const x = CHART_PADDING + i * xStep;
    const y =
      max === min
        ? CHART_PADDING + innerHeight / 2
        : CHART_PADDING + innerHeight - ((entry.stars - min) / (max - min)) * innerHeight;
    return `${round(x)},${round(y)}`;
  });

  return { path: `M${points.join(" L")}`, width: CHART_WIDTH, height: CHART_HEIGHT };
}

/**
 * Builds the sparkline's caption, e.g. "1,180 → 1,240 stars since Aug 8".
 * Returns `null` under the same "fewer than 2 points" condition as
 * `buildSparklinePath`, so callers can use either to decide whether to
 * render the chart at all.
 */
export function starHistoryCaption(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  return `${formatStarCount(first.stars)} → ${formatStarCount(last.stars)} stars since ${formatShortDate(first.date)}`;
}

function formatShortDate(dateStr) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${dateStr}T00:00:00Z`)
  );
}

function round(n) {
  return Math.round(n * 100) / 100;
}
