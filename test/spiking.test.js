// test/spiking.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSpiking, SPIKING_SMOOTHING } from "../scripts/spiking.mjs";

const NOW = "2026-08-15T00:00:00.000Z";
const NOW_MS = new Date(NOW).getTime();
const daysAgo = (n) => new Date(NOW_MS - n * 86_400_000).toISOString().slice(0, 10);

/**
 * `points` maps days-ago -> stars. Today's window reads @0 vs @7 and the
 * prior month @7 vs @36 (35-day cutoff falls between); yesterday's reads @1
 * vs @8 and @8 vs @36.
 */
function project(id, points) {
  return {
    id,
    name: id,
    link: `https://${id}.example`,
    history: Object.entries(points).map(([n, stars]) => ({ date: daysAgo(Number(n)), stars })),
  };
}

const SPIKE = project("spike", { 36: 10000, 8: 10400, 7: 10400, 1: 14000, 0: 15000 }); // d7 4600, prior 100/wk
const STEADY = project("steady", { 36: 10000, 8: 13500, 7: 13600, 1: 14400, 0: 14500 }); // d7 900, prior 900/wk

const domain = (projects, slug = "data-science") => ({ slug, name: slug, projects });

test("computeSpiking ranks by this week's gain over the project's own prior weekly pace", () => {
  const rows = computeSpiking([domain([STEADY, SPIKE])], { scope: "global", now: NOW });
  assert.deepEqual(rows.map((r) => r.id), ["spike", "steady"]);
  assert.equal(rows[0].multiple, 4600 / (100 + SPIKING_SMOOTHING));
  assert.equal(rows[0].priorWeekly, 100);
  assert.equal(rows[0].starDelta, 4600);
  assert.equal(rows[0].tier, "spiking");
  assert.equal(rows[0].rank, 1);
  assert.equal(typeof rows[0].rankDelta, "number");
});

test("computeSpiking requires at least 100 stars gained this week", () => {
  const tiny = project("tiny", { 36: 1000, 8: 1000, 7: 1000, 1: 1050, 0: 1099 }); // d7 99
  assert.deepEqual(computeSpiking([domain([tiny])], { scope: "global", now: NOW }), []);
});

test("computeSpiking requires the gain to be at least 0.5% of current stars (filters big-project jitter)", () => {
  // bootstrap-style: ~10/wk normally, +112 this week on 175k stars — a 11x "multiple" that means nothing.
  const jitter = project("jitter", { 36: 174960, 8: 175000, 7: 175000, 1: 175100, 0: 175112 });
  assert.deepEqual(computeSpiking([domain([jitter])], { scope: "global", now: NOW }), []);
});

test("computeSpiking requires 35 days of history", () => {
  const young = project("young", { 20: 100, 8: 200, 7: 200, 1: 900, 0: 1000 });
  assert.deepEqual(computeSpiking([domain([young])], { scope: "global", now: NOW }), []);
});

test("computeSpiking treats a negative prior month as zero pace, giving a finite multiple", () => {
  const recovering = project("recovering", { 36: 5000, 8: 4800, 7: 4800, 1: 5200, 0: 5300 }); // prior -50/wk, d7 500
  const [row] = computeSpiking([domain([recovering])], { scope: "global", now: NOW });
  assert.equal(row.multiple, 500 / SPIKING_SMOOTHING);
  assert.ok(Number.isFinite(row.multiple));
});

test("computeSpiking excludes projects the anomaly guard flags", () => {
  const anomaly = project("anomaly", { 36: 10000, 8: 10000, 7: 10000, 1: 20000, 0: 20500 }); // +105% on 10k
  assert.deepEqual(computeSpiking([domain([anomaly])], { scope: "global", now: NOW }), []);
});

test("computeSpiking dedupes a project listed in two domains for the global scope, and scopes to one domain otherwise", () => {
  const domains = [domain([SPIKE, STEADY]), domain([SPIKE], "security")];
  assert.deepEqual(computeSpiking(domains, { scope: "global", now: NOW }).map((r) => r.id), ["spike", "steady"]);
  assert.deepEqual(computeSpiking(domains, { scope: "security", now: NOW }).map((r) => r.id), ["spike"]);
});

test("computeSpiking shows a spike on the day it happens (no prior-day eligibility needed), with rankDelta 0", () => {
  const fresh = project("fresh", { 36: 2000, 8: 2000, 7: 2000, 1: 2000, 0: 2600 }); // flat, then +600 today: 30x its usual pace
  const rows = computeSpiking([domain([STEADY, SPIKE, fresh])], { scope: "global", now: NOW });
  assert.deepEqual(rows.map((r) => r.id), ["spike", "fresh", "steady"]);
  const freshRow = rows.find((r) => r.id === "fresh");
  assert.equal(freshRow.multiple, 600 / SPIKING_SMOOTHING);
  assert.equal(freshRow.rankDelta, 0);
  assert.equal(freshRow.rank, 2);
});
