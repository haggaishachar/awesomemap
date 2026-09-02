import { test } from "node:test";
import assert from "node:assert/strict";
import { sortedEvents } from "../scripts/project-events.mjs";

test("sortedEvents sorts an out-of-order events array oldest-first", () => {
  const events = [
    { date: "2026-08-07", type: "release", title: "v2.0" },
    { date: "2026-01-15", type: "hn", title: "Show HN: thing" },
  ];
  assert.deepEqual(sortedEvents(events), [
    { date: "2026-01-15", type: "hn", title: "Show HN: thing" },
    { date: "2026-08-07", type: "release", title: "v2.0" },
  ]);
});

test("sortedEvents returns [] for a project with no events array", () => {
  assert.deepEqual(sortedEvents(undefined), []);
});

test("sortedEvents returns [] when given something other than an array", () => {
  assert.deepEqual(sortedEvents("not an array"), []);
});
