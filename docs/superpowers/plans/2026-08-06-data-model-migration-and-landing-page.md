# Data Model Migration & Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `techmap`'s per-domain data from one file of embedded tool objects to a two-file model (`data.json` tree + `tools.json` leaf records), add a `maps.json` registry, and redesign the landing page to list every registered domain — the foundation spec #2 (community automation) and spec #3 (new domain content) build on.

**Architecture:** `data.json` becomes a pure category tree whose leaves are bare tool-id strings; a new `tools.json` per domain holds the full leaf records keyed by id. A new pure function, `hydrateTree`, merges the two into the fully-embedded-object tree the existing renderer (`layout.js`/`treemap.js`/`detail-panel.js`) already expects, so the rendering engine itself is untouched. `main.js` fetches both files and a new `public/data/maps.json` registry, which also drives a redesigned card-grid landing page.

**Tech Stack:** Vanilla JS (ES modules, no bundler), `d3-hierarchy`, Node's built-in `node:test` runner. No new dependencies.

## Global Constraints

- Two-file schema per domain: `data.json` (category tree only, leaf entries are bare tool-id strings) + `tools.json` (dictionary of leaf records keyed by id) — see spec's "Data schema" section.
- Rename the `name1` field to `name` everywhere (data files and renderer code).
- No accounts, backend, login, or in-site submission UI.
- No CI, validation script, or bot automation — that's spec #2.
- No new domain content — only `data-science` is migrated in this plan.
- `layout.js`'s hierarchy/layout math and `treemap.js`/`detail-panel.js`'s rendering structure are otherwise unchanged — only field-name and data-loading wiring changes.
- No new npm dependencies.

---

## File Structure

```
/public/
  data/
    maps.json                  # NEW — registry: [{ slug, name, description }]
    data-science/
      data.json                # REWRITTEN — tree only, string leaf refs, `name`
      tools.json                # NEW — leaf records keyed by id
      images/                   # unchanged
  shared/
    hydrate.js                  # NEW — hydrateTree(tree, tools) pure function
    main.js                     # MODIFIED — fetch data.json+tools.json+maps.json, hydrate, registry-based index
    treemap.js                  # MODIFIED — name1 -> name
    detail-panel.js             # MODIFIED — name1 -> name
    treemap.css                 # MODIFIED — landing page card grid
    layout.js / router.js       # unchanged
/test/
  hydrate.test.js               # NEW
  layout.test.js / router.test.js  # unchanged
```

---

### Task 1: `hydrateTree` pure function

**Files:**
- Create: `public/shared/hydrate.js`
- Test: `test/hydrate.test.js`

**Interfaces:**
- Produces: `hydrateTree(node, tools)` — `node` is either a category object (`{ id, name, children }`, where each entry in `children` is itself a category object or a bare tool-id string) or, in recursive calls, a bare tool-id string. `tools` is a plain object keyed by tool id, e.g. `{ "scikit-learn": { name, desc, ... } }`. Returns a new tree with every string leaf replaced by `{ id, ...tools[id] }`. Throws `Error` if a referenced id is missing from `tools`, or if a non-string node has no `children` array. Later tasks (`main.js`) import this as `import { hydrateTree } from "./hydrate.js"`.

- [ ] **Step 1: Write the failing tests**

Create `test/hydrate.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../public/shared/hydrate.js'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `public/shared/hydrate.js`:

```js
/**
 * Merges a category tree (data.json shape: leaf entries are bare tool-id
 * strings) with a tools dictionary (tools.json shape: id -> tool record)
 * into the fully-embedded-object tree the renderer expects. Pure function,
 * no I/O.
 *
 * Throws if the tree references a tool id missing from `tools`, or if a
 * non-leaf node has no `children` array — both indicate malformed map data
 * the caller should treat as a load failure.
 */
