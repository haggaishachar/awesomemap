import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weightOf,
  buildHierarchy,
  computeLayout,
  projectRect,
} from "../app/shared/layout.js";

test("weightOf returns the leaf's weight when present", () => {
  assert.equal(weightOf({ id: "a", weight: 42 }), 42);
});

test("weightOf defaults a leaf with no weight field to 1", () => {
  assert.equal(weightOf({ id: "a" }), 1);
});

test("weightOf returns 0 for a category node (has children)", () => {
  assert.equal(weightOf({ id: "cat", children: [{ id: "a", weight: 5 }] }), 0);
});

test("buildHierarchy sums leaf weights up through categories", () => {
  const data = {
    id: "root",
    children: [
      { id: "cat", children: [{ id: "a", weight: 10 }, { id: "b", weight: 20 }] },
    ],
  };
  const root = buildHierarchy(data);
  assert.equal(root.value, 30);
  assert.equal(root.children[0].value, 30);
});

test("buildHierarchy defaults missing weight to 1 inside sums", () => {
  const data = { id: "root", children: [{ id: "a" }, { id: "b", weight: 5 }] };
  const root = buildHierarchy(data);
  assert.equal(root.value, 6);
});

test("computeLayout keeps every child's rect inside its parent's rect", () => {
  const data = {
    id: "root",
    children: [
      { id: "cat1", children: [{ id: "a", weight: 10 }, { id: "b", weight: 30 }] },
      { id: "cat2", children: [{ id: "c", weight: 20 }] },
    ],
  };
  const root = computeLayout(buildHierarchy(data), 900, 600);
  assert.equal(root.x0, 0);
  assert.equal(root.y0, 0);
  assert.equal(root.x1, 900);
  assert.equal(root.y1, 600);
  for (const category of root.children) {
    assert.ok(category.x0 >= root.x0 && category.x1 <= root.x1);
    assert.ok(category.y0 >= root.y0 && category.y1 <= root.y1);
    for (const leaf of category.children) {
      assert.ok(leaf.x0 >= category.x0 && leaf.x1 <= category.x1);
      assert.ok(leaf.y0 >= category.y0 && leaf.y1 <= category.y1);
    }
  }
});

test("computeLayout sizes rects roughly proportional to weight", () => {
  const data = { id: "root", children: [{ id: "a", weight: 10 }, { id: "b", weight: 90 }] };
  const root = computeLayout(buildHierarchy(data), 1000, 100);
  const [a, b] = root.children;
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  const ratio = areaB / areaA;
  assert.ok(ratio > 7 && ratio < 11, `expected ~9x, got ${ratio}`);
});

test("projectRect maps the focus rect itself to fill the container", () => {
  const focusRect = { x0: 100, y0: 50, x1: 300, y1: 150 };
  const projected = projectRect(focusRect, focusRect, 800, 400);
  assert.deepEqual(projected, { left: 0, top: 0, width: 800, height: 400 });
});

test("projectRect scales a child rect relative to the focus rect", () => {
  const focusRect = { x0: 0, y0: 0, x1: 200, y1: 100 };
  const childRect = { x0: 100, y0: 0, x1: 200, y1: 100 };
  const projected = projectRect(childRect, focusRect, 400, 200);
  assert.deepEqual(projected, { left: 200, top: 0, width: 200, height: 200 });
});

test("weightOf reads the sizes object for a given sizeKey when present", () => {
  assert.equal(weightOf({ id: "a", weight: 42, sizes: { popular: 42, rising30: 7.5 } }, "rising30"), 7.5);
});

test("weightOf falls back to weight/1 when sizes lacks the requested key", () => {
  assert.equal(weightOf({ id: "a", weight: 42, sizes: { popular: 42 } }, "rising30"), 42);
  assert.equal(weightOf({ id: "a", sizes: {} }, "rising30"), 1);
});

test("buildHierarchy sums using the given sizeKey's sizes value instead of weight", () => {
  const data = {
    id: "root",
    children: [
      {
        id: "cat",
        children: [
          { id: "a", weight: 10, sizes: { popular: 10, rising30: 2 } },
          { id: "b", weight: 20, sizes: { popular: 20, rising30: 8 } },
        ],
      },
    ],
  };
  const root = buildHierarchy(data, "rising30");
  assert.equal(root.value, 10);
});
