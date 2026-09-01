import { test } from "node:test";
import assert from "node:assert/strict";
import { rankProjects } from "../app/shared/search-match.js";

const REACT = { id: "facebook/react", name: "React", tags: ["ui", "frontend"], desc: "A JS library for building UIs.", weight: 200000 };
const REACT_NATIVE = { id: "facebook/react-native", name: "React Native", tags: ["mobile"], desc: "Build native apps with React.", weight: 100000 };
const VUE = { id: "vuejs/vue", name: "Vue.js", tags: ["ui", "frontend"], desc: "The progressive JavaScript framework.", weight: 150000 };
const RECORDS = [REACT, REACT_NATIVE, VUE];

test("rankProjects returns [] for a blank query", () => {
  assert.deepEqual(rankProjects(RECORDS, ""), []);
  assert.deepEqual(rankProjects(RECORDS, "   "), []);
});

test("rankProjects is case-insensitive", () => {
  const results = rankProjects(RECORDS, "REACT");
  assert.deepEqual(results.map((r) => r.id), ["facebook/react", "facebook/react-native"]);
});

test("rankProjects ranks an exact name match above a prefix match", () => {
  const results = rankProjects(RECORDS, "react");
  assert.equal(results[0].id, "facebook/react");
  assert.equal(results[1].id, "facebook/react-native");
});

test("rankProjects matches by tag", () => {
  const results = rankProjects(RECORDS, "frontend");
  assert.deepEqual(
    results.map((r) => r.id).sort(),
    ["facebook/react", "vuejs/vue"].sort(),
  );
});

test("rankProjects matches by description when nothing else matches", () => {
  const results = rankProjects(RECORDS, "progressive");
  assert.deepEqual(results.map((r) => r.id), ["vuejs/vue"]);
});

test("rankProjects breaks ties between equally-ranked matches by star count", () => {
  // Both have an exact "ui" tag, so both score the same — the tie is
  // broken by weight (star count) descending.
  const results = rankProjects([VUE, REACT], "ui");
  assert.deepEqual(results.map((r) => r.id), ["facebook/react", "vuejs/vue"]);
});

test("rankProjects excludes non-matching records entirely", () => {
  const results = rankProjects(RECORDS, "django");
  assert.deepEqual(results, []);
});
