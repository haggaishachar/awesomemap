import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STOPWORD_TAGS,
  MIN_PROJECTS_PER_TAG,
  MIN_TRACKED_PROJECTS_FOR_RISING,
  isSelfReferential,
  buildTagGroups,
  computeTopTags,
  computeRisingTags,
} from "../scripts/tag-growth.mjs";

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

test("computeTopTags ranks by total stars descending and stamps 1-based ranks", () => {
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 100, tags: ["x"] },
    { id: "b/b", name: "B", weight: 50, tags: ["x"] },
    { id: "c/c", name: "C", weight: 40, tags: ["y"] },
    { id: "d/d", name: "D", weight: 40, tags: ["y"] },
  ]);
  const ranked = computeTopTags(groups);
  assert.deepEqual(ranked.map((r) => r.tag), ["x", "y"]);
  assert.equal(ranked[0].totalStars, 150);
  assert.equal(ranked[0].projectCount, 2);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
});

test("computeTopTags breaks a totalStars tie by project count, then alphabetically by tag", () => {
  const groups = [
    { tag: "b-tag", projects: [{ id: "1", weight: 10 }, { id: "2", weight: 10 }] },
    { tag: "a-tag", projects: [{ id: "3", weight: 20 }] },
  ];
  const ranked = computeTopTags(groups);
  assert.deepEqual(ranked.map((r) => r.tag), ["b-tag", "a-tag"], "same totalStars (20) — higher project count wins");
});

test("computeTopTags respects limit", () => {
  const groups = [
    { tag: "a", projects: [{ id: "1", weight: 30 }] },
    { tag: "b", projects: [{ id: "2", weight: 20 }] },
    { tag: "c", projects: [{ id: "3", weight: 10 }] },
  ];
  assert.equal(computeTopTags(groups, { limit: 2 }).length, 2);
  assert.equal(computeTopTags(groups).length, 3, "no limit means every group");
});

test("computeTopTags treats a project with no weight as 0 stars rather than NaN", () => {
  const groups = [{ tag: "a", projects: [{ id: "1" }, { id: "2" }] }];
  const ranked = computeTopTags(groups);
  assert.equal(ranked[0].totalStars, 0);
  assert.ok(Number.isFinite(ranked[0].totalStars));
});

test("computeTopTags returns an empty array for no groups", () => {
  assert.deepEqual(computeTopTags([]), []);
});

const NOW = "2026-08-08T00:00:00.000Z";

/** Builds a 7-day-spanning history for a project that went `from` -> `to` stars. */
function history(from, to) {
  return [
    { date: "2026-08-01", stars: from },
    { date: "2026-08-08", stars: to },
  ];
}

test("computeRisingTags ranks eligible tag groups by percent growth descending", () => {
  // Each group needs at least MIN_TRACKED_PROJECTS_FOR_RISING (4) tracked
  // projects to be eligible at all — see the dedicated floor test below.
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 1100, tags: ["fast"] },
    { id: "b/b", name: "B", weight: 1050, tags: ["fast"] },
    { id: "e/e", name: "E", weight: 1100, tags: ["fast"] },
    { id: "f/f", name: "F", weight: 1050, tags: ["fast"] },
    { id: "c/c", name: "C", weight: 2020, tags: ["slow"] },
    { id: "d/d", name: "D", weight: 2000, tags: ["slow"] },
    { id: "g/g", name: "G", weight: 2020, tags: ["slow"] },
    { id: "h/h", name: "H", weight: 2000, tags: ["slow"] },
  ]);
  const historyById = {
    "a/a": history(1000, 1100),
    "b/b": history(1000, 1050),
    "e/e": history(1000, 1100),
    "f/f": history(1000, 1050),
    "c/c": history(2000, 2020),
    "d/d": history(2000, 2000),
    "g/g": history(2000, 2020),
    "h/h": history(2000, 2000),
  };
  const ranked = computeRisingTags(groups, historyById, 7, { now: NOW });
  assert.deepEqual(ranked.map((r) => r.tag), ["fast", "slow"]);
  assert.ok(ranked[0].growth.percentDelta > ranked[1].growth.percentDelta);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
});

test("computeRisingTags excludes a tag group with no net growth, even if tracked", () => {
  // "Rising" must never show a flat or shrinking entry — same rule
  // leaderboard.mjs applies to individual projects.
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 900, tags: ["flat"] },
    { id: "b/b", name: "B", weight: 900, tags: ["flat"] },
  ]);
  const historyById = { "a/a": history(1000, 900), "b/b": history(1000, 900) };
  assert.deepEqual(computeRisingTags(groups, historyById, 7, { now: NOW }), []);
});