export function hydrateTree(node, tools) {
  if (typeof node === "string") {
    if (!Object.prototype.hasOwnProperty.call(tools, node)) {
      throw new Error(`Unknown tool id "${node}" referenced in category tree`);
    }
    return { id: node, ...tools[node] };
  }
  if (!Array.isArray(node.children)) {
    throw new Error(`Category node "${node.id}" is missing a children array`);
  }
  return { ...node, children: node.children.map((child) => hydrateTree(child, tools)) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 5 new tests green, plus existing `layout.test.js`/`router.test.js` unaffected.

- [ ] **Step 5: Commit**

```bash
git add public/shared/hydrate.js test/hydrate.test.js
git commit -m "Add hydrateTree to merge category tree with tools dictionary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Migrate `data-science`'s data files to the two-file model

**Files:**
- Modify: `public/data/data-science/data.json` (rewritten in place)
- Create: `public/data/data-science/tools.json`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `public/data/data-science/data.json` matching the tree-only shape `hydrateTree` (Task 1) and `main.js` (Task 4) expect; `public/data/data-science/tools.json` matching the dictionary shape they expect.

The site will not render `data-science` correctly again until Task 4 lands — that's expected mid-migration; don't run `npm run dev` to check it after this task alone.

- [ ] **Step 1: Write the one-off migration script (scratchpad only — not committed)**

Write to `/tmp/claude-1000/-home-haggai-workspace-techmap/5c9edd44-64c8-4ab9-ab1e-2306ccb24a54/scratchpad/migrate-data-science.mjs`:

```js
#!/usr/bin/env node
// One-off migration: splits the old embedded-object data.json into a new
// tree-only data.json (string leaf refs, `name` field) + a tools.json
// dictionary of leaf records. Run once against data-science's data.json,
// then discard this script — it is not part of the shipped codebase.
import { readFileSync, writeFileSync } from "node:fs";

const [, , dataPath] = process.argv;
if (!dataPath) {
  console.error("Usage: node migrate-data-science.mjs <path/to/data.json>");
  process.exit(1);
}

const old = JSON.parse(readFileSync(dataPath, "utf8"));
const tools = {};

function migrateNode(node) {
  if (!node.children) {
    const { id, name1, image, link, desc, gh, weight } = node;
    if (tools[id]) throw new Error(`Duplicate tool id: ${id}`);
    tools[id] = { gh, image, link, name: name1, desc, weight };
    return id;
  }
  const { id, name1, children } = node;
  return { id, name: name1, children: children.map(migrateNode) };
}

const newTree = migrateNode(old);
const toolCount = Object.keys(tools).length;
console.log(`Migrated ${toolCount} tools.`);

writeFileSync(dataPath, JSON.stringify(newTree, null, 2) + "\n");
const toolsPath = dataPath.replace(/data\.json$/, "tools.json");
writeFileSync(toolsPath, JSON.stringify(tools, null, 2) + "\n");
console.log(`Wrote ${dataPath} and ${toolsPath}`);
```

- [ ] **Step 2: Run the migration script**

Run: `node /tmp/claude-1000/-home-haggai-workspace-techmap/5c9edd44-64c8-4ab9-ab1e-2306ccb24a54/scratchpad/migrate-data-science.mjs public/data/data-science/data.json`
Expected output: `Migrated 44 tools.` followed by a line confirming both files were written. (If the count printed differs from 44, that's fine as long as it's non-zero and no "Duplicate tool id" error was thrown — it means the source file's leaf count was mis-estimated, not that anything went wrong.)

- [ ] **Step 3: Verify the migrated `data.json` is tree-only**

Run: `grep -c '"weight"' public/data/data-science/data.json`
Expected: `0` (no leaf fields should remain in the tree file).

Run: `grep -c 'name1' public/data/data-science/data.json public/data/data-science/tools.json`
Expected: `0` for both files (the rename to `name` applied everywhere).

- [ ] **Step 4: Verify `tools.json` parses and has one entry per migrated tool**

Run: `node -e "const t = require('./public/data/data-science/tools.json'); console.log(Object.keys(t).length)"`
Expected: same count as Step 2's "Migrated N tools" line.

- [ ] **Step 5: Spot-check one entry**

Run: `node -e "console.log(require('./public/data/data-science/tools.json')['scikit-learn'])"`
Expected: `{ gh: 'https://github.com/scikit-learn/scikit-learn', image: 'scikitlearn.png', link: 'https://scikit-learn.org/stable/', name: 'SciKit Learn', desc: 'Machine Learning in Python', weight: 58000 }`

- [ ] **Step 6: Delete the scratchpad script**

Run: `rm /tmp/claude-1000/-home-haggai-workspace-techmap/5c9edd44-64c8-4ab9-ab1e-2306ccb24a54/scratchpad/migrate-data-science.mjs`

- [ ] **Step 7: Commit**

```bash
git add public/data/data-science/data.json public/data/data-science/tools.json
git commit -m "Migrate data-science to the two-file data model

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Rename `name1` to `name` in the renderer

**Files:**
- Modify: `public/shared/treemap.js:39,71,78,79`
- Modify: `public/shared/detail-panel.js:30,36`

**Interfaces:**
- Consumes: nothing new — these functions already receive a hydrated node's `.data` (in `treemap.js`) or a hydrated leaf record (in `detail-panel.js`); only the field name they read changes.
- Produces: no interface change — `mountTreemap` and `createDetailPanel`'s exported signatures are unchanged.

- [ ] **Step 1: Update `treemap.js`**

In `public/shared/treemap.js`, change all four `name1` occurrences to `name`:

```js
      crumb.textContent = node.data.name1;
```
becomes
```js
      crumb.textContent = node.data.name;
```

```js
    label.textContent = node.data.name1;
```
becomes
```js
    label.textContent = node.data.name;
```

```js
      img.alt = node.data.name1;
      img.onerror = () => img.replaceWith(renderFallbackLogo(node.data.name1));
```
becomes
```js
      img.alt = node.data.name;
      img.onerror = () => img.replaceWith(renderFallbackLogo(node.data.name));
```

- [ ] **Step 2: Update `detail-panel.js`**

In `public/shared/detail-panel.js`, change both `name1` occurrences to `name`:

```js
      img.alt = leafData.name1;
```
becomes
```js
      img.alt = leafData.name;
```

```js
    title.textContent = leafData.name1;
```
becomes
```js
    title.textContent = leafData.name;
```

- [ ] **Step 3: Verify no `name1` references remain in the renderer**

Run: `grep -rn "name1" public/shared/`
Expected: no output.

- [ ] **Step 4: Run the existing test suite**

Run: `npm test`
Expected: PASS — `layout.test.js`, `router.test.js`, and `hydrate.test.js` (Task 1) are all unaffected by this rename since none of them touch `treemap.js`/`detail-panel.js`.

- [ ] **Step 5: Commit**

```bash
git add public/shared/treemap.js public/shared/detail-panel.js
git commit -m "Rename name1 to name in treemap and detail panel rendering

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire `main.js`'s `loadMap` to the two-file model

**Files:**
- Modify: `public/shared/main.js:1-3,35-51`

**Interfaces:**
- Consumes: `hydrateTree(node, tools)` from `./hydrate.js` (Task 1); `mountTreemap(container, mapData, imageBaseUrl, onLeafClick)` from `./treemap.js` (unchanged signature); `createDetailPanel(container, imageBaseUrl)` from `./detail-panel.js` (unchanged signature).
- Produces: no exported interface — `main.js` is the app entry point, not imported elsewhere.

- [ ] **Step 1: Add the `hydrateTree` import**

In `public/shared/main.js`, change:

```js
import { mountTreemap } from "./treemap.js";
import { createDetailPanel } from "./detail-panel.js";
import { slugFromPath } from "./router.js";
```

to:

```js
import { mountTreemap } from "./treemap.js";
import { createDetailPanel } from "./detail-panel.js";
import { slugFromPath } from "./router.js";
import { hydrateTree } from "./hydrate.js";
```

- [ ] **Step 2: Replace `loadMap` to fetch and hydrate both files**

Replace the existing `loadMap` function (currently the last function in the file):

```js
function loadMap(slug) {
  const imageBaseUrl = `/data/${slug}/images/`;
  const panel = createDetailPanel(document.body, imageBaseUrl);

  fetch(`/data/${slug}/data.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`data.json fetch failed with ${response.status}`);
      return response.json();
    })
    .then((mapData) => {
      mountTreemap(app, mapData, imageBaseUrl, (leafData) => panel.open(leafData));
    })
    .catch((error) => {
      console.error(`Failed to load map "${slug}":`, error);
      renderNotFound(slug);
    });
}
```

with:

```js
function loadMap(slug) {
  const imageBaseUrl = `/data/${slug}/images/`;
  const panel = createDetailPanel(document.body, imageBaseUrl);

  Promise.all([
    fetchJson(`/data/${slug}/data.json`),
    fetchJson(`/data/${slug}/tools.json`),
  ])
    .then(([tree, tools]) => {
      const hydrated = hydrateTree(tree, tools);
      mountTreemap(app, hydrated, imageBaseUrl, (leafData) => panel.open(leafData));
    })
    .catch((error) => {
      console.error(`Failed to load map "${slug}":`, error);
      renderNotFound(slug);
    });
}

function fetchJson(url) {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url} fetch failed with ${response.status}`);
    return response.json();
  });
}
```

- [ ] **Step 3: Run the existing test suite**

Run: `npm test`
Expected: PASS — `main.js` has no unit tests (consistent with the project's existing pattern of only unit-testing pure logic; `main.js`'s DOM/fetch wiring is verified manually in Task 6).

- [ ] **Step 4: Commit**

```bash
git add public/shared/main.js
git commit -m "Fetch data.json and tools.json, hydrate before mounting treemap

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Map registry and redesigned landing page

