import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weightOf,
  buildHierarchy,
  computeLayout,
  estimateCapacity,
  selectTopWithOthers,
  buildOthersNode,
  computeLevelBoxes,
  computeStageSize,
  leafAriaLabel,
  categoryAriaLabel,
  othersAriaLabel,
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

test("estimateCapacity floors area divided by minimum item area", () => {
  assert.equal(estimateCapacity(10000, 2500), 4);
  assert.equal(estimateCapacity(10001, 2500), 4);
});

test("estimateCapacity never returns less than 1", () => {
  assert.equal(estimateCapacity(100, 2500), 1);
  assert.equal(estimateCapacity(0, 2500), 1);
  assert.equal(estimateCapacity(-5, 2500), 1);
});

function weighted(id, value) {
  return { value, data: { id, name: id } };
}

test("selectTopWithOthers passes through every child when at or under capacity", () => {
  const children = [weighted("a", 10), weighted("b", 20)];
  const result = selectTopWithOthers(children, 5);
  assert.equal(result.visible.length, 2);
  assert.equal(result.othersCount, 0);
  assert.equal(result.othersWeight, 0);
  assert.deepEqual(result.othersChildren, []);
});

test("selectTopWithOthers keeps the top (capacity - 1) by weight and buckets the rest into Others", () => {
  const children = [weighted("a", 100), weighted("b", 50), weighted("c", 10), weighted("d", 1)];
  const result = selectTopWithOthers(children, 3);
  assert.deepEqual(result.visible.map((c) => c.data.id), ["a", "b"]);
  assert.equal(result.othersCount, 2);
  assert.equal(result.othersWeight, 11);
  assert.deepEqual(result.othersChildren.map((c) => c.data.id), ["c", "d"]);
});

test("selectTopWithOthers breaks weight ties by name", () => {
  const children = [
    weighted("banana", 10),
    weighted("apple", 10),
    weighted("cherry", 10),
    weighted("date", 10),
  ];
  // capacity 3 -> visibleCount = max(1, 3-1) = 2, so the alphabetically
  // first 2 of these 4 equal-weight children should be the ones shown.
  const result = selectTopWithOthers(children, 3);
  assert.deepEqual(result.visible.map((c) => c.data.id), ["apple", "banana"]);
  assert.deepEqual(result.othersChildren.map((c) => c.data.id), ["cherry", "date"]);
});

test("selectTopWithOthers at capacity 1 still shows one real child plus Others for the rest", () => {
  const children = [weighted("a", 10), weighted("b", 5)];
  const result = selectTopWithOthers(children, 1);
  assert.deepEqual(result.visible.map((c) => c.data.id), ["a"]);
  assert.equal(result.othersCount, 1);
});

test("buildOthersNode builds a plain data node whose children are the hidden children's data", () => {
  const hidden = [weighted("c", 10), weighted("d", 1)];
  const node = buildOthersNode("Deep Learning", hidden);
  assert.equal(node.id, "Deep Learning__others");
  assert.equal(node.name, "2 more");
  assert.deepEqual(node.children, [{ id: "c", name: "c" }, { id: "d", name: "d" }]);
});

function levelData(childSpecs) {
  return { id: "root", children: childSpecs.map(({ id, weight }) => ({ id, weight })) };
}

test("computeLevelBoxes returns a real box for every child when under capacity", () => {
  const root = buildHierarchy(levelData([{ id: "a", weight: 10 }, { id: "b", weight: 20 }]));
  const boxes = computeLevelBoxes(root.children, {
    focusId: "root",
    sizeKey: "popular",
    stageWidth: 1000,
    stageHeight: 600,
    minBoxAreaPx: 100,
  });
  assert.equal(boxes.length, 2);
  assert.ok(boxes.every((box) => box.kind === "real"));
  assert.deepEqual(boxes.map((box) => box.node.data.id).sort(), ["a", "b"]);
});

test("computeLevelBoxes truncates to top-N plus one Others box when over capacity", () => {
  const root = buildHierarchy(
    levelData([{ id: "a", weight: 100 }, { id: "b", weight: 50 }, { id: "c", weight: 10 }, { id: "d", weight: 1 }]),
  );
  // stage area 100*100=10000, minBoxAreaPx 5000 -> capacity 2.
  const boxes = computeLevelBoxes(root.children, {
    focusId: "root",
    sizeKey: "popular",
    stageWidth: 100,
    stageHeight: 100,
    minBoxAreaPx: 5000,
  });
  assert.equal(boxes.length, 2);
  const real = boxes.filter((box) => box.kind === "real");
  const others = boxes.filter((box) => box.kind === "others");
  assert.equal(real.length, 1);
  assert.equal(real[0].node.data.id, "a");
  assert.equal(others.length, 1);
  assert.equal(others[0].hiddenChildren.length, 3);
  assert.deepEqual(others[0].hiddenChildren.map((c) => c.data.id).sort(), ["b", "c", "d"]);
  assert.equal(others[0].data.name, "3 more");
});

