import { test } from "node:test";
import assert from "node:assert/strict";
import { routeCandidate, selectAutoCommit, formatReviewIssueBody, updateSeenIds } from "../scripts/apply-discoveries.mjs";

test("routeCandidate returns drop for a confirmed non-fit", () => {
  assert.equal(routeCandidate({ fits: false, confidence: 0.9 }), "drop");
});

test("routeCandidate returns qualifies for a confident fit into an existing category", () => {
  assert.equal(routeCandidate({ fits: true, confidence: 0.9, suggestedNewCategory: null }), "qualifies");
});

test("routeCandidate returns needsReview for a low-confidence fit", () => {
  assert.equal(routeCandidate({ fits: true, confidence: 0.5, suggestedNewCategory: null }, { minConfidence: 0.8 }), "needsReview");
});

test("routeCandidate returns needsReview when a new category is suggested, even at high confidence", () => {
  assert.equal(routeCandidate({ fits: true, confidence: 0.95, suggestedNewCategory: "Fine-Tuning Tools" }), "needsReview");
});

test("routeCandidate returns needsReview for an unparseable classification (fits: null)", () => {
  assert.equal(routeCandidate({ fits: null, confidence: 0 }), "needsReview");
});

test("selectAutoCommit auto-commits qualifying candidates up to dailyCap, sorted by confidence descending", () => {
  const classified = [
    { id: "a/a", fits: true, confidence: 0.85, suggestedNewCategory: null },
    { id: "b/b", fits: true, confidence: 0.95, suggestedNewCategory: null },
    { id: "c/c", fits: true, confidence: 0.9, suggestedNewCategory: null },
  ];

  const { autoCommit, pending } = selectAutoCommit(classified, { minConfidence: 0.8, dailyCap: 2 });

  assert.deepEqual(autoCommit.map((c) => c.id), ["b/b", "c/c"]);
  assert.deepEqual(pending.map((c) => c.id), ["a/a"]);
});

test("selectAutoCommit routes needsReview candidates to pending alongside cap overflow", () => {
  const classified = [
    { id: "a/a", fits: true, confidence: 0.95, suggestedNewCategory: null },
    { id: "b/b", fits: true, confidence: 0.5, suggestedNewCategory: null },
    { id: "c/c", fits: true, confidence: 0.9, suggestedNewCategory: "New Category" },
  ];

  const { autoCommit, pending } = selectAutoCommit(classified, { minConfidence: 0.8, dailyCap: 5 });

  assert.deepEqual(autoCommit.map((c) => c.id), ["a/a"]);
  assert.deepEqual(new Set(pending.map((c) => c.id)), new Set(["b/b", "c/c"]));
});

test("selectAutoCommit excludes drop candidates from both lists", () => {
  const classified = [{ id: "a/a", fits: false, confidence: 0.9, suggestedNewCategory: null }];
  const { autoCommit, pending } = selectAutoCommit(classified);
  assert.deepEqual(autoCommit, []);
  assert.deepEqual(pending, []);
});

test("formatReviewIssueBody lists each domain's pending candidates with placement, confidence, and reason", () => {
  const pendingByDomain = {
    "artificial-intelligence": [
      { id: "foo/bar", stars: 1200, path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"], suggestedNewCategory: null, confidence: 0.6, reason: "uncertain fit" },
    ],
  };

  const body = formatReviewIssueBody(pendingByDomain, "2026-08-25");

  assert.match(body, /artificial-intelligence/);
  assert.match(body, /foo\/bar/);
  assert.match(body, /1200 stars/);
  assert.match(body, /LLM Infrastructure \/ LLM Frameworks & Runtimes/);
  assert.match(body, /60%/);
  assert.match(body, /uncertain fit/);
});

test("formatReviewIssueBody shows a suggested new category when path is absent", () => {
  const pendingByDomain = {
    "artificial-intelligence": [{ id: "foo/bar", stars: 800, path: null, suggestedNewCategory: "Fine-Tuning Tools", confidence: 0.7, reason: "no category fits" }],
  };

  assert.match(formatReviewIssueBody(pendingByDomain, "2026-08-25"), /suggests new category: "Fine-Tuning Tools"/);
});

test("formatReviewIssueBody returns a placeholder message when nothing is pending", () => {
  assert.equal(formatReviewIssueBody({}, "2026-08-25"), "No discovery candidates need review for 2026-08-25.");
});

test("formatReviewIssueBody skips a domain whose pending list is empty", () => {
  assert.equal(formatReviewIssueBody({ "web-dev": [] }, "2026-08-25"), "No discovery candidates need review for 2026-08-25.");
});

test("updateSeenIds returns the deduped union of existing and today's ids, preserving first-seen order", () => {
  assert.deepEqual(updateSeenIds(["a/a", "b/b"], ["b/b", "c/c"]), ["a/a", "b/b", "c/c"]);
});

test("updateSeenIds returns existing ids unchanged when today's list is empty", () => {
  assert.deepEqual(updateSeenIds(["a/a"], []), ["a/a"]);
});
