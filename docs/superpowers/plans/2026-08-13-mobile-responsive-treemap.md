# Mobile-Responsive Treemap Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the treemap stage resize to fit the viewport (no horizontal overflow / forced pinch-zoom on phones), using a taller aspect ratio below a mobile breakpoint, and keep it fitted live across resize/rotation.

**Architecture:** A new pure function, `computeStageSize(containerWidth)`, in `app/shared/layout.js` decides the stage's `{width, height}` from the space available to it — capped at today's 1000px, switching to a taller ratio below a 640px breakpoint. `app/shared/treemap.js`'s `mountTreemap` calls it once at mount (replacing the hardcoded `STAGE_WIDTH`/`STAGE_HEIGHT` constants) and again, debounced, via a `ResizeObserver` on the container, re-running `renderLevel()` whenever the computed size actually changes.

**Tech Stack:** Vanilla JS (ES modules), `d3-hierarchy` (vendored), Node's built-in test runner (`node --test`), no build tooling beyond the repo's existing `scripts/generate.mjs` static site generator.

## Global Constraints

- No DOM/browser test framework in this repo (no jsdom) — pure logic goes in `app/shared/layout.js` and is unit-tested there; DOM wiring in `app/shared/treemap.js` is verified manually via the browser preview, matching how the rest of that file is (not) tested today.
- `STAGE_MAX_WIDTH = 1000` — the stage never exceeds this width regardless of viewport.
- `STAGE_SIDE_MARGIN_PX = 16` — reserved on each side, subtracted from the container width before computing stage width.
- `STAGE_MOBILE_BREAKPOINT_PX = 640` — the *stage* width (after the side margin is subtracted) below which the mobile aspect ratio applies.
- `STAGE_MOBILE_HEIGHT_RATIO = 1.3` — `height = width × 1.3` below the breakpoint.
- `STAGE_DESKTOP_HEIGHT_RATIO = 0.6` — `height = width × 0.6` at/above the breakpoint (today's 1000×600 ratio).
- Resize debounce: 150ms.

---

### Task 1: `computeStageSize` pure sizing function

**Files:**
- Modify: `app/shared/layout.js` (add constants + function, near the other pure geometry helpers)
- Test: `test/layout.test.js` (add test cases; existing file, existing `import` block at the top)

**Interfaces:**
- Consumes: nothing new — pure arithmetic only.
- Produces: `computeStageSize(containerWidth: number): { width: number, height: number }`, exported from `app/shared/layout.js`, consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Add to `test/layout.test.js`. First, add `computeStageSize` to the existing import block at the top of the file:

```js
import {
  weightOf,
  buildHierarchy,
  computeLayout,
  estimateCapacity,
  selectTopWithOthers,
  buildOthersNode,
  computeLevelBoxes,
  computeStageSize,
} from "../app/shared/layout.js";
```

Then append these test cases at the end of the file:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/layout.test.js`
Expected: FAIL — `computeStageSize is not a function` (or `undefined is not a function`), since it doesn't exist yet.

- [ ] **Step 3: Implement `computeStageSize` in `app/shared/layout.js`**

Add near the top of the file, after the existing imports and before `weightOf`:

```js
// The stage never grows past this width, regardless of viewport — the
// original fixed desktop size, now a ceiling rather than the only size.
const STAGE_MAX_WIDTH = 1000;
// Reserved on each side so a box's outer edge never renders flush against
// the screen edge on a narrow viewport.
const STAGE_SIDE_MARGIN_PX = 16;
// Below this *stage* width (after the side margin above is subtracted),
// switch from the desktop landscape ratio to a taller, portrait-friendly
// one — a phone-width stage would otherwise just be a short, squished
// version of the desktop shape instead of making use of a tall screen.
const STAGE_MOBILE_BREAKPOINT_PX = 640;
const STAGE_MOBILE_HEIGHT_RATIO = 1.3;
const STAGE_DESKTOP_HEIGHT_RATIO = 0.6; // matches the original 1000x600.

/**
 * Computes the stage's `{width, height}` from the width available to it
 * (typically its container's `clientWidth`). Width is capped at
 * `STAGE_MAX_WIDTH`; below `STAGE_MOBILE_BREAKPOINT_PX` the height uses a
 * taller ratio than the desktop default so a phone-width stage makes
 * better use of a portrait screen. Called once at mount and again on
 * every resize/orientation change (see `mountTreemap`'s `resizeStage` in
 * `treemap.js`) — this is the only place stage size is decided.
 */
export function computeStageSize(containerWidth) {
  const usable = Math.max(0, containerWidth - STAGE_SIDE_MARGIN_PX * 2);
  const width = Math.min(usable, STAGE_MAX_WIDTH);
  const height =
    width < STAGE_MOBILE_BREAKPOINT_PX
      ? width * STAGE_MOBILE_HEIGHT_RATIO
      : width * STAGE_DESKTOP_HEIGHT_RATIO;
  return { width, height };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/layout.test.js`
Expected: PASS — all `computeStageSize` tests green, and every pre-existing test in the file still passes.

- [ ] **Step 5: Commit**

```bash
git add app/shared/layout.js test/layout.test.js
git commit -m "feat: add computeStageSize for a responsive treemap stage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire dynamic sizing + live resize into `mountTreemap`

**Files:**
- Modify: `app/shared/treemap.js`

**Interfaces:**
- Consumes: `computeStageSize(containerWidth): { width, height }` from Task 1 (`app/shared/layout.js`).
- Produces: no new exports — `mountTreemap`'s existing public signature (`mountTreemap(container, mapData, onLeafClick, onModeChange)` returning `{ zoomTo, root }`) is unchanged; only its internal sizing behavior changes.

- [ ] **Step 1: Import `computeStageSize` and drop the hardcoded stage constants**

In `app/shared/treemap.js`, replace:

```js
import { buildHierarchy, computeLevelBoxes } from "./layout.js";

const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 600;
```

with:

```js
import { buildHierarchy, computeLevelBoxes, computeStageSize } from "./layout.js";

// Debounce for the ResizeObserver in mountTreemap — avoids re-laying-out
// the whole stage on every intermediate frame of a window drag-resize.
const RESIZE_DEBOUNCE_MS = 150;
```

- [ ] **Step 2: Replace the stage's fixed inline size with dynamic, closure-scoped state**

Find this block near the top of `mountTreemap` (right after the `focusIdPath` declaration):

```js
  container.innerHTML = "";
  const modeBar = document.createElement("div");
  modeBar.className = "treemap-mode-bar";
  const breadcrumb = document.createElement("div");
  breadcrumb.className = "treemap-breadcrumb";
  const stage = document.createElement("div");
  stage.className = "treemap-stage";
  stage.style.width = `${STAGE_WIDTH}px`;
  stage.style.height = `${STAGE_HEIGHT}px`;
  container.appendChild(modeBar);
  container.appendChild(breadcrumb);
  container.appendChild(stage);
```

Replace it with:

```js
  let stageWidth;
  let stageHeight;

  container.innerHTML = "";
  const modeBar = document.createElement("div");
  modeBar.className = "treemap-mode-bar";
  const breadcrumb = document.createElement("div");
  breadcrumb.className = "treemap-breadcrumb";
  const stage = document.createElement("div");
  stage.className = "treemap-stage";
  container.appendChild(modeBar);
  container.appendChild(breadcrumb);
  container.appendChild(stage);

  /**
   * Applies a freshly computed `{width, height}` to the stage element and
   * to the closure-scoped `stageWidth`/`stageHeight` that `renderLevel`
   * lays boxes out against. Doesn't itself re-render — callers that need
   * the new size reflected in the actual boxes call `renderLevel()` (or
   * the full initial render sequence) afterwards.
   */
  function applyStageSize(size) {
    stageWidth = size.width;
    stageHeight = size.height;
    stage.style.width = `${stageWidth}px`;
    stage.style.height = `${stageHeight}px`;
  }

  applyStageSize(computeStageSize(container.clientWidth));
```

- [ ] **Step 3: Use the closure-scoped size in `renderLevel`**

Find:

```js
  function renderLevel() {
    stage.innerHTML = "";
    const boxes = computeLevelBoxes(focusNode.children, {
      focusId: focusNode.data.id,
      sizeKey: activeSizeKey(),
      stageWidth: STAGE_WIDTH,
      stageHeight: STAGE_HEIGHT,
      minBoxAreaPx: MIN_BOX_AREA_PX,
    });
```

Replace the two `stageWidth`/`stageHeight` lines with:

```js
      stageWidth,
      stageHeight,
```

(shorthand property syntax — `stageWidth` and `stageHeight` now refer to the closure variables set by `applyStageSize`.)

- [ ] **Step 4: Add debounced live resize**

Find the end of `mountTreemap`, just before its final `return`:

```js
  renderModeBar();
  renderBreadcrumb();
  renderLevel();

  return { zoomTo, root };
}
```

Replace with:

```js
  renderModeBar();
  renderBreadcrumb();
  renderLevel();

  /**
   * Recomputes the stage size from the container's current width and,
   * only if it actually changed, applies it and re-lays-out the current
   * focus level. Zoom state (`focusNode`/`focusIdPath`) is untouched, so
   * the user stays at whatever level they'd zoomed to across a resize.
   */
  function resizeStage() {
    const nextSize = computeStageSize(container.clientWidth);
    if (nextSize.width === stageWidth && nextSize.height === stageHeight) return;
    applyStageSize(nextSize);
    renderLevel();
  }

  let resizeTimeoutId = null;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeTimeoutId !== null) clearTimeout(resizeTimeoutId);
    resizeTimeoutId = setTimeout(() => {
      resizeTimeoutId = null;
      resizeStage();
    }, RESIZE_DEBOUNCE_MS);
  });
  resizeObserver.observe(container);

  return { zoomTo, root };
}
```

- [ ] **Step 5: Regenerate the static site**

Run: `npm run generate`
Expected: exits 0, no errors — this rebuilds `dist/` from the changed `app/shared/*.js` (the generator copies `app/shared` and `app/vendor` as-is into `dist/shared`/`dist/vendor`).

- [ ] **Step 6: Start the local preview and check desktop width**

Use the browser tool to start the `awesomemap-dev` server (from `.claude/launch.json`) and open one of the generated domain pages, e.g. `http://localhost:5000/security/`, at a desktop-sized viewport (1280×800). Confirm:
- No horizontal scrollbar / `document.body.scrollWidth` equals the viewport width (not wider).
- The treemap renders with visible, correctly laid-out category boxes (visually matches pre-change behavior, just slightly narrower than before — ~968px stage instead of exactly 1000px, per Task 1's worked example).

- [ ] **Step 7: Check phone width (375px) and confirm no overflow**

Resize the preview viewport to 375×812 (or use the `mobile` preset). Confirm:
- `document.body.scrollWidth` equals `375` (no horizontal overflow) — this is the core bug this plan fixes.
- The stage is visibly taller relative to its width than at desktop size (mobile aspect ratio kicked in — per Task 1, expect a ~343×446 stage).
- Boxes are still clickable/tappable (click a category box, confirm it zooms in; click a leaf, confirm the detail panel opens).

- [ ] **Step 8: Confirm live resize**

While still at the 375px viewport with the treemap zoomed into a category (from Step 7), resize the viewport to 1280×800. Confirm the stage grows back to the desktop size and re-lays-out (still showing the same zoomed-in category — check the breadcrumb still shows the zoomed level, not reset to root). Then resize back to 375×812 and confirm it shrinks back to the mobile size again, still on the same zoomed level.

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: PASS — every existing test still passes (this task made no changes to any tested pure function; `layout.test.js`'s Task-1 additions already passed in Task 1).

- [ ] **Step 10: Commit**

```bash
git add app/shared/treemap.js
git commit -m "feat: resize treemap stage to fit viewport, live on resize/rotate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