test("computeLevelBoxes lays every box out within the stage bounds", () => {
  const root = buildHierarchy(levelData([{ id: "a", weight: 10 }, { id: "b", weight: 90 }]));
  const boxes = computeLevelBoxes(root.children, {
    focusId: "root",
    sizeKey: "popular",
    stageWidth: 1000,
    stageHeight: 600,
    minBoxAreaPx: 100,
  });
  for (const box of boxes) {
    assert.ok(box.rect.left >= 0 && box.rect.left + box.rect.width <= 1000);
    assert.ok(box.rect.top >= 0 && box.rect.top + box.rect.height <= 600);
  }
});

test("computeLevelBoxes sizes real boxes roughly proportional to weight", () => {
  const root = buildHierarchy(levelData([{ id: "a", weight: 10 }, { id: "b", weight: 90 }]));
  const boxes = computeLevelBoxes(root.children, {
    focusId: "root",
    sizeKey: "popular",
    stageWidth: 1000,
    stageHeight: 100,
    minBoxAreaPx: 100,
  });
  const areaOf = (box) => box.rect.width * box.rect.height;
  const a = boxes.find((box) => box.node.data.id === "a");
  const b = boxes.find((box) => box.node.data.id === "b");
  const ratio = areaOf(b) / areaOf(a);
  assert.ok(ratio > 7 && ratio < 11, `expected ~9x, got ${ratio}`);
});

test("computeLevelBoxes returns an empty array when there are no children", () => {
  assert.deepEqual(
    computeLevelBoxes(undefined, {
      focusId: "leaf",
      sizeKey: "popular",
      stageWidth: 1000,
      stageHeight: 600,
      minBoxAreaPx: 100,
    }),
    [],
  );
  assert.deepEqual(
    computeLevelBoxes([], {
      focusId: "leaf",
      sizeKey: "popular",
      stageWidth: 1000,
      stageHeight: 600,
      minBoxAreaPx: 100,
    }),
    [],
  );
});

test("computeLevelBoxes preserves weight-descending order between visible boxes and their rects", () => {
  const root = buildHierarchy(
    levelData([
      { id: "a", weight: 100 },
      { id: "b", weight: 80 },
      { id: "c", weight: 50 },
      { id: "d", weight: 10 },
      { id: "e", weight: 1 },
    ]),
  );
  const boxes = computeLevelBoxes(root.children, {
    focusId: "root",
    sizeKey: "popular",
    stageWidth: 1000,
    stageHeight: 100,
    minBoxAreaPx: 25000,
  });
  const real = boxes.filter((box) => box.kind === "real");
  const others = boxes.filter((box) => box.kind === "others");
  assert.deepEqual(real.map((box) => box.node.data.id), ["a", "b", "c"]);
  const areaOf = (box) => box.rect.width * box.rect.height;
  assert.ok(
    areaOf(real[0]) > areaOf(real[1]) && areaOf(real[1]) > areaOf(real[2]),
    "each real box's rendered area should descend with its weight, in the same order as `real`",
  );
  assert.equal(others.length, 1);
  assert.deepEqual(others[0].hiddenChildren.map((c) => c.data.id).sort(), ["d", "e"]);
});

test("computeLevelBoxes passes every child through with no Others box exactly at the capacity boundary", () => {
  const root = buildHierarchy(
    levelData([{ id: "a", weight: 3 }, { id: "b", weight: 2 }, { id: "c", weight: 1 }]),
  );
  const boxes = computeLevelBoxes(root.children, {
    focusId: "root",
    sizeKey: "popular",
    stageWidth: 100,
    stageHeight: 30,
    minBoxAreaPx: 1000,
  });
  assert.equal(boxes.length, 3);
  assert.ok(boxes.every((box) => box.kind === "real"));
});

