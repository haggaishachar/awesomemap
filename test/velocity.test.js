import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVelocity } from "../scripts/velocity.mjs";

const NOW = "2026-08-08T00:00:00.000Z";

test("computeVelocity reports no history for an empty history array", () => {
  const result = computeVelocity([], 30, { now: NOW });
  assert.equal(result.hasEnoughHistory, false);
  assert.equal(result.starDelta, 0);
  assert.equal(result.percentDelta, 0);
  assert.equal(result.oldestDate, null);
  assert.ok(result.score > 0, "score must stay positive so the treemap never gets a zero/negative weight");
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

test("computeVelocity treats a zero-star baseline as 0% growth rather than dividing by zero", () => {
  const history = [
    { date: "2026-07-09", stars: 0 },
    { date: "2026-08-08", stars: 10 },
  ];
  const result = computeVelocity(history, 30, { now: NOW });
  assert.equal(result.starDelta, 10);
  assert.equal(result.percentDelta, 0);
});
