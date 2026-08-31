import { test } from "node:test";
import assert from "node:assert/strict";
import { routeCandidate, selectAutoCommit, updateSeenIds } from "../scripts/apply-discoveries.mjs";

test("routeCandidate returns drop for a confirmed non-fit", () => {
  assert.equal(routeCandidate({ fits: false, confidence: 0.9 }), "drop");
});

test("routeCandidate returns qualifies for a fit into an existing category, at any confidence", () => {
  assert.equal(routeCandidate({ fits: true, confidence: 0.9, suggestedNewCategory: null }), "qualifies");
  assert.equal(routeCandidate({ fits: true, confidence: 0.1, suggestedNewCategory: null }), "qualifies");
});

test("routeCandidate returns qualifies when a new category is suggested", () => {
  assert.equal(routeCandidate({ fits: true, confidence: 0.95, suggestedNewCategory: "Fine-Tuning Tools" }), "qualifies");
});

test("routeCandidate returns drop for an unparseable classification (fits: null)", () => {
  assert.equal(routeCandidate({ fits: null, confidence: 0 }), "drop");
});

test("selectAutoCommit auto-commits every qualifying candidate, uncapped, sorted by confidence descending", () => {
  const classified = [
    { id: "a/a", fits: true, path: ["Cat"], confidence: 0.85, suggestedNewCategory: null },
    { id: "b/b", fits: true, path: ["Cat"], confidence: 0.95, suggestedNewCategory: null },
    { id: "c/c", fits: true, path: ["Cat"], confidence: 0.9, suggestedNewCategory: null },
  ];

  const autoCommit = selectAutoCommit(classified);

  assert.deepEqual(autoCommit.map((c) => c.id), ["b/b", "c/c", "a/a"]);
});

test("selectAutoCommit resolves a suggestedNewCategory into a one-element path when no existing path matched", () => {
  const classified = [{ id: "a/a", fits: true, path: null, confidence: 0.9, suggestedNewCategory: "New Category" }];

  const autoCommit = selectAutoCommit(classified);

  assert.deepEqual(autoCommit, [{ id: "a/a", fits: true, path: ["New Category"], confidence: 0.9, suggestedNewCategory: "New Category" }]);
});

test("selectAutoCommit prefers an existing path over suggestedNewCategory when both are present", () => {
  const classified = [{ id: "a/a", fits: true, path: ["Existing"], confidence: 0.9, suggestedNewCategory: "New Category" }];

  assert.deepEqual(selectAutoCommit(classified)[0].path, ["Existing"]);
});

test("selectAutoCommit excludes dropped (fits: false or null) candidates", () => {
  const classified = [
    { id: "a/a", fits: false, path: null, confidence: 0.9, suggestedNewCategory: null },
    { id: "b/b", fits: null, path: null, confidence: 0, suggestedNewCategory: null },
  ];
  assert.deepEqual(selectAutoCommit(classified), []);
});

test("updateSeenIds returns the deduped union of existing and today's ids, preserving first-seen order", () => {
  assert.deepEqual(updateSeenIds(["a/a", "b/b"], ["b/b", "c/c"]), ["a/a", "b/b", "c/c"]);
});

test("updateSeenIds returns existing ids unchanged when today's list is empty", () => {
  assert.deepEqual(updateSeenIds(["a/a"], []), ["a/a"]);
});
