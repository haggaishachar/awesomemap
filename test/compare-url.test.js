import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCompareIds, formatCompareIds, normalizeProjectId, MAX_COMPARE_IDS } from "../app/shared/compare-url.js";

test("parseCompareIds returns an empty array for an empty query string", () => {
  assert.deepEqual(parseCompareIds(new URLSearchParams("")), []);
});

test("parseCompareIds reads repeated id params in order", () => {
  const ids = parseCompareIds(new URLSearchParams("id=facebook%2Freact&id=vuejs%2Fcore"));
  assert.deepEqual(ids, ["facebook/react", "vuejs/core"]);
});

test("parseCompareIds dedups repeated ids", () => {
  const ids = parseCompareIds(new URLSearchParams("id=a%2Fb&id=a%2Fb"));
  assert.deepEqual(ids, ["a/b"]);
});

test("parseCompareIds drops ids beyond the cap", () => {
  const params = new URLSearchParams();
  for (let i = 0; i < MAX_COMPARE_IDS + 2; i++) params.append("id", `owner/repo-${i}`);
  const ids = parseCompareIds(params);
  assert.equal(ids.length, MAX_COMPARE_IDS);
  assert.deepEqual(ids, ["owner/repo-0", "owner/repo-1", "owner/repo-2", "owner/repo-3"]);
});

test("formatCompareIds returns an empty string for an empty list", () => {
  assert.equal(formatCompareIds([]), "");
});

test("round-trips ids containing a literal slash through format then parse", () => {
  const original = ["facebook/react", "vuejs/core"];
  const query = formatCompareIds(original);
  const parsed = parseCompareIds(new URLSearchParams(query.slice(1)));
  assert.deepEqual(parsed, original);
});

test("normalizeProjectId trims whitespace and a trailing slash", () => {
  assert.equal(normalizeProjectId("  facebook/react/  "), "facebook/react");
});

test("normalizeProjectId strips a github.com URL prefix", () => {
  assert.equal(normalizeProjectId("https://github.com/facebook/react"), "facebook/react");
});

test("normalizeProjectId leaves a bare id unchanged", () => {
  assert.equal(normalizeProjectId("facebook/react"), "facebook/react");
});
