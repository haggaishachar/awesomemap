/**
 * Pure helpers for the detail panel's GitHub-stars link and star-history
 * chart. Kept dependency- and DOM-free (mirrors `layout.js`'s split from
 * `treemap.js`) so the geometry and formatting are unit-testable without a
 * browser; `detail-panel.js` (client-side) and `scripts/render-page.mjs`
 * (server-side project page) both render from this one shared geometry.
 */

// The detail panel's compact chart (a flyout widget, no room for axis
// labels) — same size the old bare-path sparkline used, so this change
// doesn't reflow the panel.
const COMPACT_CHART_WIDTH = 160;
const COMPACT_CHART_HEIGHT = 40;
const COMPACT_CHART_PADDING = { top: 4, right: 4, bottom: 4, left: 4 };

// The project page's chart — enough room for y-axis star-count labels,
// x-axis date labels, and annotation markers below the baseline.
export const FULL_CHART_WIDTH = 640;
export const FULL_CHART_HEIGHT = 220;
export const FULL_CHART_PADDING = { top: 12, right: 16, bottom: 34, left: 48 };

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

function dateToMs(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getTime();
}

/**
 * Maps a date onto `xScale`'s horizontal axis via straight-line
 * interpolation across the chart's own first-to-last date span — `xScale`
 * is plain data (`{firstMs, lastMs, paddingLeft, innerWidth}`), not a
 * closure, so a `buildStarChart` result stays a plain, `deepEqual`-able
 * object. Collapses to the horizontal midpoint when every point in the
 * chart shares one date (nothing to scale across), avoiding a division by
 * zero.
 */
function xForDate(xScale, dateStr) {
  const { firstMs, lastMs, paddingLeft, innerWidth } = xScale;
  const spanMs = lastMs - firstMs;
  if (spanMs === 0) return paddingLeft + innerWidth / 2;
  return paddingLeft + ((dateToMs(dateStr) - firstMs) / spanMs) * innerWidth;
}

/** Y-axis ticks at min/mid/max star count (just min when the series never changed), for the full chart's gridlines + labels. */
function buildYAxisTicks(min, max, padding, innerHeight) {
  const values = min === max ? [min] : [min, (min + max) / 2, max];
  return values.map((value) => ({
    y: round(min === max ? padding.top + innerHeight / 2 : padding.top + innerHeight - ((value - min) / (max - min)) * innerHeight),
    label: formatStarCount(Math.round(value)),
  }));
}

/** X-axis ticks at the series' first and last date (just the one date when they're the same), for the full chart's date labels. */
function buildXAxisTicks(series, xScale, height) {
  const first = series[0];
  const last = series[series.length - 1];
  const y = height - 6;
  const ticks = [{ x: round(xForDate(xScale, first.date)), y, label: formatShortDate(first.date) }];
  if (last.date !== first.date) {
    ticks.push({ x: round(xForDate(xScale, last.date)), y, label: formatShortDate(last.date) });
  }
  return ticks;
}

/**
 * Builds an SVG star-history chart's full geometry: the line path, a
 * filled area beneath it, per-point coordinates (for hoverable data-point
 * markers), and — when `showAxes` is true — y/x axis tick marks. Replaces
 * the old bare-path `buildSparklinePath`; still dependency- and DOM-free,
 * so both the server-rendered project page and the client-side detail
 * panel share this one geometry builder. Returns `null` under the same
 * "fewer than 2 points" condition `buildSparklinePath` used — a single
 * point has no trend to draw.
 *
 * Points are positioned by actual elapsed time between the series' first
 * and last date, not by index — a project whose snapshots have an uneven
 * gap (a missed day, or an old backfill) still lands proportionally on
 * the x-axis, and this is the same x-scale `positionAnnotations` reuses to
 * place external events onto the same chart.
 *
 * `width`/`height` size the chart; `padding` is `{top, right, bottom,
 * left}` — the detail panel's compact chart (the defaults) uses a small
 * uniform padding and leaves `showAxes` at its default `false` (no room
 * for tick labels in a 160px-wide flyout; `starHistoryCaption`'s prose
 * already carries the start/end date and star count). The project page's
 * chart passes `FULL_CHART_WIDTH`/`FULL_CHART_HEIGHT`/`FULL_CHART_PADDING`
 * and `showAxes: true`.
 */
