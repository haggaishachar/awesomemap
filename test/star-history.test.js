import { test } from "node:test";
import assert from "node:assert/strict";
import {
  githubRepoUrl,
  formatStarCount,
  starHistoryFor,
  sortedHistory,
  buildSparklinePath,
  starHistoryCaption,
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

test("buildSparklinePath returns null for fewer than 2 points", () => {
  assert.equal(buildSparklinePath([]), null);
  assert.equal(buildSparklinePath([{ date: "2026-08-08", stars: 100 }]), null);
});

test("buildSparklinePath maps a rising two-point series to opposite corners", () => {
  const series = [
    { date: "2026-08-08", stars: 100 },
    { date: "2026-08-13", stars: 200 },
  ];
  assert.deepEqual(buildSparklinePath(series), {
    path: "M4,36 L156,4",
    width: 160,
    height: 40,
  });
});

test("buildSparklinePath flattens an unchanging series to a horizontal mid-line", () => {
  const series = [
    { date: "2026-08-08", stars: 50 },
    { date: "2026-08-10", stars: 50 },
    { date: "2026-08-13", stars: 50 },
  ];
  assert.deepEqual(buildSparklinePath(series), {
    path: "M4,20 L80,20 L156,20",
    width: 160,
    height: 40,
  });
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
