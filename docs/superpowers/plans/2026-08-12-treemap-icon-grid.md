# Treemap Recursive Icon Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every box in the treemap — category or "Others" — previews its own top tools as weighted logo icons at any zoom depth, with the rest folded into a clickable, recursively-zoomable "Others" tile, instead of today's label-only category boxes and always-render-every-child leaf level.

**Architecture:** One pure helper (`computeLevelBoxes` in `app/shared/layout.js`) decides, for whatever level is currently focused, which children get their own full box (top-N by weight, laid out via a fresh local d3 treemap) versus folding into a synthetic "Others" node — reused identically whether the level is the map root, a zoomed category, or a zoomed "Others" bucket. A second, smaller application of the same primitives (`renderPeek` in `app/shared/treemap.js`) draws a decorative preview grid of weighted logo icons inside any box that has children, so categories show tool logos before you even zoom in.

**Tech Stack:** Vanilla JS + `d3-hierarchy` (already a dependency), `node --test` for unit tests. No new dependencies.

## Global Constraints

- No data schema changes — `data/<slug>.json`'s `projects`/`path` shape is untouched (spec Non-goals).
- No change to the zoom/breadcrumb navigation model (`zoomTo`, `focusIdPath`, `renderBreadcrumb`) — the new "Others" mechanism reuses it rather than replacing it (spec Non-goals).
- No automated browser/DOM tests — this repo's convention is `node --test` for pure logic and manual browser verification for rendering (matches every existing spec's Testing section).
- Tool/logo images stay hotlinked from their source (`raw.githubusercontent.com`, an org/user's `github.com` avatar, etc.) — never downloaded or stored in this repo (existing `enrich-domain.mjs` convention).
- Terminology is "project," not "tool," throughout new code and comments — matches the rename already merged to `master` (#4).

---

## Task 1: Image coverage — GitHub avatar fallback

Prerequisite groundwork: right now most domains have almost no `image` field populated (the strict logo-file-path search rarely matches), so the new icon grid would mostly show fallback letters instead of logos. This task adds a cheap, always-available fallback and re-runs enrichment across every domain.

**Files:**
- Modify: `scripts/enrich-domain.mjs`
- Test: `test/enrich-domain.test.js`
- Modify (data, via running the script): `data/data-science.json`, `data/devops-infra.json`, `data/mobile-dev.json`, `data/security.json`, `data/web-dev.json`

**Interfaces:**
- Consumes: nothing new — reuses the existing `getJson` injection point.
- Produces: `enrichProject` now also sets `image` from `repoData.owner.avatar_url` when no logo file was found. No signature change.

- [ ] **Step 1: Write the failing test**

Add to `test/enrich-domain.test.js` (the existing `fakeGetJson` helper only returns `{ stargazers_count }` for the repo GET — extend it to optionally carry an `owner.avatar_url`, and add these two tests near the existing `enrichProject` tests):

```js
function fakeGetJson({ repoStars, ownerAvatarUrl, contentsByPath }) {
  return async (url) => {
    const contentsMatch = Object.keys(contentsByPath).find((p) => url.endsWith(`/contents/${p}`));
    if (contentsMatch) {
      const entry = contentsByPath[contentsMatch];
      if (!entry) {
        const err = new Error("Not Found");
        err.status = 404;
        throw err;
      }
      return entry;
    }
    return { stargazers_count: repoStars, owner: { avatar_url: ownerAvatarUrl } };
  };
}

test("enrichProject falls back to the repo owner's avatar when no logo file is found", async () => {
  const project = { id: "facebook/react" };
  const getJson = fakeGetJson({
    repoStars: 12345,
    ownerAvatarUrl: "https://avatars.githubusercontent.com/u/69631?v=4",
    contentsByPath: {},
  });

  const result = await enrichProject(project, { getJson });

  assert.equal(result.image, "https://avatars.githubusercontent.com/u/69631?v=4");
});

test("enrichProject prefers a found logo file over the owner avatar fallback", async () => {
  const project = { id: "facebook/react" };
  const getJson = fakeGetJson({
    repoStars: 12345,
    ownerAvatarUrl: "https://avatars.githubusercontent.com/u/69631?v=4",
    contentsByPath: {
      "logo.svg": { type: "file", download_url: "https://raw.githubusercontent.com/facebook/react/main/logo.svg" },
    },
  });

  const result = await enrichProject(project, { getJson });

  assert.equal(result.image, "https://raw.githubusercontent.com/facebook/react/main/logo.svg");
});
```

You must also update the three pre-existing `enrichProject` tests that use `fakeGetJson` without `ownerAvatarUrl` (`"sets weight from the repo's star count"`, `"leaves image unset when no candidate path exists"`) — they now implicitly get `owner: { avatar_url: undefined }`, so `result.image` stays `undefined` and those assertions still pass unchanged. No edit needed there, just confirm after Step 2 that they still fail for the right reason (missing fallback code, not a fixture bug).

- [ ] **Step 2: Run tests to verify the two new ones fail**

Run: `node --test test/enrich-domain.test.js`
Expected: FAIL — `enrichProject falls back to the repo owner's avatar...` fails because `result.image` is `undefined`; `enrichProject prefers a found logo file...` passes already (no behavior change needed for that path) — confirm only the fallback test fails.

- [ ] **Step 3: Implement the fallback**

In `scripts/enrich-domain.mjs`, modify `enrichProject`:

```js
export async function enrichProject(project, { getJson }) {
  const repo = parseGhRepo(project.id);
  if (!repo) return project;

  const repoData = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
  const enriched = { ...project, weight: repoData.stargazers_count };

  for (const path of LOGO_CANDIDATE_PATHS) {
    let entry;
    try {
      entry = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${path}`);
    } catch (err) {
      if (err.status === 404) continue;
      throw err;
    }
    if (entry && entry.type === "file" && entry.download_url) {
      enriched.image = entry.download_url;
      break;
    }
  }

  if (!enriched.image && repoData.owner?.avatar_url) {
    enriched.image = repoData.owner.avatar_url;
  }

  return enriched;
}
```

Also update its doc comment to mention the fallback:

```js
/**
 * Given a project and an injected `getJson`, returns a new project object
 * with `weight` set to its GitHub repo's live star count and `image` set
 * to a logo URL: the first matching candidate file's direct
 * raw.githubusercontent.com URL if one exists, otherwise the repo owner's
 * GitHub avatar (always available — an org's logo or a user's avatar).
 * Neither is ever downloaded or stored in this repo. Projects whose `id`
 * isn't a parseable owner/repo shorthand are returned unchanged; no
 * network calls are made for them.
 */
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/enrich-domain.test.js`
Expected: PASS — all tests green, including the two new ones and the two pre-existing ones that now implicitly exercise `owner: { avatar_url: undefined }`.

- [ ] **Step 5: Commit**

```bash
git add scripts/enrich-domain.mjs test/enrich-domain.test.js
git commit -m "feat: fall back to repo owner avatar when no logo file is found"
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — no other suite touches `enrich-domain.mjs`.

