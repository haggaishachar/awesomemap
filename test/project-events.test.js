import { test } from "node:test";
import assert from "node:assert/strict";
import { sortedEvents, pickReasonEvent, mentionsProject, withTrustedEvents } from "../scripts/project-events.mjs";

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

test("mentionsProject accepts text naming the repo id or its owner, and rejects a bare name match", () => {
  const entity = { id: "affaan-m/ECC", name: "ECC" };
  assert.equal(mentionsProject(entity, "https://github.com/affaan-m/ECC"), true);
  assert.equal(mentionsProject(entity, "ECC by Affaan M"), true);
  assert.equal(mentionsProject(entity, "Why DDR5 does NOT have ECC"), false);
});

test("mentionsProject matches an owner without its org suffix, but never an owner that is just the repo name", () => {
  assert.equal(mentionsProject({ id: "heygen-com/hyperframes", name: "hyperframes" }, "Launch Videos - HyperFrames https://hyperframes.heygen.com/"), true);
  assert.equal(mentionsProject({ id: "ollama/ollama", name: "Ollama" }, "Ollama launches"), false);
});

test("withTrustedEvents drops awesomemap.dev self-links and returns the same entity when nothing is dropped", () => {
  const selfLink = { date: "2026-10-01", type: "blog", title: "hello-agents - awesomemap", url: "https://awesomemap.dev/projects/datawhalechina/hello-agents" };
  const entity = { id: "datawhalechina/hello-agents", name: "hello-agents", events: [selfLink] };
  assert.deepEqual(withTrustedEvents(entity).events, []);
  const clean = { id: "a/b", events: [{ date: "2026-10-01", type: "hn", title: "x", url: "https://news.ycombinator.com/item?id=2" }] };
  assert.equal(withTrustedEvents(clean), clean);
  assert.equal(withTrustedEvents({ id: "a/b" }).events, undefined);
});
