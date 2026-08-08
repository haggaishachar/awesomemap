import { test } from "node:test";
import assert from "node:assert/strict";
import { appendSnapshotEntry, pruneOldEntries } from "../scripts/snapshot-history.mjs";

test("appendSnapshotEntry appends a new day's entry, keeping entries sorted by date", () => {
  const entries = [{ date: "2026-08-06", stars: 100 }];
  const result = appendSnapshotEntry(entries, { date: "2026-08-07", stars: 110 });
  assert.deepEqual(result, [
    { date: "2026-08-06", stars: 100 },
    { date: "2026-08-07", stars: 110 },
  ]);
});

test("appendSnapshotEntry replaces (not duplicates) an existing same-date entry", () => {
  const entries = [
    { date: "2026-08-06", stars: 100 },
    { date: "2026-08-07", stars: 110 },
  ];
  const result = appendSnapshotEntry(entries, { date: "2026-08-07", stars: 115 });
  assert.deepEqual(result, [
    { date: "2026-08-06", stars: 100 },
    { date: "2026-08-07", stars: 115 },
  ]);
});

test("appendSnapshotEntry sorts an out-of-order insert into place", () => {
  const entries = [{ date: "2026-08-07", stars: 110 }];
  const result = appendSnapshotEntry(entries, { date: "2026-08-01", stars: 90 });
  assert.deepEqual(result, [
    { date: "2026-08-01", stars: 90 },
    { date: "2026-08-07", stars: 110 },
  ]);
});

test("pruneOldEntries drops entries older than maxAgeDays relative to now", () => {
  const entries = [
    { date: "2026-01-01", stars: 10 }, // way older than 120 days before NOW below
    { date: "2026-05-01", stars: 50 },
    { date: "2026-08-08", stars: 100 },
  ];
  const result = pruneOldEntries(entries, { now: "2026-08-08T00:00:00.000Z", maxAgeDays: 120 });
  assert.deepEqual(result, [
    { date: "2026-05-01", stars: 50 },
    { date: "2026-08-08", stars: 100 },
  ]);
});

test("pruneOldEntries keeps an entry exactly at the maxAgeDays boundary", () => {
  const entries = [
    { date: "2026-04-10", stars: 40 }, // exactly 120 days before NOW below
    { date: "2026-08-08", stars: 100 },
  ];
  const result = pruneOldEntries(entries, { now: "2026-08-08T00:00:00.000Z", maxAgeDays: 120 });
  assert.deepEqual(result, entries);
});