- [ ] **Step 7: Re-run enrichment for every domain**

```bash
node scripts/enrich-domain.mjs data/data-science.json
node scripts/enrich-domain.mjs data/devops-infra.json
node scripts/enrich-domain.mjs data/mobile-dev.json
node scripts/enrich-domain.mjs data/security.json
node scripts/enrich-domain.mjs data/web-dev.json
```

Each prints a summary line like `data/web-dev.json: 50/50 weights fetched, 0 failed, 48 logo URLs resolved`. Expect the `logo URLs resolved` count to jump from near-zero to near-total for every domain except `data-science` (which already had good coverage from curated logo files — the avatar fallback only fills the remainder there). This takes a few minutes per domain (GitHub API rate limits + up to 12 sequential path checks per project before falling back) — run in the background if your environment allows it and check the output when done rather than blocking on it.

- [ ] **Step 8: Spot-check a few results**

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('data/web-dev.json'));
for (const p of d.projects.slice(0, 5)) console.log(p.id, '->', p.image);
console.log('coverage:', d.projects.filter((p) => p.image).length + '/' + d.projects.length);
"
```

Expected: coverage close to `projects.length` (a handful may legitimately have neither a logo file nor a resolvable owner avatar, or failed enrichment — that's fine).

- [ ] **Step 9: Commit the refreshed data**

```bash
git add data/data-science.json data/devops-infra.json data/mobile-dev.json data/security.json data/web-dev.json
git commit -m "chore: backfill logo images via owner-avatar fallback"
```

---

## Task 2: Selection and sizing primitives

Pure, DOM-free building blocks: given a set of weighted children and how much room there is, decide which ones are shown and how big each one renders.

**Files:**
- Modify: `app/shared/layout.js`
- Test: `test/layout.test.js`

**Interfaces:**
- Consumes: nothing new (plain arrays/numbers).
- Produces (for Task 3 and Task 4/5 to consume):
  - `estimateCapacity(areaPx, minItemAreaPx) → number` — always ≥ 1.
  - `selectTopWithOthers(children, capacity) → { visible, othersCount, othersWeight, othersChildren }` — `children` is an array of objects shaped `{ value: number, data: { name: string, ... } }` (real d3 hierarchy nodes satisfy this).
  - `sizeForWeight(weight, { minPx, maxPx, minWeight, maxWeight }) → number`.
  - `buildOthersNode(parentId, othersChildren) → { id, name, children }` — plain data, `children` are each `othersChildren[i].data`.

- [ ] **Step 1: Write the failing tests**

Add to `test/layout.test.js` (new `import`s alongside the existing ones at the top: `estimateCapacity, selectTopWithOthers, sizeForWeight, buildOthersNode`):

```js
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