test("computeStageSize reproduces the legacy 1000x600 size when the container is exactly wide enough", () => {
  // 1032 - 16*2 (side margins) = 1000 = STAGE_MAX_WIDTH exactly.
  const size = computeStageSize(1032);
  assert.equal(size.width, 1000);
  assert.equal(size.height, 600);
});

test("computeStageSize caps width at 1000 for a container much wider than the max", () => {
  const size = computeStageSize(2000);
  assert.equal(size.width, 1000);
  assert.equal(size.height, 600);
});

test("computeStageSize uses the desktop ratio exactly at the mobile breakpoint", () => {
  // 672 - 16*2 = 640 = STAGE_MOBILE_BREAKPOINT_PX exactly — not below it,
  // so this is still the desktop ratio, not the mobile one.
  const size = computeStageSize(672);
  assert.equal(size.width, 640);
  assert.equal(size.height, 640 * 0.6);
});

test("computeStageSize switches to the taller mobile ratio just below the breakpoint", () => {
  // 671 - 16*2 = 639, just under STAGE_MOBILE_BREAKPOINT_PX.
  const size = computeStageSize(671);
  assert.equal(size.width, 639);
  assert.equal(size.height, 639 * 1.3);
});

test("computeStageSize fits a typical phone-width container with the mobile ratio", () => {
  // 375 - 16*2 = 343.
  const size = computeStageSize(375);
  assert.equal(size.width, 343);
  assert.equal(size.height, 343 * 1.3);
});

test("computeStageSize never goes negative for a container narrower than the side margins", () => {
  const size = computeStageSize(10);
  assert.equal(size.width, 0);
  assert.equal(size.height, 0);
});

test("computeStageSize fills the given available height on mobile instead of using the fixed ratio", () => {
  // 375 - 16*2 = 343, still under the breakpoint.
  const size = computeStageSize(375, 700);
  assert.equal(size.width, 343);
  assert.equal(size.height, 700);
});

test("computeStageSize floors the mobile height at STAGE_MIN_MOBILE_HEIGHT_PX for a squeezed viewport", () => {
  const size = computeStageSize(375, 100);
  assert.equal(size.height, 280);
});

test("computeStageSize ignores availableHeight at/above the desktop breakpoint", () => {
  const size = computeStageSize(672, 2000);
  assert.equal(size.width, 640);
  assert.equal(size.height, 640 * 0.6);
});

test("computeStageSize falls back to the mobile ratio when availableHeight isn't a finite number", () => {
  assert.equal(computeStageSize(375, undefined).height, 343 * 1.3);
  assert.equal(computeStageSize(375, NaN).height, 343 * 1.3);
});

test("leafAriaLabel includes the star count in popular mode", () => {
  assert.equal(leafAriaLabel({ name: "pandas", weight: 49517 }, "popular"), "pandas, 49,517 stars");
});

test("leafAriaLabel falls back to just the name when weight is missing", () => {
  assert.equal(leafAriaLabel({ name: "pandas" }, "popular"), "pandas");
});

test("leafAriaLabel reports growth stats in rising mode", () => {
  const leafData = { name: "pandas", growth: { rising30: { starDelta: 340, percentDelta: 18.4 } } };
  assert.equal(leafAriaLabel(leafData, "rising30"), "pandas, +340 stars (+18%) in 30 days");
});

test("leafAriaLabel reports a negative growth stat without a leading '+'", () => {
  const leafData = { name: "pandas", growth: { rising30: { starDelta: -5, percentDelta: -1.2 } } };
  assert.equal(leafAriaLabel(leafData, "rising30"), "pandas, -5 stars (-1%) in 30 days");
});

test("leafAriaLabel flags a project too new for the active rising window", () => {
  const leafData = { name: "new-project", hasEnoughHistory: { rising30: false } };
  assert.equal(leafAriaLabel(leafData, "rising30"), "new-project, not enough history yet");
});

test("leafAriaLabel falls back to just the name when rising growth data is missing", () => {
  assert.equal(leafAriaLabel({ name: "pandas" }, "rising30"), "pandas");
});

test("categoryAriaLabel pluralizes project count", () => {
  assert.equal(categoryAriaLabel("Data Manipulation", 5), "Data Manipulation, category with 5 projects");
  assert.equal(categoryAriaLabel("Data Manipulation", 1), "Data Manipulation, category with 1 project");
});

test("othersAriaLabel pluralizes hidden project count", () => {
  assert.equal(othersAriaLabel(3), "3 more projects");
  assert.equal(othersAriaLabel(1), "1 more project");
});