**Files:**
- Create: `public/data/maps.json`
- Modify: `public/shared/main.js:14-23` (the `renderMapIndex` function)
- Modify: `public/shared/treemap.css:127-140`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `public/data/maps.json`, an array of `{ slug, name, description }`, fetched by `renderMapIndex()`. No other file consumes this in this plan (spec #2's validator will later).

- [ ] **Step 1: Create the registry**

Create `public/data/maps.json`:

```json
[
  {
    "slug": "data-science",
    "name": "Best Data Science Open Source Tools",
    "description": "Machine learning, deep learning, NLP, computer vision, and more."
  }
]
```

- [ ] **Step 2: Replace `renderMapIndex` to fetch the registry**

In `public/shared/main.js`, replace:

```js
function renderMapIndex() {
  app.innerHTML = `
    <div class="map-index">
      <h1>techmap</h1>
      <ul>
        <li><a href="/data-science">Best Data Science Open Source Tools</a></li>
      </ul>
    </div>
  `;
}
```

with:

```js
function renderMapIndex() {
  fetch("/data/maps.json")
    .then((response) => {
      if (!response.ok) throw new Error(`maps.json fetch failed with ${response.status}`);
      return response.json();
    })
    .then((maps) => {
      app.innerHTML = `
        <div class="map-index">
          <h1>techmap</h1>
          <div class="map-grid">
            ${maps
              .map(
                (map) => `
              <a class="map-card" href="/${map.slug}">
                <h2>${map.name}</h2>
                <p>${map.description}</p>
              </a>
            `
              )
              .join("")}
          </div>
        </div>
      `;
    })
    .catch((error) => {
      console.error("Failed to load map registry:", error);
      renderIndexError();
    });
}

function renderIndexError() {
  app.innerHTML = `
    <div class="map-not-found">
      <h1>techmap</h1>
      <p>Couldn't load the list of maps. Please try again later.</p>
    </div>
  `;
}
```

- [ ] **Step 3: Replace the landing page list styles with a card grid**

In `public/shared/treemap.css`, replace:

```css
.map-index ul {
  list-style: none;
  padding: 0;
}

.map-index li {
  margin: 12px 0;
}
```

with:

```css
.map-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  margin-top: 24px;
  text-align: left;
}

.map-card {
  display: block;
  padding: 16px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  text-decoration: none;
  color: inherit;
}

.map-card h2 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #2b5fad;
}

.map-card p {
  margin: 0;
  font-size: 13px;
  color: #555;
}
```

- [ ] **Step 4: Run the existing test suite**

Run: `npm test`
Expected: PASS — no logic under test here; this task is UI/data wiring, verified manually in Task 6.

- [ ] **Step 5: Commit**

```bash
git add public/data/maps.json public/shared/main.js public/shared/treemap.css
git commit -m "Add map registry and card-grid landing page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end manual verification

**Files:** none (verification only; fixes go back into the task that caused them if anything fails).

**Interfaces:** none — this task exercises the whole app through the browser.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: PASS — all tests from Tasks 1–5 combined, plus the pre-existing `layout.test.js`/`router.test.js`.

- [ ] **Step 2: Start the Firebase emulator**

Run: `npx firebase-tools emulators:start --only hosting`
Expected: serves `public/` at `http://localhost:5000` with the clean-URL rewrite from `firebase.json` applied (needed for every routed path below — the plain `npm run dev` static server does not apply it, per the README).

- [ ] **Step 3: Verify the landing page**

Open `http://localhost:5000/`. Expected: a "techmap" heading and one card, "Best Data Science Open Source Tools", linking to `/data-science`.

- [ ] **Step 4: Verify the migrated map renders identically to before**

Click through to `/data-science`. Expected: the same category boxes, sizes, labels, and logos as before this migration; clicking a category zooms in with a working breadcrumb; clicking a leaf opens the detail panel with logo, description, GitHub star button, and outbound link — no `undefined` text anywhere (which would indicate a missed `name1`/`name` rename).

- [ ] **Step 5: Verify the missing-image fallback still works**

In `public/data/data-science/tools.json`, temporarily rename `"image": "scikitlearn.png"` under `scikit-learn` to `"image": "does-not-exist.png"`. Reload `/data-science`, find the SciKit Learn box, confirm it shows a fallback initial-letter placeholder ("S") instead of a broken image icon. Revert the change (`git checkout public/data/data-science/tools.json`).

- [ ] **Step 6: Verify the unknown-slug fallback still works**

Navigate to `http://localhost:5000/nonexistent-map`. Expected: "Map not found" message with a link back to `/`.

- [ ] **Step 7: Verify the registry-fetch-failure fallback**

Temporarily rename `public/data/maps.json` to `public/data/maps.json.bak`, reload `/`. Expected: "Couldn't load the list of maps" message, not a blank page. Rename it back (`mv public/data/maps.json.bak public/data/maps.json`).

- [ ] **Step 8: Stop the dev server and do a final status check**

Run: `git status`
Expected: clean working tree (Step 5 and Step 7's temporary edits were reverted, nothing left uncommitted).
