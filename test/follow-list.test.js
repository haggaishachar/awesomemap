import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getFollowed,
  isFollowed,
  addFollowed,
  removeFollowed,
  toggleFollowed,
  computeChangeSince,
  computeChangesSince,
} from "../app/shared/follow-list.js";

/** Minimal in-memory Storage-shaped fake — avoids depending on a real `localStorage` global existing in the test runner. */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
  };
}

test("getFollowed returns an empty array when nothing is stored", () => {
  assert.deepEqual(getFollowed(fakeStorage()), []);
});

test("getFollowed returns an empty array for corrupted JSON", () => {
  const storage = fakeStorage({ "awesomemap:follows": "not json" });
  assert.deepEqual(getFollowed(storage), []);
});

test("getFollowed filters out malformed entries missing an id or a valid type", () => {
  const storage = fakeStorage({
    "awesomemap:follows": JSON.stringify([{ type: "project", id: "a/a" }, { type: "bogus", id: "x" }, { id: "y" }, null]),
  });
  assert.deepEqual(getFollowed(storage), [{ type: "project", id: "a/a" }]);
});

test("addFollowed adds a new entry, stamping addedAt, and persists it", () => {
  const storage = fakeStorage();
  const result = addFollowed({ type: "project", id: "a/a", name: "Project A", lastSeenStars: 100 }, storage);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "a/a");
  assert.equal(result[0].lastSeenStars, 100);
  assert.equal(typeof result[0].addedAt, "string");
  assert.deepEqual(getFollowed(storage).map((e) => e.id), ["a/a"]);
});

test("addFollowed is a no-op when the same type+id is already followed", () => {
  const storage = fakeStorage({ "awesomemap:follows": JSON.stringify([{ type: "project", id: "a/a", name: "Project A" }]) });
  const result = addFollowed({ type: "project", id: "a/a", name: "Project A" }, storage);
  assert.equal(result.length, 1);
});

test("addFollowed distinguishes a project and a category sharing the same id string", () => {
  const storage = fakeStorage();
  addFollowed({ type: "project", id: "x", name: "Project X" }, storage);
  const result = addFollowed({ type: "category", id: "x", name: "Category X", domainSlug: "automation" }, storage);
  assert.equal(result.length, 2);
});

test("removeFollowed removes a present entry and persists it", () => {
  const storage = fakeStorage({ "awesomemap:follows": JSON.stringify([{ type: "project", id: "a/a" }, { type: "project", id: "b/b" }]) });
  const result = removeFollowed("project", "a/a", storage);
  assert.deepEqual(result.map((e) => e.id), ["b/b"]);
  assert.deepEqual(getFollowed(storage).map((e) => e.id), ["b/b"]);
});

test("removeFollowed is a no-op when the entry isn't present", () => {
  const storage = fakeStorage({ "awesomemap:follows": JSON.stringify([{ type: "project", id: "a/a" }]) });
  const result = removeFollowed("project", "z/z", storage);
  assert.equal(result.length, 1);
});

test("isFollowed reports whether a type+id is currently followed", () => {
  const storage = fakeStorage({ "awesomemap:follows": JSON.stringify([{ type: "project", id: "a/a" }]) });
  assert.equal(isFollowed("project", "a/a", storage), true);
  assert.equal(isFollowed("project", "z/z", storage), false);
  assert.equal(isFollowed("category", "a/a", storage), false);
});

test("toggleFollowed adds when absent, removes when present", () => {
  const storage = fakeStorage();
  const afterAdd = toggleFollowed({ type: "project", id: "a/a", name: "Project A" }, storage);
  assert.equal(afterAdd.length, 1);
  const afterRemove = toggleFollowed({ type: "project", id: "a/a", name: "Project A" }, storage);
  assert.equal(afterRemove.length, 0);
});

test("computeChangeSince reports no change for a project with an unchanged star count", () => {
  const result = computeChangeSince({ type: "project", id: "a/a", lastSeenStars: 100 }, { stars: 100 });
  assert.equal(result.changed, false);
});

test("computeChangeSince reports a change for a project with a different star count, signed", () => {
  const grew = computeChangeSince({ type: "project", id: "a/a", lastSeenStars: 100 }, { stars: 150 });
  assert.equal(grew.changed, true);
  assert.match(grew.message, /\+50 stars/);

  const shrank = computeChangeSince({ type: "project", id: "a/a", lastSeenStars: 100 }, { stars: 90 });
  assert.equal(shrank.changed, true);
  assert.match(shrank.message, /-10 stars/);
});

test("computeChangeSince reports no change when there's no baseline to compare against", () => {
  const result = computeChangeSince({ type: "project", id: "a/a" }, { stars: 150 });
  assert.equal(result.changed, false);
});

test("computeChangeSince reports a change for a category with a different growth rate", () => {
  const result = computeChangeSince({ type: "category", id: "Workflow Automation", lastSeenPercentDelta: 2 }, { percentDelta: 5 });
  assert.equal(result.changed, true);
  assert.match(result.message, /\+5\.0%/);
});

test("computeChangesSince returns only the followed entries that changed", () => {
  const followed = [
    { type: "project", id: "a/a", lastSeenStars: 100 },
    { type: "project", id: "b/b", lastSeenStars: 200 },
  ];
  const currentById = { "project:a/a": { stars: 150 }, "project:b/b": { stars: 200 } };
  const changes = computeChangesSince(followed, currentById);
  assert.deepEqual(changes.map((c) => c.entry.id), ["a/a"]);
});

test("computeChangesSince skips an entry with no known current state", () => {
  const followed = [{ type: "project", id: "a/a", lastSeenStars: 100 }];
  const changes = computeChangesSince(followed, {});
  assert.deepEqual(changes, []);
});