test("computeRisingTags excludes a tag group without enough history", () => {
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 1100, tags: ["new"] },
    { id: "b/b", name: "B", weight: 1050, tags: ["new"] },
  ]);
  assert.deepEqual(computeRisingTags(groups, {}, 7, { now: NOW }), []);
});

test("computeRisingTags carries projectCount/totalStars alongside the growth stat", () => {
  // Needs at least MIN_TRACKED_PROJECTS_FOR_RISING (4) tracked projects to
  // be eligible — see the dedicated floor test below.
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 1100, tags: ["fast"] },
    { id: "b/b", name: "B", weight: 1050, tags: ["fast"] },
    { id: "e/e", name: "E", weight: 1100, tags: ["fast"] },
    { id: "f/f", name: "F", weight: 1050, tags: ["fast"] },
  ]);
  const historyById = {
    "a/a": history(1000, 1100),
    "b/b": history(1000, 1050),
    "e/e": history(1000, 1100),
    "f/f": history(1000, 1050),
  };
  const ranked = computeRisingTags(groups, historyById, 7, { now: NOW });
  assert.equal(ranked[0].projectCount, 4);
  assert.equal(ranked[0].totalStars, 4300);
});

test("computeRisingTags respects limit", () => {
  // Each group needs at least MIN_TRACKED_PROJECTS_FOR_RISING (4) tracked
  // projects to be eligible — see the dedicated floor test below.
  const groups = buildTagGroups([
    { id: "a/a", name: "A", weight: 1100, tags: ["fast"] },
    { id: "b/b", name: "B", weight: 1050, tags: ["fast"] },
    { id: "e/e", name: "E", weight: 1100, tags: ["fast"] },
    { id: "f/f", name: "F", weight: 1050, tags: ["fast"] },
    { id: "c/c", name: "C", weight: 2200, tags: ["also-fast"] },
    { id: "d/d", name: "D", weight: 2100, tags: ["also-fast"] },
    { id: "g/g", name: "G", weight: 2200, tags: ["also-fast"] },
    { id: "h/h", name: "H", weight: 2100, tags: ["also-fast"] },
  ]);
  const historyById = {
    "a/a": history(1000, 1100),
    "b/b": history(1000, 1050),
    "e/e": history(1000, 1100),
    "f/f": history(1000, 1050),
    "c/c": history(2000, 2200),
    "d/d": history(2000, 2100),
    "g/g": history(2000, 2200),
    "h/h": history(2000, 2100),
  };
  assert.equal(computeRisingTags(groups, historyById, 7, { now: NOW, limit: 1 }).length, 1);
});

test("computeRisingTags requires at least MIN_TRACKED_PROJECTS_FOR_RISING tracked projects, even if otherwise eligible", () => {
  assert.equal(MIN_TRACKED_PROJECTS_FOR_RISING, 4);

  // Only 2 tracked projects — passes MIN_PROJECTS_PER_TAG and would
  // otherwise be "rising," but shouldn't clear the stricter floor.
  const smallGroup = buildTagGroups([
    { id: "a/a", name: "A", weight: 1100, tags: ["small"] },
    { id: "b/b", name: "B", weight: 1050, tags: ["small"] },
  ]);
  const smallHistory = { "a/a": history(1000, 1100), "b/b": history(1000, 1050) };
  assert.deepEqual(computeRisingTags(smallGroup, smallHistory, 7, { now: NOW }), []);

  // 4 tracked projects, same shape otherwise — should qualify.
  const bigGroup = buildTagGroups([
    { id: "a/a", name: "A", weight: 1100, tags: ["big"] },
    { id: "b/b", name: "B", weight: 1050, tags: ["big"] },
    { id: "c/c", name: "C", weight: 2200, tags: ["big"] },
    { id: "d/d", name: "D", weight: 2100, tags: ["big"] },
  ]);
  const bigHistory = {
    "a/a": history(1000, 1100),
    "b/b": history(1000, 1050),
    "c/c": history(2000, 2200),
    "d/d": history(2000, 2100),
  };
  const ranked = computeRisingTags(bigGroup, bigHistory, 7, { now: NOW });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].tag, "big");
});