test("sizeForWeight clamps to maxPx at the top of the range and minPx at the bottom", () => {
  const range = { minPx: 20, maxPx: 100, minWeight: 10, maxWeight: 1000 };
  assert.equal(sizeForWeight(1000, range), 100);
  assert.equal(sizeForWeight(10, range), 20);
});

test("sizeForWeight interpolates over sqrt(weight) between the endpoints", () => {
  // sqrt(302.5) is exactly the midpoint between sqrt(10) and sqrt(1000)
  // (302.5 = ((sqrt(10)+sqrt(1000))/2)^2), so this sits exactly halfway
  // from 20 to 100.
  const size = sizeForWeight(302.5, { minPx: 20, maxPx: 100, minWeight: 10, maxWeight: 1000 });
  assert.equal(size, 60);
});

test("sizeForWeight returns maxPx when every visible child has equal weight (no range to interpolate)", () => {
  assert.equal(sizeForWeight(50, { minPx: 20, maxPx: 100, minWeight: 50, maxWeight: 50 }), 100);
});

test("buildOthersNode builds a plain data node whose children are the hidden children's data", () => {
  const hidden = [weighted("c", 10), weighted("d", 1)];
  const node = buildOthersNode("Deep Learning", hidden);
  assert.equal(node.id, "Deep Learning__others");
  assert.equal(node.name, "2 more");
  assert.deepEqual(node.children, [{ id: "c", name: "c" }, { id: "d", name: "d" }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/layout.test.js`
Expected: FAIL — `estimateCapacity`, `selectTopWithOthers`, `sizeForWeight`, `buildOthersNode` are not exported yet (import error / undefined function calls).

- [ ] **Step 3: Implement the four functions**

Add to `app/shared/layout.js` (after the existing `weightOf`/`buildHierarchy`/`computeLayout`, before `projectRect`):

```js
/**
 * Roughly how many `minItemAreaPx`-sized items fit in `areaPx`, floored,
 * never less than 1 — a box (or icon grid) can always show at least one
 * thing. Deliberately a loose estimate, not an exact packing computation:
 * good enough to decide "does this need an Others bucket," not meant to
 * be pixel-exact (the actual layout may render very slightly over or
 * under this count).
 */
export function estimateCapacity(areaPx, minItemAreaPx) {
  if (!(areaPx > 0) || !(minItemAreaPx > 0)) return 1;
  return Math.max(1, Math.floor(areaPx / minItemAreaPx));
}

/**
 * Ranks `children` (each `{ value, data: { name, ... } }` — real d3
 * hierarchy nodes satisfy this) by `value` descending (ties broken by
 * `data.name`) and splits them into what's shown individually versus
 * folded into a single "Others" bucket, so that at most `capacity` slots
 * are used in total (one of which is the Others slot itself, when there's
 * anything to hide). Passes everything through unchanged, with an empty
 * Others bucket, when `children.length <= capacity`.
 */
export function selectTopWithOthers(children, capacity) {
  const cap = Math.max(1, Math.floor(capacity));
  const sorted = [...children].sort(
    (a, b) => b.value - a.value || a.data.name.localeCompare(b.data.name),
  );

  if (sorted.length <= cap) {
    return { visible: sorted, othersCount: 0, othersWeight: 0, othersChildren: [] };
  }

  const visibleCount = Math.max(1, cap - 1);
  const visible = sorted.slice(0, visibleCount);
  const othersChildren = sorted.slice(visibleCount);
  const othersWeight = othersChildren.reduce((sum, child) => sum + child.value, 0);
  return { visible, othersCount: othersChildren.length, othersWeight, othersChildren };
}

/**
 * Maps `weight` onto a pixel size between `minPx` and `maxPx`, by linear
 * interpolation over `sqrt(weight)` (so a 4x weight difference reads as
 * ~2x size, not 4x — keeps a single dominant project from dwarfing
 * everything else in the same grid). `minWeight`/`maxWeight` describe the
 * range of weights currently being sized together (typically the
 * `visible` set from `selectTopWithOthers`, so the biggest one shown
 * always renders at `maxPx`). Returns `maxPx` outright when
 * `maxWeight <= minWeight` (a single item, or a degenerate equal-weight
 * set) rather than dividing by zero.
 */
export function sizeForWeight(weight, { minPx, maxPx, minWeight, maxWeight }) {
  if (maxWeight <= minWeight) return maxPx;
  const t =
    (Math.sqrt(weight) - Math.sqrt(minWeight)) / (Math.sqrt(maxWeight) - Math.sqrt(minWeight));
  const clamped = Math.min(1, Math.max(0, t));
  return Math.round(minPx + clamped * (maxPx - minPx));
}

/**
 * Builds the plain-data shape for a synthetic "N more" node standing in
 * for `othersChildren` (the hidden half of a `selectTopWithOthers`
 * result). `children` is each hidden child's own `.data` — plain project
 * or category data, unwrapped from its d3 hierarchy node — so this node
 * can be fed straight into `buildHierarchy`/`hierarchy()` like any other
 * tree data, and its own weight is derived by summing those children the
 * same way every other category's weight is (see `weightOf`), rather than
 * being tracked separately and risking drifting out of sync.
 */
export function buildOthersNode(parentId, othersChildren) {
  return {
    id: `${parentId}__others`,
    name: `${othersChildren.length} more`,
    children: othersChildren.map((child) => child.data),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/layout.test.js`
Expected: PASS — all tests green, including the pre-existing ones (unaffected).

- [ ] **Step 5: Commit**

```bash
git add app/shared/layout.js test/layout.test.js
git commit -m "feat: add top-N/Others selection and weighted-size primitives"
```

---

## Task 3: Per-level box layout

Combines Task 2's primitives with the existing `buildHierarchy`/`computeLayout` into one pure function that decides, for one focused level, exactly which boxes to draw and where — the core of the feature, and the piece Task 4 wires into the DOM.

**Files:**
- Modify: `app/shared/layout.js`
- Test: `test/layout.test.js`

**Interfaces:**
- Consumes: `estimateCapacity`, `selectTopWithOthers`, `buildOthersNode`, `buildHierarchy`, `computeLayout` (all from Task 2 / already in this file).
- Produces (for Task 4 to consume): `computeLevelBoxes(focusChildren, { focusId, sizeKey, stageWidth, stageHeight, minBoxAreaPx }) → Array<Box>` where `Box` is either:
  - `{ kind: "real", node, rect }` — `node` is the original real d3 hierarchy node (untouched — same object, same `.parent` chain, same `.data`), `rect` is `{ left, top, width, height }` in pixels within `[0, stageWidth] x [0, stageHeight]`.
  - `{ kind: "others", data, hiddenChildren, rect }` — `data` is `buildOthersNode`'s plain-data shape, `hiddenChildren` are the real d3 nodes it stands in for.

- [ ] **Step 1: Write the failing tests**

Add to `test/layout.test.js` (add `computeLevelBoxes` to the existing import list):

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/layout.test.js`
Expected: FAIL — `computeLevelBoxes` is not defined.

- [ ] **Step 3: Implement `computeLevelBoxes`**

Add to `app/shared/layout.js`, after `buildOthersNode`:

```js
/**
 * Decides which of `focusChildren` (real d3 hierarchy nodes — one level's
 * worth, e.g. the map root's categories, or one zoomed category's
 * projects) get their own box, versus folding into a single synthetic
 * "Others" box, and lays the resulting set out fresh via a small local
 * treemap sized to `stageWidth x stageHeight`. This level's boxes are
 * always computed on demand rather than reusing any previously computed
 * layout — that's what lets Others recurse: zooming into an Others box
 * hands its `hiddenChildren` back into this same function next render,
 * with no special-casing needed.
 *
 * Returns an array of `{ kind: "real", node, rect }` or
 * `{ kind: "others", data, hiddenChildren, rect }` entries — see this
 * module's top-of-file usage notes for the exact shape. Returns `[]` for
 * a leaf (`focusChildren` undefined or empty).
 */
export function computeLevelBoxes(focusChildren, { focusId, sizeKey, stageWidth, stageHeight, minBoxAreaPx }) {
  if (!focusChildren || focusChildren.length === 0) return [];

  const capacity = estimateCapacity(stageWidth * stageHeight, minBoxAreaPx);
  const { visible, othersChildren } = selectTopWithOthers(focusChildren, capacity);

  const othersData = othersChildren.length > 0 ? buildOthersNode(focusId, othersChildren) : null;
  const levelChildrenData = visible.map((child) => child.data).concat(othersData ? [othersData] : []);

  const levelRoot = computeLayout(
    buildHierarchy({ id: `${focusId}__level`, children: levelChildrenData }, sizeKey),
    stageWidth,
    stageHeight,
  );

  return levelRoot.children.map((laidOut, index) => {
    const rect = {
      left: laidOut.x0,
      top: laidOut.y0,
      width: laidOut.x1 - laidOut.x0,
      height: laidOut.y1 - laidOut.y0,
    };
    if (index < visible.length) {
      return { kind: "real", node: visible[index], rect };
    }
    return { kind: "others", data: othersData, hiddenChildren: othersChildren, rect };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/layout.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add app/shared/layout.js test/layout.test.js
git commit -m "feat: add computeLevelBoxes for per-level top-N/Others layout"
```

---

## Task 4: Wire the new layout into the treemap, with a zoomable Others box

Replaces the old "lay out the whole tree once, project rects on zoom" flow with "compute this level's boxes fresh on every render." This is the task most likely to visibly change existing behavior — do the full manual verification pass at the end before moving on.

**Files:**
- Modify: `app/shared/treemap.js`
- Modify: `app/shared/layout.js` (remove now-dead `projectRect`)
- Modify: `test/layout.test.js` (remove its now-dead tests)
- Modify: `app/shared/treemap.css`

**Interfaces:**
- Consumes: `buildHierarchy`, `computeLevelBoxes` from `app/shared/layout.js`.
- Produces: `mountTreemap`'s existing public signature (`mountTreemap(container, mapData, onLeafClick, onModeChange) → { zoomTo, root }`) is unchanged — this task only changes internals.

- [ ] **Step 1: Replace `app/shared/treemap.js`**

This rewrites the file's rendering internals; the public `mountTreemap` signature and behavior for real (non-Others) categories/leaves stays the same. Replace the full file contents with:

```js
import { buildHierarchy, computeLevelBoxes } from "./layout.js";

const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 600;
// Deliberately duplicated from scripts/velocity.mjs's RISING_WINDOWS_DAYS
// rather than imported: scripts/ is a build-time-only Node directory that
// generate.mjs never copies into dist/, so this browser module can't
// import from it. Keep both lists in sync if a window is ever added.
const RISING_WINDOWS_DAYS = [7, 30, 90];

// A box needs roughly this much area to stay legible (label + logo)
// before it's worth its own slot instead of folding into "Others".
const MIN_BOX_AREA_PX = 12000;

/**
 * Mounts a treemap for `mapData` into `container`. A project's `image`,
 * when present, is already a direct URL into its source repo.
 * `onLeafClick(leafData)`, if given, is called when a leaf box (or a leaf
 * shown in a peek preview) is clicked — categories and Others boxes zoom
 * instead of firing this callback. `leafData` is the leaf's data plus an
 * `activeSizeKey` field naming the size mode active when it was clicked
 * ("popular", "rising7", "rising30", or "rising90"), so the detail panel
 * can show the right stat. `onModeChange()`, if given, is called with no
 * arguments right after the Popular/Rising mode or window is switched —
 * consumers use it to dismiss any already-open detail panel, since its
 * baked-in growth stats would otherwise go stale against the new mode.
 */
export function mountTreemap(container, mapData, onLeafClick, onModeChange) {
  let sizeMode = "popular"; // "popular" | "rising"
  let risingWindow = 30;
  let root = buildHierarchy(mapData, activeSizeKey());
  let focusNode = root;
  let focusIdPath = [root.data.id];

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

  function activeSizeKey() {
    return sizeMode === "popular" ? "popular" : `rising${risingWindow}`;
  }

  function setSizeMode(nextMode, nextWindow) {
    sizeMode = nextMode;
    risingWindow = nextWindow;
    root = buildHierarchy(mapData, activeSizeKey());
    focusNode = findNodeByIdPath(root, focusIdPath);
    renderModeBar();
    renderBreadcrumb();
    renderLevel();
    onModeChange?.();
  }

  function findNodeByIdPath(node, idPath) {
    let current = node;
    for (const id of idPath.slice(1)) {
      const next = current.children?.find((child) => child.data.id === id);
      if (!next) break;
      current = next;
    }
    return current;
  }

  function zoomTo(node) {
    focusNode = node;
    focusIdPath = node.ancestors().reverse().map((ancestor) => ancestor.data.id);
    renderBreadcrumb();
    renderLevel();
  }

  /**
   * Zooms into a synthetic "Others" box: rebuilds it as a real d3
   * hierarchy (so its own children get `.value`s under the active
   * sizeKey, same as any other node), then patches `.parent` to
   * `parentNode` — the real box Others was hiding children of — so
   * `ancestors()` (breadcrumb, `focusIdPath`) walks back through the real
   * tree exactly like zooming into an ordinary category would.
   */
  function zoomToOthers(othersData, parentNode) {
    const syntheticNode = buildHierarchy(othersData, activeSizeKey());
    syntheticNode.parent = parentNode;
    zoomTo(syntheticNode);
  }

  function renderModeBar() {
    modeBar.innerHTML = "";

    modeBar.appendChild(
      renderModeButton("Popular", sizeMode === "popular", () => setSizeMode("popular", risingWindow))
    );
    modeBar.appendChild(
      renderModeButton("Rising", sizeMode === "rising", () => setSizeMode("rising", risingWindow))
    );

    if (sizeMode === "rising") {
      const windowGroup = document.createElement("span");
      windowGroup.className = "treemap-window-group";
      for (const windowDays of RISING_WINDOWS_DAYS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className =
          "treemap-window-button" + (windowDays === risingWindow ? " treemap-window-button-active" : "");
        button.textContent = `${windowDays}d`;
        button.addEventListener("click", () => setSizeMode("rising", windowDays));
        windowGroup.appendChild(button);
      }
      modeBar.appendChild(windowGroup);
    }
  }

  function renderModeButton(label, isActive, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "treemap-mode-button" + (isActive ? " treemap-mode-button-active" : "");
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderBreadcrumb() {
    breadcrumb.innerHTML = "";
    const trail = focusNode.ancestors().reverse(); // root ... focusNode
    trail.forEach((node, index) => {
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.className = "treemap-crumb";
      crumb.textContent = node.data.name;
      crumb.disabled = index === trail.length - 1;
      crumb.addEventListener("click", () => zoomTo(node));
      breadcrumb.appendChild(crumb);
      if (index < trail.length - 1) {
        const sep = document.createElement("span");
        sep.className = "treemap-crumb-sep";
        sep.textContent = " › ";
        breadcrumb.appendChild(sep);
      }
    });
  }

  function renderLevel() {
    stage.innerHTML = "";
    const boxes = computeLevelBoxes(focusNode.children, {
      focusId: focusNode.data.id,
      sizeKey: activeSizeKey(),
      stageWidth: STAGE_WIDTH,
      stageHeight: STAGE_HEIGHT,
      minBoxAreaPx: MIN_BOX_AREA_PX,
    });
    for (const box of boxes) {
      if (box.kind === "real") {
        stage.appendChild(renderBox(box.node, box.rect));
      } else {
        stage.appendChild(renderOthersBox(box, focusNode));
      }
    }
  }

  function renderBox(node, rect) {
    const key = activeSizeKey();
    const insufficientHistory =
      sizeMode === "rising" && node.data.hasEnoughHistory && node.data.hasEnoughHistory[key] === false;

    const box = document.createElement("div");
    box.className = node.children
      ? "treemap-box treemap-category"
      : "treemap-box treemap-leaf" + (insufficientHistory ? " treemap-box-insufficient-history" : "");
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const label = document.createElement("span");
    label.className = "treemap-label";
    label.textContent = node.data.name;
    box.appendChild(label);

    if (!node.children && node.data.image) {
      const img = document.createElement("img");
      img.className = "treemap-logo";
      img.src = node.data.image;
      img.alt = node.data.name;
      img.onerror = () => img.replaceWith(renderFallbackLogo(node.data.name));
      box.insertBefore(img, label);
    }

    if (node.children) {
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        zoomTo(node);
      });
    } else if (onLeafClick) {
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        onLeafClick({ ...node.data, activeSizeKey: key });
      });
    }

    return box;
  }

  /**
   * Renders a synthetic "N more" box: same look-and-feel entry point as
   * `renderBox`, but there's no real node to click into — clicking builds
   * one on the fly via `zoomToOthers`.
   */
  function renderOthersBox(othersBox, parentNode) {
    const { data, rect } = othersBox;

    const box = document.createElement("div");
    box.className = "treemap-box treemap-others";
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const label = document.createElement("span");
    label.className = "treemap-label";
    label.textContent = data.name;
    box.appendChild(label);

    box.addEventListener("click", (event) => {
      event.stopPropagation();
      zoomToOthers(data, parentNode);
    });

    return box;
  }

  renderModeBar();
  renderBreadcrumb();
  renderLevel();

  return { zoomTo, root };
}

function renderFallbackLogo(name) {
  const fallback = document.createElement("span");
  fallback.className = "treemap-logo-fallback";
  fallback.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return fallback;
}
```

Note: this step deliberately does **not** add the peek preview grid yet (Task 5) — it only replaces the layout mechanism and adds the clickable "Others" box, so each behavior change is verifiable on its own.

- [ ] **Step 2: Remove the now-dead `projectRect`**

`projectRect` in `app/shared/layout.js` was only ever called from `renderLevel()`, which no longer uses it (each level's boxes now come pre-positioned in stage pixel space from `computeLevelBoxes`). Delete the `projectRect` function from `app/shared/layout.js` entirely.

In `test/layout.test.js`, remove its `projectRect` import and its two tests (`"projectRect maps the focus rect itself to fill the container"` and `"projectRect scales a child rect relative to the focus rect"`).

- [ ] **Step 3: Add the `.treemap-others` style**

In `app/shared/treemap.css`, add after `.treemap-box-insufficient-history`:

```css
.treemap-others {
  background-image: repeating-linear-gradient(
    45deg,
    var(--color-border),
    var(--color-border) 4px,
    transparent 4px,
    transparent 8px
  );
  border: 1px dashed var(--color-border);
  cursor: pointer;
}
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — `test/layout.test.js` (no more `projectRect` references), plus every other suite, all green.

- [ ] **Step 5: Commit**

```bash
git add app/shared/treemap.js app/shared/layout.js app/shared/treemap.css test/layout.test.js
git commit -m "feat: compute treemap levels on demand, add zoomable Others box"
```

- [ ] **Step 6: Manual browser verification**

```bash
npm run dev
```

Open the printed URL (defaults to `http://localhost:5000`) and check, for at least two domains (e.g. `web-dev` and `data-science`):

1. Root screen shows every category as a box (today's data never exceeds capacity, so no root-level "Others" should appear).
2. Click into a category — every project shows its own box, sized by star count, same as before this change.
3. Click a project box — detail panel opens with the right data.
4. Toggle Rising mode and each window (7d/30d/90d) — box sizes update, insufficient-history striping still shows correctly.
5. Click breadcrumb links to zoom back out — works from any depth.
6. Temporarily drop `MIN_BOX_AREA_PX` to something like `80000` in `app/shared/treemap.js` (don't commit this) and reload — now root categories (and zoomed-in projects) should truncate, with a dashed "N more" box appearing; click it and confirm it zooms in showing the hidden projects as their own boxes, and the breadcrumb correctly shows `<domain> › <category> › N more`. Revert the constant back to `12000` afterward.

---

## Task 5: Peek preview grid inside category and Others boxes

Adds the decorative logo-icon preview inside any box that has children, so categories (and "Others" boxes) show tool logos immediately instead of a bare label — the part that makes the root screen look like the reference "logo landscape" layout.

**Files:**
- Modify: `app/shared/treemap.js`
- Modify: `app/shared/treemap.css`

**Interfaces:**
- Consumes: `selectTopWithOthers`, `sizeForWeight` from `app/shared/layout.js`.
- Produces: no new exports — purely additive DOM rendering inside `renderBox`/`renderOthersBox`.

- [ ] **Step 1: Add the peek constants and import**

In `app/shared/treemap.js`, change the import line to:

```js
import { buildHierarchy, computeLevelBoxes, selectTopWithOthers, sizeForWeight } from "./layout.js";
```

Add alongside the existing `MIN_BOX_AREA_PX` constant:

```js
// Same idea as MIN_BOX_AREA_PX, but for the small peek icons shown inside
// a box that itself has children — much smaller, since a peek icon is
// just a logo with no label of its own.
const MIN_PEEK_AREA_PX = 2500;
const PEEK_MIN_ICON_PX = 20;
const PEEK_MAX_ICON_PX = 64;
// Below this, a box can't fit even one peek icon plus its own padding —
// skip the peek entirely rather than render an empty or cramped grid.
const PEEK_MIN_BOX_WIDTH = 60;
const PEEK_MIN_BOX_HEIGHT = 40;
```

- [ ] **Step 2: Add `renderPeek` and `renderPeekIcon`, and call `renderPeek` from both box renderers**

In `renderBox`, right after the `if (node.children) { ... }` block's opening (before the `box.addEventListener("click", ...)` line inside that same `if`), add the peek call:

```js
    if (node.children) {
      renderPeek(box, node.children);
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        zoomTo(node);
      });
    } else if (onLeafClick) {
```

In `renderOthersBox`, after `box.appendChild(label);` and before the click listener, add:

```js
    renderPeek(box, othersBox.hiddenChildren);
```

(`othersBox` is the same parameter `renderOthersBox` already destructures `{ data, rect }` from — change that destructure to also pull `hiddenChildren`: `const { data, hiddenChildren, rect } = othersBox;`.)

Add these two new functions after `renderOthersBox` (before the final `renderModeBar(); renderBreadcrumb(); renderLevel();` calls):

```js
  /**
   * Adds a small preview grid of `children`'s (real d3 nodes, each with
   * `.value` and `.data`) top items as clickable logo icons, sized by
   * weight, inside `box` — this is what makes a category or Others box
   * show tool logos before you zoom into it. Reads `box`'s own current
   * pixel size (already set by the caller) to decide how many icons fit;
   * skips entirely if there's not enough room for even one.
   */
  function renderPeek(box, children) {
    if (!children || children.length === 0) return;

    const width = parseFloat(box.style.width);
    const height = parseFloat(box.style.height);
    if (width < PEEK_MIN_BOX_WIDTH || height < PEEK_MIN_BOX_HEIGHT) return;

    const capacity = Math.floor((width * height) / MIN_PEEK_AREA_PX);
    if (capacity < 1) return;

    const { visible, othersCount, othersWeight } = selectTopWithOthers(children, capacity);
    const weights = visible.map((child) => child.value);
    const minWeight = Math.min(...weights);
    const maxWeight = othersCount > 0 ? Math.max(...weights, othersWeight) : Math.max(...weights);
    const maxIconPx = Math.max(
      PEEK_MIN_ICON_PX,
      Math.min(PEEK_MAX_ICON_PX, Math.floor(Math.min(width, height) * 0.4)),
    );
    const sizeRange = { minPx: PEEK_MIN_ICON_PX, maxPx: maxIconPx, minWeight, maxWeight };

    const grid = document.createElement("div");
    grid.className = "treemap-peek-grid";

    for (const child of visible) {
      grid.appendChild(renderPeekIcon(child, sizeForWeight(child.value, sizeRange)));
    }

    if (othersCount > 0) {
      const tag = document.createElement("span");
      tag.className = "treemap-peek-more";
      const side = sizeForWeight(othersWeight, sizeRange);
      tag.style.width = `${side}px`;
      tag.style.height = `${side}px`;
      tag.textContent = `+${othersCount}`;
      grid.appendChild(tag);
    }

    box.appendChild(grid);
  }

  /**
   * One clickable icon inside a peek grid. Mirrors the logo-vs-fallback
   * handling `renderBox` uses for a full leaf box. Clicking opens the
   * detail panel directly for a project, or zooms in directly for a
   * (nested) category — either way `stopPropagation`'d so it doesn't also
   * trigger the containing box's own zoom-in click handler.
   */
  function renderPeekIcon(child, sidePx) {
    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "treemap-peek-icon";
    icon.style.width = `${sidePx}px`;
    icon.style.height = `${sidePx}px`;
    icon.title = child.data.name;

    if (!child.children && child.data.image) {
      const img = document.createElement("img");
      img.src = child.data.image;
      img.alt = child.data.name;
      img.onerror = () => img.replaceWith(renderFallbackLogo(child.data.name));
      icon.appendChild(img);
    } else {
      icon.appendChild(renderFallbackLogo(child.data.name));
    }

    icon.addEventListener("click", (event) => {
      event.stopPropagation();
      if (child.children) {
        zoomTo(child);
      } else if (onLeafClick) {
        onLeafClick({ ...child.data, activeSizeKey: activeSizeKey() });
      }
    });

    return icon;
  }
```

- [ ] **Step 3: Add peek CSS**

In `app/shared/treemap.css`, add after `.treemap-others`:

```css
.treemap-peek-grid {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 4px;
}

.treemap-peek-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: none;
  border-radius: 4px;
  background: var(--color-surface);
  cursor: pointer;
  overflow: hidden;
  box-sizing: border-box;
}

.treemap-peek-icon img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.treemap-peek-more {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--color-accent-soft);
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 600;
  box-sizing: border-box;
}
```

Also extend the existing dark-mode logo-background rule so peek icons get the same white backing (most logos are transparent-background SVG/PNG, illegible on a dark box otherwise): find

```css
  .treemap-logo,
  .detail-panel-logo {
    background: #fff;
    border-radius: 4px;
    padding: 2px;
  }
```

and change it to:

```css
  .treemap-logo,
  .detail-panel-logo,
  .treemap-peek-icon {
    background: #fff;
    border-radius: 4px;
    padding: 2px;
  }
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — this task added no new unit-testable logic (`renderPeek`/`renderPeekIcon` are DOM-only, per this repo's manual-verification convention for treemap.js).

- [ ] **Step 5: Commit**

```bash
git add app/shared/treemap.js app/shared/treemap.css
git commit -m "feat: add weighted logo peek preview inside category and Others boxes"
```

- [ ] **Step 6: Manual browser verification**

```bash
npm run dev
```

Open the printed URL and check, for at least two domains:

1. Root screen: every category box now shows a small grid of its top projects' logos (or fallback-letter circles where no image exists) beneath the label — no zoom needed.
2. Zoom into a category: leaf project boxes are unchanged (full logo, no peek — leaves have no children).
3. Click a peeked logo directly from the root screen (without zooming into its category first) — the detail panel opens for that exact project.
4. Click a category's label or empty space (not a peeked icon) — zooms into the category as before, not the detail panel.
5. Resize the browser window narrower/shorter (or use dev tools device toolbar) and reload — smaller category boxes show fewer/smaller peek icons or skip the peek entirely if too small; nothing overflows its box.
6. Toggle dark mode (OS-level or dev tools `prefers-color-scheme` emulation) — peek icons get a white backing plate and stay legible.
7. Re-apply the temporary `MIN_BOX_AREA_PX = 80000` trick from Task 4 Step 6 (don't commit) — confirm a dashed "Others" box also shows its own peek preview of what's hidden inside it. Revert afterward.

---

## Self-Review Notes

- **Spec coverage:** unified box+peek renderer at every depth (Tasks 4–5), weighted icon sizing via `sqrt` interpolation (Task 2's `sizeForWeight`, used by Task 5), synthetic zoomable Others node with `.parent` patching for breadcrumb continuity (Task 4), category-area sizing still via the existing weighted squarify treemap (unchanged — `computeLevelBoxes` calls the same `computeLayout`), image-coverage prerequisite (Task 1), pure/testable selection+capacity logic (Task 2–3), manual browser verification convention preserved (Tasks 4–5), graceful degradation for undersized boxes (peek skip conditions in Task 5) and broken logos (existing `onerror` fallback reused everywhere). All spec sections have a corresponding task.
- **Type consistency checked:** `computeLevelBoxes`'s `Box` shape (Task 3) matches exactly how Task 4's `renderLevel` destructures it (`box.kind`, `box.node`/`box.rect` for `"real"`, `box.data`/`box.hiddenChildren`/`box.rect` for `"others"`). `selectTopWithOthers`'s return shape (Task 2) matches every call site's destructuring in Tasks 3 and 5. `buildOthersNode`'s `{ id, name, children }` shape matches what `zoomToOthers` (Task 4) passes into `buildHierarchy`.