export function buildStarChart(series, { width = COMPACT_CHART_WIDTH, height = COMPACT_CHART_HEIGHT, padding = COMPACT_CHART_PADDING, showAxes = false } = {}) {
  if (!Array.isArray(series) || series.length < 2) return null;

  const stars = series.map((entry) => entry.stars);
  const min = Math.min(...stars);
  const max = Math.max(...stars);
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const xScale = {
    firstMs: dateToMs(series[0].date),
    lastMs: dateToMs(series[series.length - 1].date),
    paddingLeft: padding.left,
    innerWidth,
  };

  const yFor = (value) =>
    max === min ? padding.top + innerHeight / 2 : padding.top + innerHeight - ((value - min) / (max - min)) * innerHeight;

  const points = series.map((entry) => ({
    x: round(xForDate(xScale, entry.date)),
    y: round(yFor(entry.stars)),
    date: entry.date,
    stars: entry.stars,
  }));

  const baselineY = round(padding.top + innerHeight);
  const path = `M${points.map((p) => `${p.x},${p.y}`).join(" L")}`;
  const areaPath = `${path} L${points[points.length - 1].x},${baselineY} L${points[0].x},${baselineY} Z`;

  const chart = { width, height, path, areaPath, points, baselineY, xScale };

  if (showAxes) {
    chart.yAxisTicks = buildYAxisTicks(min, max, padding, innerHeight);
    chart.xAxisTicks = buildXAxisTicks(series, xScale, height);
  }

  return chart;
}

/**
 * Maps `eventsSeries` entries onto `chart`'s x-scale (from `buildStarChart`,
 * called with `showAxes: true`) for rendering as clickable annotation
 * markers along the chart's own baseline — the project page's "why did
 * this grow, and when" overlay pairing the chart with
 * `renderProjectEventsTimeline`'s full chronological list. An event whose
 * date falls outside the chart's own plotted date range is omitted:
 * `events` is never pruned (see scripts/snapshot-events.mjs) while
 * `history` is windowed to 120 days, so an older event easily predates
 * everything currently on the chart — it still appears in the full
 * Timeline list below the chart, just not as an annotation on it. Returns
 * `[]` when `chart` is `null` (nothing to annotate onto) or `eventsSeries`
 * has no events in range.
 */
export function positionAnnotations(eventsSeries, chart) {
  if (!chart || !Array.isArray(eventsSeries)) return [];
  const { firstMs, lastMs } = chart.xScale;
  return eventsSeries
    .filter((event) => {
      const ms = dateToMs(event.date);
      return ms >= firstMs && ms <= lastMs;
    })
    .map((event) => ({ x: round(xForDate(chart.xScale, event.date)), y: chart.baselineY, event }));
}

/**
 * Builds the chart's caption, e.g. "1,180 → 1,240 stars since Aug 8".
 * Returns `null` under the same "fewer than 2 points" condition as
 * `buildStarChart`, so callers can use either to decide whether to render
 * the chart at all.
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

/**
 * Formats a date with its year (e.g. "Aug 8, 2025"), unlike `formatShortDate`'s
 * month/day-only — for the project page's events timeline (see
 * scripts/render-page.mjs's `renderProjectEventsTimeline`), where an entry
 * can be years old (`events` is never pruned, unlike `history`'s 120-day
 * window `formatShortDate`'s callers stay implicitly within), so the year
 * can't be left implied.
 */
export function formatEventDate(dateStr) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${dateStr}T00:00:00Z`)
  );
}

function round(n) {
  return Math.round(n * 100) / 100;
}
