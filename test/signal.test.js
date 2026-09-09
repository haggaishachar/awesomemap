import { test } from "node:test";
import assert from "node:assert/strict";
import { explainSignal } from "../scripts/signal.mjs";

/** Builds one window's growth entry, the shape computeProjectSizing produces. */
function growth(starDelta, percentDelta) {
  return { starDelta, percentDelta, oldestDate: "2026-05-01" };
}

const ALL_TRACKED = { rising7: true, rising30: true, rising90: true };

test("sustained is true when every window shows positive growth", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 5), rising30: growth(200, 20), rising90: growth(500, 60) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, true);
});

test("sustained is false when only the 7-day window is positive (a spike)", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 5), rising30: growth(-10, -1), rising90: growth(500, 60) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, false);
});

test("sustained is null when the 7-day window isn't positive either, even if a longer window is", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(-5, -1), rising30: growth(-10, -1), rising90: growth(500, 60) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, null);
});

// Degraded-history cases: the catalog's own history hasn't reached 90 days
// yet (won't until ~90 days after its first tracked snapshot), and no
// individual project can have rising30/rising90 history before the catalog
// itself does. Before this fix, computeSustained required all three
// RISING_WINDOWS_DAYS windows to have enough history before saying
// anything at all — meaning `sustained` was `null` for literally every
// project on the site for that entire ~90-day ramp-up, since rising90
// never had enough history to satisfy it. See the commit that added these
// tests for the production incident this fixes.

test("sustained is true when the two currently-trackable windows are both positive, even though a longer window has no history yet", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 5), rising30: growth(200, 20), rising90: growth(0, 0) },
    hasEnoughHistory: { rising7: true, rising30: true, rising90: false },
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, true);
});

test("sustained is false (a spike) when the two currently-trackable windows disagree", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 5), rising30: growth(-10, -1), rising90: growth(0, 0) },
    hasEnoughHistory: { rising7: true, rising30: true, rising90: false },
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, false);
});

test("sustained is null when the two currently-trackable windows disagree and the shortest isn't positive either", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(-5, -1), rising30: growth(200, 20), rising90: growth(0, 0) },
    hasEnoughHistory: { rising7: true, rising30: true, rising90: false },
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, null);
});

test("sustained can be false (a spike) from the 7-day window alone, when no longer window is trackable yet", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 5), rising30: growth(0, 0), rising90: growth(0, 0) },
    hasEnoughHistory: { rising7: true, rising30: false, rising90: false },
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, false);
});

test("sustained is null (never 'sustained') from a single tracked window alone, even when it's positive", () => {
  // A single window can distinguish "spike" (false, above) from "nothing to
  // say" (null, here) but can never justify "sustained" — that claim
  // requires at least two windows to agree, or it's indistinguishable from
  // a spike.
  const result = explainSignal({
    growthByWindow: { rising7: growth(-5, -1), rising30: growth(0, 0), rising90: growth(0, 0) },
    hasEnoughHistory: { rising7: true, rising30: false, rising90: false },
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, null);
});

test("sustained is null when no window has enough history at all (e.g. a brand-new project)", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(0, 0), rising30: growth(0, 0), rising90: growth(0, 0) },
    hasEnoughHistory: { rising7: false, rising30: false, rising90: false },
    categoryGrowth7d: undefined,
  });
  assert.equal(result.sustained, null);
});

test("relativeMultiple is the project's 7-day percentDelta divided by the category's", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 2 },
  });
  assert.equal(result.relativeMultiple, 5);
});

test("relativeMultiple is null when the category has no history yet", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: false, percentDelta: 0 },
  });
  assert.equal(result.relativeMultiple, null);
});

test("relativeMultiple is null when the category is flat or shrinking", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: -1 },
  });
  assert.equal(result.relativeMultiple, null);
});

test("relativeMultiple is null when categoryGrowth7d is undefined (e.g. a brand-new category)", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.relativeMultiple, null);
});

test("relativeMultiple is null when the project's own 7-day window isn't tracked", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(0, 0), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: { rising7: false, rising30: true, rising90: true },
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 2 },
  });
  assert.equal(result.relativeMultiple, null);
});

test("relativeMultiple is null when the project's own 7-day growth isn't positive, even if the category is growing", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(-5, -1), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 2 },
  });
  assert.equal(result.relativeMultiple, null);
});

test("headline combines both clauses when both signals are available", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 2 },
    categoryName: "LLM Frameworks",
  });
  assert.equal(result.headline, "Growing steadily, 5.0× faster than LLM Frameworks this week");
});

test("headline uses only the sustained clause when there's no category to compare against", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(50, 10) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.headline, "Growing steadily this week");
});

test("headline combines a sustained clause from two trackable windows with the relative clause, even though a longer window lacks history", () => {
  // Before the fix documented in computeSustained's own comment, this
  // exact shape (rising90 not yet trackable) forced `sustained` to `null`
  // regardless of rising7/rising30's sign, silently dropping the sustained
  // clause here even though both currently-trackable windows agree.
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 10), rising30: growth(50, 10), rising90: growth(0, 0) },
    hasEnoughHistory: { rising7: true, rising30: true, rising90: false },
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 2 },
    categoryName: "LLM Frameworks",
  });
  assert.equal(result.sustained, true);
  assert.equal(result.headline, "Growing steadily, 5.0× faster than LLM Frameworks this week");
});

test("headline reports a plain spike when sustained is false and no category comparison is available", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(50, 5), rising30: growth(-10, -1), rising90: growth(500, 60) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.headline, "Recent spike this week");
});

test("headline is null when neither signal is available", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(-5, -1), rising30: growth(-10, -1), rising90: growth(-500, -60) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: undefined,
  });
  assert.equal(result.headline, null);
});

test("relativeMultiple is null when the project grew slower than its category, even though both are positive", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(2, 1), rising30: growth(2, 1), rising90: growth(2, 1) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 5 },
  });
  assert.equal(result.relativeMultiple, null);
});

test("relativeMultiple is null when the project barely matched its category's growth rate (below the rounding-safe floor)", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(10, 5), rising30: growth(10, 5), rising90: growth(10, 5) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 5 },
  });
  assert.equal(result.relativeMultiple, null);
});

test("relativeMultiple is kept when the multiple is just at the rounding-safe floor", () => {
  const result = explainSignal({
    growthByWindow: { rising7: growth(10, 10.5), rising30: growth(10, 10.5), rising90: growth(10, 10.5) },
    hasEnoughHistory: ALL_TRACKED,
    categoryGrowth7d: { hasEnoughHistory: true, percentDelta: 10 },
  });
  assert.equal(result.relativeMultiple, 1.05);
});
