import { test } from "node:test";
import assert from "node:assert/strict";
import {
  githubRepoUrl,
  formatStarCount,
  starHistoryFor,
  sortedHistory,
  buildStarChart,
  positionAnnotations,
  starHistoryCaption,
  formatEventDate,
} from "../app/shared/star-history.js";

test("githubRepoUrl builds a direct link from an owner/repo id", () => {
  assert.equal(githubRepoUrl("scikit-learn/scikit-learn"), "https://github.com/scikit-learn/scikit-learn");
});

test("formatStarCount adds thousands separators to a numeric weight", () => {
  assert.equal(formatStarCount(12345), "12,345");
});

test("formatStarCount returns null when weight is missing", () => {
  assert.equal(formatStarCount(undefined), null);
});

test("starHistoryFor returns the id's series sorted oldest-first", () => {
  const historyData = {
    "a/a": [
      { date: "2026-08-10", stars: 120 },
      { date: "2026-08-08", stars: 100 },
      { date: "2026-08-09", stars: 110 },
    ],
  };
  assert.deepEqual(starHistoryFor(historyData, "a/a"), [
    { date: "2026-08-08", stars: 100 },
    { date: "2026-08-09", stars: 110 },
    { date: "2026-08-10", stars: 120 },
  ]);
});

test("starHistoryFor returns an empty array for an id with no history", () => {
  assert.deepEqual(starHistoryFor({ "a/a": [{ date: "2026-08-08", stars: 100 }] }, "b/b"), []);
});

test("starHistoryFor returns an empty array when historyData is empty", () => {
  assert.deepEqual(starHistoryFor({}, "a/a"), []);
});

test("sortedHistory sorts a project's own history array oldest-first", () => {
  const series = [
    { date: "2026-08-10", stars: 120 },
    { date: "2026-08-08", stars: 100 },
    { date: "2026-08-09", stars: 110 },
  ];
  assert.deepEqual(sortedHistory(series), [
    { date: "2026-08-08", stars: 100 },
    { date: "2026-08-09", stars: 110 },
    { date: "2026-08-10", stars: 120 },
  ]);
});

test("sortedHistory returns an empty array for a brand-new project with no history yet", () => {
  assert.deepEqual(sortedHistory(undefined), []);
  assert.deepEqual(sortedHistory([]), []);
});

test("buildStarChart returns null for fewer than 2 points", () => {
  assert.equal(buildStarChart([]), null);
  assert.equal(buildStarChart([{ date: "2026-08-08", stars: 100 }]), null);
});

test("buildStarChart defaults to the compact (detail-panel) size, matching the old sparkline's dimensions", () => {
  const series = [
    { date: "2026-08-08", stars: 100 },
    { date: "2026-08-13", stars: 200 },
  ];
  const chart = buildStarChart(series);
  assert.equal(chart.width, 160);
  assert.equal(chart.height, 40);
  assert.equal(chart.path, "M4,36 L156,4");
  assert.equal(chart.areaPath, "M4,36 L156,4 L156,36 L4,36 Z");
  assert.deepEqual(chart.points, [
    { x: 4, y: 36, date: "2026-08-08", stars: 100 },
    { x: 156, y: 4, date: "2026-08-13", stars: 200 },
  ]);
  assert.equal(chart.baselineY, 36);
  // showAxes defaults to false — the compact chart has no room for tick labels.
  assert.equal(chart.yAxisTicks, undefined);
  assert.equal(chart.xAxisTicks, undefined);
});

test("buildStarChart positions points by actual elapsed time, not by index — an unchanging series with an uneven date gap lands its middle point proportionally, not at the midpoint", () => {
  // 2026-08-10 is 2 of the 5 days between 2026-08-08 and 2026-08-13 (40%),
  // not halfway through the 3 points — the fix for the old index-based
  // sparkline, and the same x-scale positionAnnotations reuses.
  const series = [
    { date: "2026-08-08", stars: 50 },
    { date: "2026-08-10", stars: 50 },
    { date: "2026-08-13", stars: 50 },
  ];
  const chart = buildStarChart(series);
  assert.equal(chart.path, "M4,20 L64.8,20 L156,20");
  assert.equal(chart.areaPath, "M4,20 L64.8,20 L156,20 L156,36 L4,36 Z");
});

