import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSignedStars, formatSignedPercent, formatCount, formatGrowthCell } from "../app/shared/compare-format.js";

test("formatSignedStars adds a plus sign and thousands separators for positive deltas", () => {
  assert.equal(formatSignedStars(12400), "+12,400");
});

test("formatSignedStars uses a minus sign for negative deltas", () => {
  assert.equal(formatSignedStars(-340), "−340");
});

test("formatSignedStars has no sign for zero", () => {
  assert.equal(formatSignedStars(0), "0");
});

test("formatSignedPercent uses one decimal above 1%", () => {
  assert.equal(formatSignedPercent(18.4), "+18.4%");
});

test("formatSignedPercent uses two decimals below 1%", () => {
  assert.equal(formatSignedPercent(0.24), "+0.24%");
});

test("formatCount adds thousands separators", () => {
  assert.equal(formatCount(12400), "12,400");
});

test("formatCount returns an em dash for a non-numeric value", () => {
  assert.equal(formatCount(null), "—");
  assert.equal(formatCount(undefined), "—");
});

test("formatGrowthCell combines the star delta and percent when there's enough history", () => {
  const cell = formatGrowthCell({ starDelta: 340, percentDelta: 18.4, oldestDate: "2026-01-01" }, true);
  assert.equal(cell, "+340 (+18.4%)");
});

test("formatGrowthCell reports insufficient history with the tracked-since date", () => {
  const cell = formatGrowthCell({ starDelta: 0, percentDelta: 0, oldestDate: "2026-08-01" }, false);
  assert.equal(cell, "Not enough history yet — first tracked 2026-08-01.");
});

test("formatGrowthCell reports insufficient history with no date available", () => {
  const cell = formatGrowthCell(null, false);
  assert.equal(cell, "Not enough history yet.");
});
