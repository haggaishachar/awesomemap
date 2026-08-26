import { test } from "node:test";
import assert from "node:assert/strict";
import { STOPWORD_TAGS, MIN_PROJECTS_PER_TAG, isSelfReferential, buildTagGroups } from "../scripts/tag-growth.mjs";

test("STOPWORD_TAGS excludes known GitHub campaign/meta labels", () => {
  assert.ok(STOPWORD_TAGS.has("hacktoberfest"));
  assert.ok(STOPWORD_TAGS.has("open-source"));
  assert.ok(STOPWORD_TAGS.has("awesome"));
});

test("isSelfReferential matches a tag equal to the project's normalized display name", () => {
  assert.equal(isSelfReferential("pandas", { name: "pandas", id: "pandas-dev/pandas" }), true);
  assert.equal(isSelfReferential("sci-kit-learn", { name: "SciKit Learn", id: "scikit-learn/scikit-learn" }), true);
});

test("isSelfReferential matches a tag equal to the repo-name segment of id, even when it differs from the display name", () => {
  assert.equal(isSelfReferential("numpy", { name: "NumPy", id: "numpy/numpy" }), true);
});

test("isSelfReferential is false for a genuine topic tag", () => {
  assert.equal(isSelfReferential("machine-learning", { name: "pandas", id: "pandas-dev/pandas" }), false);
});

test("isSelfReferential is false when project has no name/id to compare against", () => {
  assert.equal(isSelfReferential("python", {}), false);
});

test("buildTagGroups drops stopword tags", () => {
  const projects = [
    { id: "a/a", name: "A", weight: 10, tags: ["hacktoberfest", "python"] },
    { id: "b/b", name: "B", weight: 20, tags: ["python"] },
  ];
  const groups = buildTagGroups(projects);
  assert.deepEqual(groups.map((g) => g.tag), ["python"]);
});

test("buildTagGroups drops a project's self-referential tag but keeps its other tags", () => {
  const projects = [
    { id: "pandas-dev/pandas", name: "pandas", weight: 10, tags: ["pandas", "python"] },
    { id: "b/b", name: "B", weight: 20, tags: ["python"] },
  ];
  const groups = buildTagGroups(projects);
  assert.deepEqual(groups.map((g) => g.tag), ["python"]);
  assert.equal(groups[0].projects.length, 2);
});

test("buildTagGroups drops a tag carried by fewer than MIN_PROJECTS_PER_TAG projects", () => {
  assert.equal(MIN_PROJECTS_PER_TAG, 2);
  const projects = [{ id: "a/a", name: "A", weight: 10, tags: ["rare-tag"] }];
  assert.deepEqual(buildTagGroups(projects), []);
});

test("buildTagGroups lets one project fan out into every tag group it qualifies for", () => {
  const projects = [
    { id: "a/a", name: "A", weight: 10, tags: ["python", "machine-learning"] },
    { id: "b/b", name: "B", weight: 20, tags: ["python"] },
    { id: "c/c", name: "C", weight: 30, tags: ["machine-learning"] },
  ];
  const groups = buildTagGroups(projects);
  const byTag = Object.fromEntries(groups.map((g) => [g.tag, g.projects.map((p) => p.id)]));
  assert.deepEqual(byTag, {
    python: ["a/a", "b/b"],
    "machine-learning": ["a/a", "c/c"],
  });
});

test("buildTagGroups ignores a project with no tags field", () => {
  const projects = [
    { id: "a/a", name: "A", weight: 10 },
    { id: "b/b", name: "B", weight: 20, tags: ["python"] },
    { id: "c/c", name: "C", weight: 30, tags: ["python"] },
  ];
  const groups = buildTagGroups(projects);
  assert.deepEqual(groups.map((g) => g.tag), ["python"]);
});

test("buildTagGroups returns an empty array for an empty project list", () => {
  assert.deepEqual(buildTagGroups([]), []);
});