test("buildStarChart collapses to the horizontal midpoint when every point shares one date (no time span to scale across)", () => {
  const series = [
    { date: "2026-08-08", stars: 100 },
    { date: "2026-08-08", stars: 200 },
  ];
  const chart = buildStarChart(series);
  assert.equal(chart.points[0].x, 80);
  assert.equal(chart.points[1].x, 80);
});

test("buildStarChart with showAxes builds the full-size chart's y/x axis ticks", () => {
  const series = [
    { date: "2026-08-08", stars: 1000 },
    { date: "2026-08-13", stars: 1200 },
  ];
  const chart = buildStarChart(series, {
    width: 640,
    height: 220,
    padding: { top: 12, right: 16, bottom: 34, left: 48 },
    showAxes: true,
  });
  assert.equal(chart.path, "M48,186 L624,12");
  assert.equal(chart.baselineY, 186);
  assert.deepEqual(chart.yAxisTicks, [
    { y: 186, label: "1,000" },
    { y: 99, label: "1,100" },
    { y: 12, label: "1,200" },
  ]);
  assert.deepEqual(chart.xAxisTicks, [
    { x: 48, y: 214, label: "Aug 8" },
    { x: 624, y: 214, label: "Aug 13" },
  ]);
});

test("buildStarChart's y-axis ticks collapse to one when the series never changed", () => {
  const series = [
    { date: "2026-08-08", stars: 500 },
    { date: "2026-08-13", stars: 500 },
  ];
  const chart = buildStarChart(series, {
    width: 640,
    height: 220,
    padding: { top: 12, right: 16, bottom: 34, left: 48 },
    showAxes: true,
  });
  assert.deepEqual(chart.yAxisTicks, [{ y: 99, label: "500" }]);
});

test("positionAnnotations maps in-range events onto the chart's own x-scale, and drops events outside its date range", () => {
  const series = [
    { date: "2026-08-08", stars: 1000 },
    { date: "2026-08-13", stars: 1200 },
  ];
  const chart = buildStarChart(series, {
    width: 640,
    height: 220,
    padding: { top: 12, right: 16, bottom: 34, left: 48 },
    showAxes: true,
  });
  const events = [
    { date: "2026-07-01", type: "hn", title: "Too early — predates this chart's window", url: "https://x/0" },
    { date: "2026-08-10", type: "hn", title: "Show HN", url: "https://x/1" },
    { date: "2026-08-13", type: "reddit", title: "On the boundary", url: "https://x/2" },
  ];
  assert.deepEqual(positionAnnotations(events, chart), [
    { x: 278.4, y: 186, event: events[1] },
    { x: 624, y: 186, event: events[2] },
  ]);
});

test("positionAnnotations returns [] when there's no chart to annotate onto, or no events", () => {
  assert.deepEqual(positionAnnotations([{ date: "2026-08-08", type: "hn", title: "t", url: "u" }], null), []);
  const chart = buildStarChart([
    { date: "2026-08-08", stars: 100 },
    { date: "2026-08-13", stars: 200 },
  ]);
  assert.deepEqual(positionAnnotations([], chart), []);
  assert.deepEqual(positionAnnotations(undefined, chart), []);
});

test("starHistoryCaption returns null for fewer than 2 points", () => {
  assert.equal(starHistoryCaption([]), null);
  assert.equal(starHistoryCaption([{ date: "2026-08-08", stars: 100 }]), null);
});

test("starHistoryCaption summarizes the first-to-last change with a short start date", () => {
  const series = [
    { date: "2026-08-08", stars: 1180 },
    { date: "2026-08-13", stars: 1240 },
  ];
  assert.equal(starHistoryCaption(series), "1,180 → 1,240 stars since Aug 8");
});

test("formatEventDate includes the year, unlike formatShortDate's month/day-only", () => {
  assert.equal(formatEventDate("2025-08-08"), "Aug 8, 2025");
});
