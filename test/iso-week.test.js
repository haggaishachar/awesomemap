import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekLabel, isoWeekBounds, currentIsoWeek } from "../scripts/iso-week.mjs";

test("isoWeekLabel returns the ISO week for a mid-week date", () => {
  // 2026-09-24 is a Thursday in ISO week 39.
  assert.equal(isoWeekLabel(new Date("2026-09-24T12:00:00.000Z")), "2026-W39");
});

test("isoWeekLabel is stable across every day of the same ISO week", () => {
  const monday = new Date("2026-09-21T00:00:00.000Z");
  const sunday = new Date("2026-09-27T23:59:59.999Z");
  assert.equal(isoWeekLabel(monday), "2026-W39");
  assert.equal(isoWeekLabel(sunday), "2026-W39");
});

test("isoWeekLabel handles a year boundary where the ISO week-year differs from the calendar year", () => {
  // 2025-12-29 is a Monday; it starts ISO week 1 of 2026.
  assert.equal(isoWeekLabel(new Date("2025-12-29T00:00:00.000Z")), "2026-W01");
  // 2027-01-01 is a Friday, still part of ISO week 53 of 2026.
  assert.equal(isoWeekLabel(new Date("2027-01-01T00:00:00.000Z")), "2026-W53");
});

test("isoWeekBounds returns Monday 00:00:00.000 through Sunday 23:59:59.999 UTC", () => {
  const { start, end } = isoWeekBounds("2026-W39");
  assert.equal(start.toISOString(), "2026-09-21T00:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-27T23:59:59.999Z");
});

test("isoWeekBounds and isoWeekLabel round-trip", () => {
  const { start } = isoWeekBounds("2026-W39");
  assert.equal(isoWeekLabel(start), "2026-W39");
});

test("isoWeekBounds throws on a malformed label", () => {
  assert.throws(() => isoWeekBounds("not-a-week"));
});

test("currentIsoWeek defaults to now and accepts an explicit date", () => {
  assert.equal(currentIsoWeek(new Date("2026-09-24T12:00:00.000Z")), "2026-W39");
  assert.equal(typeof currentIsoWeek(), "string");
});
