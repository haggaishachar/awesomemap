import { test } from "node:test";
import assert from "node:assert/strict";
import { sortedEvents, pickReasonEvent } from "../scripts/project-events.mjs";

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

test("pickReasonEvent returns null when no events fall on or after the cutoff date", () => {
  const events = [{ date: "2026-01-01", type: "hn", title: "old", url: "u", points: 500 }];
  assert.equal(pickReasonEvent(events, "2026-08-01"), null);
});

test("pickReasonEvent returns null for a project with no events array", () => {
  assert.equal(pickReasonEvent(undefined, "2026-08-01"), null);
});

test("pickReasonEvent returns the single in-window event when there's only one", () => {
  const events = [{ date: "2026-08-05", type: "reddit", title: "t", url: "u", points: 40 }];
  assert.deepEqual(pickReasonEvent(events, "2026-08-01"), events[0]);
});

test("pickReasonEvent picks the highest-points event among several in-window, ignoring an out-of-window event even if it scored higher", () => {
  const events = [
    { date: "2026-08-02", type: "hn", title: "small", url: "u1", points: 60 },
    { date: "2026-08-05", type: "producthunt", title: "big", url: "u2", points: 200 },
    { date: "2026-07-01", type: "reddit", title: "out of window", url: "u3", points: 9000 },
  ];
  assert.deepEqual(pickReasonEvent(events, "2026-08-01"), events[1]);
});

test("pickReasonEvent falls back to a points-less blog event when it's the only one in-window", () => {
  const events = [{ date: "2026-08-03", type: "blog", title: "launch post", url: "u" }];
  assert.deepEqual(pickReasonEvent(events, "2026-08-01"), events[0]);
});

test("pickReasonEvent prefers a pointed event over a points-less blog event in-window", () => {
  const events = [
    { date: "2026-08-03", type: "blog", title: "launch post", url: "u1" },
    { date: "2026-08-04", type: "hn", title: "hn thread", url: "u2", points: 10 },
  ];
  assert.deepEqual(pickReasonEvent(events, "2026-08-01"), events[1]);
});
