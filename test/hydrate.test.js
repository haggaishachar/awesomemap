import { test } from "node:test";
import assert from "node:assert/strict";
import { hydrateTree } from "../public/shared/hydrate.js";

test("hydrates a leaf id string into a full tool record", () => {
  const tree = { id: "root", name: "Root", children: ["scikit-learn"] };
  const tools = { "scikit-learn": { name: "SciKit Learn", weight: 58000 } };
  const hydrated = hydrateTree(tree, tools);
  assert.deepEqual(hydrated.children[0], {
    id: "scikit-learn",
    name: "SciKit Learn",
    weight: 58000,
  });
});

test("recurses through nested categories", () => {
  const tree = {
    id: "root",
    name: "Root",
    children: [{ id: "ML", name: "Classic ML", children: ["scikit-learn"] }],
  };
  const tools = { "scikit-learn": { name: "SciKit Learn", weight: 58000 } };
  const hydrated = hydrateTree(tree, tools);
  assert.equal(hydrated.children[0].id, "ML");
  assert.equal(hydrated.children[0].children[0].id, "scikit-learn");
});

test("preserves category node fields other than children", () => {
  const tree = { id: "root", name: "Root", children: [] };
  const hydrated = hydrateTree(tree, {});
  assert.equal(hydrated.name, "Root");
});

test("throws when a leaf id is missing from the tools dictionary", () => {
  const tree = { id: "root", name: "Root", children: ["missing-tool"] };
  assert.throws(() => hydrateTree(tree, {}), /Unknown tool id "missing-tool"/);
});

test("throws when a category node has no children array", () => {
  const tree = { id: "root", name: "Root" };
  assert.throws(() => hydrateTree(tree, {}), /missing a children array/);
});
