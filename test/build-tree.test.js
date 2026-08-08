import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree } from "../scripts/build-tree.mjs";

const ROOT = { id: "data-science", name: "Data Science" };

test("groups flat tools by shared single-level path", () => {
  const tools = [
    { id: "scikit-learn", path: ["Classic ML"], name: "SciKit Learn" },
    { id: "xgboost", path: ["Classic ML"], name: "XGBoost" },
  ];
  const tree = buildTree(tools, ROOT);
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].name, "Classic ML");
  assert.deepEqual(
    tree.children[0].children.map((t) => t.id),
    ["scikit-learn", "xgboost"]
  );
});

test("nests multi-level paths correctly", () => {
  const tools = [{ id: "yolo", path: ["Deep Learning", "Computer Vision"], name: "YOLO" }];
  const tree = buildTree(tools, ROOT);
  assert.equal(tree.children[0].name, "Deep Learning");
  assert.equal(tree.children[0].children[0].name, "Computer Vision");
  assert.equal(tree.children[0].children[0].children[0].id, "yolo");
});

test("places a tool with an empty path directly under root", () => {
  const tools = [{ id: "misc-tool", path: [], name: "Misc" }];
  const tree = buildTree(tools, ROOT);
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].id, "misc-tool");
});

test("throws when a tool's path is not an array", () => {
  const tools = [{ id: "bad-tool", path: "Classic ML" }];
  assert.throws(() => buildTree(tools, ROOT), /Tool "bad-tool" has a non-array path/);
});

test("produces a childless root for an empty tools array", () => {
  const tree = buildTree([], ROOT);
  assert.deepEqual(tree, { id: "data-science", name: "Data Science", children: [] });
});

test("defaults a leaf's name to its id and desc to empty string when omitted", () => {
  const tools = [{ id: "mystery-tool", path: ["Misc"] }];
  const tree = buildTree(tools, ROOT);
  const leaf = tree.children[0].children[0];
  assert.equal(leaf.name, "mystery-tool");
  assert.equal(leaf.desc, "");
});

test("does not leak the path field onto the built leaf node", () => {
  const tools = [{ id: "scikit-learn", path: ["Classic ML"], name: "SciKit Learn" }];
  const tree = buildTree(tools, ROOT);
  assert.equal(tree.children[0].children[0].path, undefined);
});

test("carries arbitrary extra leaf fields (e.g. sizes/hasEnoughHistory/growth) through unchanged", () => {
  const tools = [
    {
      id: "scikit-learn",
      path: ["Classic ML"],
      sizes: { popular: 100, rising7: 0.5, rising30: 1.2, rising90: 2.1 },
      hasEnoughHistory: { rising7: true, rising30: true, rising90: false },
      growth: { rising7: { starDelta: 5, percentDelta: 5, oldestDate: "2026-08-01" } },
    },
  ];
  const tree = buildTree(tools, ROOT);
  const leaf = tree.children[0].children[0];
  assert.deepEqual(leaf.sizes, tools[0].sizes);
  assert.deepEqual(leaf.hasEnoughHistory, tools[0].hasEnoughHistory);
  assert.deepEqual(leaf.growth, tools[0].growth);
});
