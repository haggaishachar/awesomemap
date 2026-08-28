import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeVelocity,
  computeProjectSizing,
  findInvalidSizes,
  RISING_WINDOWS_DAYS,
  SCORE_SMOOTHING_CONSTANT,
} from "../scripts/velocity.mjs";

const NOW = "2026-08-08T00:00:00.000Z";

test("computeVelocity reports no history for an empty history array", () => {
  const result = computeVelocity([], 30, { now: NOW });
  assert.equal(result.hasEnoughHistory, false);
  assert.equal(result.starDelta, 0);
  assert.equal(result.percentDelta, 0);
  assert.equal(result.oldestDate, null);
  assert.equal(result.currentStars, 0);
  assert.ok(result.score > 0, "score must stay positive so the treemap never gets a zero/negative weight");
});

test("computeVelocity reports currentStars as the most recent snapshot's star count", () => {
  const history = [
    { date: "2026-07-09", stars: 100 },
    { date: "2026-08-08", stars: 150 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.currentStars, 150);
});

test("computeVelocity reports currentStars even when history is insufficient for the window", () => {
  const history = [
    { date: "2026-08-01", stars: 100 },
    { date: "2026-08-08", stars: 120 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.hasEnoughHistory, false);
  assert.equal(result.currentStars, 120);
});

test("computeVelocity uses a snapshot exactly at the window boundary", () => {
  const history = [
    { date: "2026-07-09", stars: 100 }, // exactly 30 days before NOW
    { date: "2026-08-08", stars: 150 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.hasEnoughHistory, true);
  assert.equal(result.starDelta, 50);
  assert.equal(result.percentDelta, 50);
});

test("computeVelocity is insufficient for a window longer than the available history, even if a shorter window works", () => {
  const history = [
    { date: "2026-08-01", stars: 100 }, // only 7 days of history before NOW
    { date: "2026-08-08", stars: 120 },
  ];
  assert.equal(computeVelocity(history, 30, { now: NOW }).hasEnoughHistory, false);

  const result7 = computeVelocity(history, 7, { now: NOW });
  assert.equal(result7.hasEnoughHistory, true);
  assert.equal(result7.starDelta, 20);
});

test("computeVelocity resolves to the closest snapshot at or before the window boundary when there's a gap", () => {
  const history = [
    { date: "2026-07-01", stars: 80 },
    { date: "2026-07-05", stars: 90 }, // closest to the cutoff (2026-07-09) without going past it
    { date: "2026-08-08", stars: 150 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.starDelta, 60); // 150 - 90, not 150 - 80
});

test("computeVelocity floors the score at a small positive epsilon for a declining project", () => {
  const history = [
    { date: "2026-07-09", stars: 500 },
    { date: "2026-08-08", stars: 100 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.starDelta, -400);
  assert.ok(result.score > 0, "score must never be zero or negative");
});

test("computeVelocity reports oldestDate as the earliest snapshot's date, even when history is insufficient for the window", () => {
  const history = [
    { date: "2026-08-01", stars: 100 },
    { date: "2026-08-08", stars: 120 },
  ];
  const insufficient = computeVelocity(history, 30, { now: NOW });
  assert.equal(insufficient.hasEnoughHistory, false);
  assert.equal(insufficient.oldestDate, "2026-08-01");

  const sufficient = computeVelocity(history, 7, { now: NOW });
  assert.equal(sufficient.oldestDate, "2026-08-01");
});

test("computeVelocity's score divides by sqrt(currentStars + SCORE_SMOOTHING_CONSTANT), not sqrt(currentStars) alone", () => {
  const history = [
    { date: "2026-07-09", stars: 500 },
    { date: "2026-08-08", stars: 600 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  const expectedScore = 100 / Math.sqrt(600 + SCORE_SMOOTHING_CONSTANT);
  assert.equal(result.score, expectedScore);
});

test("a project with genuinely large absolute growth outscores a tiny project's noisy swing", () => {
  // Without smoothing, 2 -> 6 stars (a 3x move driven by pure noise) can
  // outscore 100,000 -> 100,200 stars (a real, substantial gain), because
  // sqrt(currentStars) shrinks just as fast as the numerator for small
  // counts. The smoothing constant should flip this ordering back.
  const noisy = computeVelocity(
    [
      { date: "2026-07-09", stars: 2 },
      { date: "2026-08-08", stars: 6 },
    ],
    30,
    { now: NOW },
  );
  const realRiser = computeVelocity(
    [
      { date: "2026-07-09", stars: 100000 },
      { date: "2026-08-08", stars: 100200 },
    ],
    30,
    { now: NOW },
  );
  assert.ok(
    realRiser.score > noisy.score,
    `expected real riser (${realRiser.score}) to outscore noise (${noisy.score})`,
  );
});

test("computeVelocity treats a zero-star baseline as 0% growth rather than dividing by zero", () => {
  const history = [
    { date: "2026-07-09", stars: 0 },
    { date: "2026-08-08", stars: 10 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.starDelta, 10);
  assert.equal(result.percentDelta, 0);
});

test("computeProjectSizing builds sizes/hasEnoughHistory/growth for every rising window plus popular", () => {
  const project = { id: "a/a", weight: 1000 };
  const history = [
    { date: "2026-05-10", stars: 700 }, // ~90 days before NOW
    { date: "2026-08-08", stars: 1000 },
  ];
  const result = computeProjectSizing(project, history, { now: NOW });

  assert.equal(result.sizes.popular, 1000);
  for (const windowDays of RISING_WINDOWS_DAYS) {
    const key = `rising${windowDays}`;
    assert.equal(typeof result.sizes[key], "number");
    assert.equal(typeof result.hasEnoughHistory[key], "boolean");
    assert.ok(result.growth[key]);
  }
});

test("computeProjectSizing defaults popular to 1 when the project has no weight", () => {
  const result = computeProjectSizing({ id: "a/a" }, [], { now: NOW });
  assert.equal(result.sizes.popular, 1);
});

test("computeProjectSizing marks every rising window as insufficient when there's no history at all", () => {
  const result = computeProjectSizing({ id: "a/a", weight: 5 }, [], { now: NOW });
  for (const windowDays of RISING_WINDOWS_DAYS) {
    assert.equal(result.hasEnoughHistory[`rising${windowDays}`], false);
  }
});

test("findInvalidSizes flags a project with a non-positive or missing size, and leaves valid projects alone", () => {
  const projects = [
    { id: "good", sizes: { popular: 10, rising7: 0.5, rising30: 0.2, rising90: 0.1 } },
    { id: "bad-zero", sizes: { popular: 0, rising7: 1, rising30: 1, rising90: 1 } },
    { id: "bad-missing", sizes: { popular: 10, rising7: 1, rising30: 1 } },
  ];
  assert.deepEqual(findInvalidSizes(projects), ["bad-zero", "bad-missing"]);
});
