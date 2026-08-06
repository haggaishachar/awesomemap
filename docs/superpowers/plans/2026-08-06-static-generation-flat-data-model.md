# Static Site Generation, Flat Data Model & GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `techmap`'s client-fetch SPA (per-domain `data.json`+`tools.json`, Firebase Hosting) with a flat, one-file-per-domain data model and a hand-rolled static-site generator that produces real, Open-Graph-tagged, embeddable HTML per domain — deployed to GitHub Pages via a GitHub Action — while the existing interactive treemap (zoom, breadcrumb, detail panel) is preserved via client-side hydration of data inlined into the generated page.

**Architecture:** `data/<slug>.json` holds a flat list of tools, each tagged with a `path` (its place in the category tree); a pure `buildTree` function groups them into the nested tree shape the unchanged renderer expects. A pure `resolveImage` function matches each tool's logo by id against a per-domain images folder. `scripts/generate.mjs` orchestrates: read every domain, resolve images, build trees, render HTML (via `render-page.mjs` templating `app/index.html.template`) with the tree inlined as JSON, copy assets, and write everything to `dist/` — a gitignored build artifact a GitHub Action publishes to GitHub Pages. The new system is built and verified fully alongside the untouched old `public/`-based SPA; only the final task removes the old system, once the new one is proven working.

**Tech Stack:** Vanilla JS (ES modules, no bundler, no framework), `d3-hierarchy`, Node's built-in `node:test` runner and `node:zlib`/`node:fs` (no new npm dependencies), GitHub Actions (`actions/checkout`, `actions/setup-node`, `actions/upload-pages-artifact`, `actions/deploy-pages`).

## Global Constraints

- Flat per-domain schema: `data/<slug>.json` = `{ slug, name, description, tools: [...] }`; each tool has required `id` and `path` (array of category names), optional `name`/`desc`/`link`/`gh`/`weight`, and **no** `image` field.
- Images live at `data/<slug>/images/<id>.<any extension>`, matched to a tool by exact id at generation time — never hand-recorded in the JSON.
- No `data/maps.json` — the generator discovers domains by globbing `data/*.json`.
- `layout.js`, `treemap.js`, `detail-panel.js` carry over with unchanged logic (only their location moves from `public/shared/` to `app/shared/`); `treemap.css` carries over plus one new `.back-link` rule.
- The interactive treemap (zoom, breadcrumb, detail panel click-through) must keep working exactly as before, now hydrated from an inlined JSON blob instead of a runtime fetch.
- Embeddable variant: `dist/embed/<slug>/index.html`, identical to the domain page minus the "back to all maps" link.
- Hosting moves to GitHub Pages via a GitHub Action; the repo's default branch is `master` (not `main`) — the workflow triggers on push to `master`.
- No new npm dependencies. The OG banner image is generated with Node's built-in `zlib`, not an image library.
- `dist/` is a generated build artifact — gitignored, never committed.
- The old system (`public/`, `firebase.json`, `.firebaserc`, `test/hydrate.test.js`, `test/router.test.js`) is only removed in the final task, after the new system is verified working end-to-end.

---

## File Structure

```
/data/
  data-science.json              # NEW — flat schema
  data-science/images/<id>.<ext> # NEW — renamed-to-id logo files
/app/
  index.html.template            # NEW — shared HTML shell
  og-default.png                 # NEW — generated placeholder OG banner
  shared/
    layout.js / treemap.js / detail-panel.js / treemap.css  # copied from public/shared/, treemap.css gets one addition
  vendor/
    d3-hierarchy/                 # copied from public/vendor/
/scripts/
  build-tree.mjs                  # NEW — pure
  resolve-image.mjs               # NEW — pure
  render-page.mjs                 # NEW — HTML templating
  generate.mjs                    # NEW — orchestrator
  make-og-banner.mjs              # NEW — one-time asset generator, kept for future re-runs
/.github/workflows/
  deploy.yml                     # NEW
/test/
  build-tree.test.js              # NEW
  resolve-image.test.js           # NEW
  layout.test.js                  # unchanged
/dist/                            # generated, gitignored, never committed
```

Removed in the final task: `public/`, `firebase.json`, `.firebaserc`, `test/hydrate.test.js`, `test/router.test.js`.

---

### Task 1: `buildTree` pure function

**Files:**
- Create: `scripts/build-tree.mjs`
- Test: `test/build-tree.test.js`

**Interfaces:**
- Produces: `buildTree(tools, root)` — `tools` is an array of `{ id, path, ...otherFields }` where `path` is an array of category-name strings. `root` is `{ id, name }` for the tree's top node. Returns `{ id, name, children: [...] }` where categories are created implicitly from `path` values (in first-appearance order) and each leaf is `{ ...otherFields, name: otherFields.name ?? id, desc: otherFields.desc ?? "" }` (the `path` field itself is dropped from the leaf). Throws `Error` if any tool's `path` is not an array. Later tasks (`generate.mjs`) import this as `import { buildTree } from "./build-tree.mjs"`.

- [ ] **Step 1: Write the failing tests**

Create `test/build-tree.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/build-tree.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/build-tree.mjs`:

```js
/**
 * Groups a flat list of tools (each with a `path`: array of category names
 * from root to the tool) into the nested {id, name, children} tree shape
 * the renderer expects. Categories are created implicitly from `path`
 * values, in first-appearance order — there is no separate category
 * schema. `root` supplies the id/name for the tree's root node.
 *
 * Throws if any tool's `path` is not an array.
 */
export function buildTree(tools, root) {
  const rootNode = { id: root.id, name: root.name, children: [] };

  for (const tool of tools) {
    if (!Array.isArray(tool.path)) {
      throw new Error(`Tool "${tool.id}" has a non-array path`);
    }
    let node = rootNode;
    for (const categoryName of tool.path) {
      let category = node.children.find((child) => child.children && child.name === categoryName);
      if (!category) {
        category = { id: categoryName, name: categoryName, children: [] };
        node.children.push(category);
      }
      node = category;
    }
    const { path, ...leafFields } = tool;
    node.children.push({ ...leafFields, name: tool.name ?? tool.id, desc: tool.desc ?? "" });
  }

  return rootNode;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 7 new tests green, plus all existing tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-tree.mjs test/build-tree.test.js
git commit -m "Add buildTree to group flat tools by category path

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `resolveImage` pure function

**Files:**
- Create: `scripts/resolve-image.mjs`
- Test: `test/resolve-image.test.js`

**Interfaces:**
- Produces: `resolveImage(id, filenames)` — `id` is a tool id string, `filenames` is an array of filename strings (e.g. from `fs.readdirSync`). Returns the filename whose basename (everything before the last `.`) exactly equals `id`, or `null` if none matches. Later tasks (`generate.mjs`) import this as `import { resolveImage } from "./resolve-image.mjs"`.

- [ ] **Step 1: Write the failing tests**

Create `test/resolve-image.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveImage } from "../scripts/resolve-image.mjs";

test("matches an id to a .png file", () => {
  assert.equal(resolveImage("scikit-learn", ["scikit-learn.png", "xgboost.png"]), "scikit-learn.png");
});

test("matches an id to a non-png extension", () => {
  assert.equal(resolveImage("facenet", ["facenet.jfif", "other.png"]), "facenet.jfif");
});

test("returns null when no file matches the id", () => {
  assert.equal(resolveImage("missing-tool", ["scikit-learn.png"]), null);
});

test("does not false-match an id that's a prefix of a different file's basename", () => {
  assert.equal(resolveImage("ray", ["raytracer.png"]), null);
});

test("matches correctly when a real match coexists with a prefix decoy", () => {
  assert.equal(resolveImage("ray", ["ray.png", "raytracer.png"]), "ray.png");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../scripts/resolve-image.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/resolve-image.mjs`:

```js
/**
 * Given a tool id and a list of filenames (e.g. from fs.readdirSync),
 * returns the filename that matches `<id>.<any extension>`, or null if
 * none exists. Matches on the full id followed by a literal dot, so an id
 * that's a prefix of another file's basename (e.g. "ray" vs
 * "raytracer.png") never false-matches.
 */
export function resolveImage(id, filenames) {
  const match = filenames.find((filename) => {
    const dotIndex = filename.lastIndexOf(".");
    if (dotIndex === -1) return false;
    return filename.slice(0, dotIndex) === id;
  });
  return match ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 5 new tests green, plus all existing tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add scripts/resolve-image.mjs test/resolve-image.test.js
git commit -m "Add resolveImage to match logo files to tool ids

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Migrate `data-science` to the flat schema

**Files:**
- Create: `data/data-science.json`
- Create: `data/data-science/images/*` (renamed copies of `public/data/data-science/images/*`)

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `data/data-science.json` matching the flat schema (`{ slug, name, description, tools: [{ id, path, gh, link, name, desc, weight }] }`) that `buildTree` (Task 1) and `generate.mjs` (Task 7) expect; `data/data-science/images/<id>.<ext>` files that `resolveImage` (Task 2) expects.

This task does not touch `public/` at all — the old SPA keeps working unmodified throughout this plan. Do not delete or edit anything under `public/` in this task.

- [ ] **Step 1: Write the one-off migration script (scratchpad only — not committed)**

Write to `/tmp/claude-1000/-home-haggai-workspace-techmap/5c9edd44-64c8-4ab9-ab1e-2306ccb24a54/scratchpad/migrate-flatten.mjs`:

```js
#!/usr/bin/env node
// One-off migration: flattens an existing public/data/<slug>/{data.json,
// tools.json} pair into a single data/<slug>.json (tools array with
// `path`, no `image` field), and renames+copies each referenced image
// file to data/<slug>/images/<id>.<ext>. Run once per domain, then
// discard this script — it is not part of the shipped codebase.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

const [, , slug, oldDomainDir, newDomainDir, description] = process.argv;
if (!slug || !oldDomainDir || !newDomainDir || !description) {
  console.error("Usage: node migrate-flatten.mjs <slug> <old-domain-dir> <new-domain-dir> <description>");
  process.exit(1);
}

const tree = JSON.parse(readFileSync(`${oldDomainDir}/data.json`, "utf8"));
const tools = JSON.parse(readFileSync(`${oldDomainDir}/tools.json`, "utf8"));

const flatTools = [];

function walk(node, path) {
  for (const child of node.children) {
    if (typeof child === "string") {
      const record = tools[child];
      if (!record) throw new Error(`Tool id "${child}" missing from tools.json`);
      const { image, ...rest } = record;
      flatTools.push({ id: child, path, ...rest });
      if (image) {
        const ext = extname(image);
        const oldImagePath = `${oldDomainDir}/images/${image}`;
        const newImagePath = `${newDomainDir}/images/${child}${ext}`;
        if (!existsSync(oldImagePath)) throw new Error(`Image not found: ${oldImagePath}`);
        copyFileSync(oldImagePath, newImagePath);
      }
    } else {
      walk(child, [...path, child.name]);
    }
  }
}

mkdirSync(`${newDomainDir}/images`, { recursive: true });
walk(tree, []);

const flatDomain = { slug, name: tree.name, description, tools: flatTools };
writeFileSync(`${newDomainDir}.json`, JSON.stringify(flatDomain, null, 2) + "\n");
console.log(`Wrote ${newDomainDir}.json with ${flatTools.length} tools, and ${newDomainDir}/images/`);
```

- [ ] **Step 2: Run the migration script**

Run:
```bash
mkdir -p data
node /tmp/claude-1000/-home-haggai-workspace-techmap/5c9edd44-64c8-4ab9-ab1e-2306ccb24a54/scratchpad/migrate-flatten.mjs data-science public/data/data-science data/data-science "Machine learning, deep learning, NLP, computer vision, and more."
```
Expected output: `Wrote data/data-science.json with 44 tools, and data/data-science/images/`. (If the count differs from 44, that's fine as long as no "missing from tools.json" or "Image not found" error was thrown.)

- [ ] **Step 3: Verify the migrated file's shape**

Run: `node -e "const d = JSON.parse(require('fs').readFileSync('data/data-science.json')); console.log(d.slug, d.name, d.tools.length, JSON.stringify(d.tools[0]))"`
Expected: prints `data-science`, the domain name, the tool count from Step 2, and the first tool's JSON — confirm it has `id`, `path` (a non-empty array), and no `image` key.

Run: `grep -c '"image"' data/data-science.json`
Expected: `0` (the `image` field must not appear anywhere in the flat file).

- [ ] **Step 4: Verify images were renamed to match tool ids**

Run: `node -e "const d = JSON.parse(require('fs').readFileSync('data/data-science.json')); const fs = require('fs'); const files = fs.readdirSync('data/data-science/images'); const missing = d.tools.filter(t => !files.some(f => f.startsWith(t.id + '.'))); console.log('tools:', d.tools.length, 'images:', files.length, 'missing:', missing.map(t => t.id))"`
Expected: `missing: []` — every tool that had an image in the old data has a correspondingly renamed file; `images:` count should be ≤ `tools:` count (some tools may have had no `image` field at all in the old data, which is fine).

- [ ] **Step 5: Spot-check one entry and its image**

Run: `node -e "const d = JSON.parse(require('fs').readFileSync('data/data-science.json')); console.log(d.tools.find(t => t.id === 'scikit-learn'))"`
Expected: `{ id: 'scikit-learn', path: [ 'Classic Machine Learning' ], gh: 'https://github.com/scikit-learn/scikit-learn', link: 'https://scikit-learn.org/stable/', name: 'SciKit Learn', desc: 'Machine Learning in Python', weight: 58000 }`

Run: `ls data/data-science/images/ | grep scikit-learn`
Expected: `scikit-learn.png` (renamed from the old `scikitlearn.png`).

- [ ] **Step 6: Delete the scratchpad script**

Run: `rm /tmp/claude-1000/-home-haggai-workspace-techmap/5c9edd44-64c8-4ab9-ab1e-2306ccb24a54/scratchpad/migrate-flatten.mjs`

- [ ] **Step 7: Commit**

```bash
git add data/data-science.json data/data-science/images
git commit -m "Migrate data-science to the flat data model

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Scaffold `app/` with copied shared code

**Files:**
- Create: `app/shared/layout.js` (copy of `public/shared/layout.js`)
- Create: `app/shared/treemap.js` (copy of `public/shared/treemap.js`)
- Create: `app/shared/detail-panel.js` (copy of `public/shared/detail-panel.js`)
- Create: `app/shared/treemap.css` (copy of `public/shared/treemap.css`, plus one new rule)
- Create: `app/vendor/d3-hierarchy/*` (copy of `public/vendor/d3-hierarchy/*`)

**Interfaces:**
- Produces: `app/shared/{layout.js,treemap.js,detail-panel.js}` exporting the exact same functions as their `public/shared/` counterparts (`buildHierarchy`/`computeLayout`/`projectRect`; `mountTreemap`; `createDetailPanel`) — unchanged signatures, later tasks import from these new paths. `app/shared/treemap.css` with all existing rules plus `.back-link`.

`public/` is untouched by this task — this only adds new files under `app/`.

- [ ] **Step 1: Copy the JS files unchanged**

```bash
mkdir -p app/shared app/vendor
cp public/shared/layout.js app/shared/layout.js
cp public/shared/treemap.js app/shared/treemap.js
cp public/shared/detail-panel.js app/shared/detail-panel.js
cp public/shared/treemap.css app/shared/treemap.css
cp -r public/vendor/d3-hierarchy app/vendor/d3-hierarchy
```

- [ ] **Step 2: Verify the JS/vendor copies are byte-identical to their source**

Run: `diff public/shared/layout.js app/shared/layout.js && diff public/shared/treemap.js app/shared/treemap.js && diff public/shared/detail-panel.js app/shared/detail-panel.js && diff -r public/vendor/d3-hierarchy app/vendor/d3-hierarchy && echo "IDENTICAL"`
Expected: `IDENTICAL` (no diff output before it).

- [ ] **Step 3: Add the `.back-link` rule to the new `app/shared/treemap.css`**

In `app/shared/treemap.css`, append after the existing `.map-card p { ... }` rule (the file's last rule):

```css

.back-link {
  max-width: 1000px;
  margin: 12px auto 0;
  font-size: 14px;
}

.back-link a {
  color: #2b5fad;
  text-decoration: none;
}
```

- [ ] **Step 4: Verify `app/shared/treemap.css` differs from `public/shared/treemap.css` by only that addition**

Run: `diff public/shared/treemap.css app/shared/treemap.css`
Expected: a diff showing only the new `.back-link`/`.back-link a` rules added at the end — no other lines changed.

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: PASS — unaffected, no test covers `app/` yet.

- [ ] **Step 6: Commit**

```bash
git add app/
git commit -m "Scaffold app/ with copied shared rendering code

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Default OG banner asset

**Files:**
- Create: `scripts/make-og-banner.mjs`
- Create: `app/og-default.png` (generated output, committed as a binary asset)

**Interfaces:**
- Produces: `app/og-default.png`, a 1200×630 solid-color PNG, referenced by URL path `/og-default.png` in Task 6's `render-page.mjs`.

- [ ] **Step 1: Write the banner generator**

Create `scripts/make-og-banner.mjs`:

```js
#!/usr/bin/env node
// Generates a solid-color placeholder Open Graph banner image using only
// Node's built-in zlib (no image library / new dependency). Re-run this
// script manually if the banner's size or color ever needs to change.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function solidColorPng(width, height, [r, g, b]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor RGB
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method
  const ihdr = chunk("IHDR", ihdrData);

  const rowBytes = 1 + width * 3; // filter-type byte + RGB per pixel
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const idat = chunk("IDAT", deflateSync(raw));
  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

writeFileSync("app/og-default.png", solidColorPng(1200, 630, [43, 95, 173]));
console.log("Wrote app/og-default.png");
```

- [ ] **Step 2: Run it**

Run: `node scripts/make-og-banner.mjs`
Expected: `Wrote app/og-default.png`.

- [ ] **Step 3: Verify the output is a valid PNG of the right size**

Run: `node -e "const b = require('fs').readFileSync('app/og-default.png'); console.log('signature ok:', b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))); console.log('width:', b.readUInt32BE(16), 'height:', b.readUInt32BE(20))"`
Expected: `signature ok: true` and `width: 1200 height: 630`.

Then use the Read tool on `app/og-default.png` to visually confirm it displays as a solid blue rectangle (no corruption/garbage pixels).

- [ ] **Step 4: Commit**

```bash
git add scripts/make-og-banner.mjs app/og-default.png
git commit -m "Add default OG banner image generator and output

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: HTML template and `render-page.mjs`

**Files:**
- Create: `app/index.html.template`
- Create: `scripts/render-page.mjs`

**Interfaces:**
- Produces: `renderDomainPage(domain, tree, options)` — `domain` is `{ slug, name, description }`, `tree` is a `buildTree` (Task 1) result, `options` is `{ embed?: boolean, defaultOgImage: string }`. Returns a full HTML document string. `renderLandingPage(domains, options)` — `domains` is an array of `{ slug, name, description }`, `options` is `{ defaultOgImage: string }`. Returns a full HTML document string. Later tasks (`generate.mjs`, Task 7) import both as `import { renderDomainPage, renderLandingPage } from "./render-page.mjs"`.

- [ ] **Step 1: Write the HTML shell template**

Create `app/index.html.template`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{{TITLE}}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta property="og:title" content="{{OG_TITLE}}" />
  <meta property="og:description" content="{{OG_DESCRIPTION}}" />
  <meta property="og:image" content="{{OG_IMAGE}}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{{OG_TITLE}}" />
  <meta name="twitter:description" content="{{OG_DESCRIPTION}}" />
  <meta name="twitter:image" content="{{OG_IMAGE}}" />
  <link rel="stylesheet" href="/shared/treemap.css" />
  <script type="importmap">
  {
    "imports": {
      "d3-hierarchy": "/vendor/d3-hierarchy/index.js"
    }
  }
  </script>
</head>
<body>
{{BODY}}
</body>
</html>
```

- [ ] **Step 2: Write `render-page.mjs`**

Create `scripts/render-page.mjs`:

```js
import { readFileSync } from "node:fs";

const TEMPLATE = readFileSync(new URL("../app/index.html.template", import.meta.url), "utf8");

/** Escapes text for safe interpolation into HTML content. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escapes "</" sequences so embedded JSON can't prematurely close its <script> tag. */
function escapeScriptJson(json) {
  return json.replace(/</g, "\\u003c");
}

function renderShell({ title, ogTitle, ogDescription, ogImage, body }) {
  return TEMPLATE.replace(/{{TITLE}}/g, escapeHtml(title))
    .replace(/{{OG_TITLE}}/g, escapeHtml(ogTitle))
    .replace(/{{OG_DESCRIPTION}}/g, escapeHtml(ogDescription))
    .replace(/{{OG_IMAGE}}/g, escapeHtml(ogImage))
    .replace("{{BODY}}", body);
}

/**
 * Renders a domain's full page (or its chrome-free embed variant, when
 * `embed` is true). `domain` is { slug, name, description }. `tree` is
 * buildTree's output, with images already resolved onto each leaf.
 */
export function renderDomainPage(domain, tree, { embed = false, defaultOgImage }) {
  const backLink = embed ? "" : `<p class="back-link"><a href="/">&larr; All maps</a></p>`;
  const imageBaseUrl = `/${domain.slug}/images/`;
  const body = `
    <div id="app"></div>
    ${backLink}
    <script type="application/json" id="map-data">${escapeScriptJson(JSON.stringify(tree))}</script>
    <script type="module">
      import { mountTreemap } from "/shared/treemap.js";
      import { createDetailPanel } from "/shared/detail-panel.js";
      const mapData = JSON.parse(document.getElementById("map-data").textContent);
      const imageBaseUrl = ${JSON.stringify(imageBaseUrl)};
      const panel = createDetailPanel(document.body, imageBaseUrl);
      mountTreemap(document.getElementById("app"), mapData, imageBaseUrl, (leafData) => panel.open(leafData));
    </script>
  `;
  return renderShell({
    title: domain.name,
    ogTitle: domain.name,
    ogDescription: domain.description ?? "",
    ogImage: defaultOgImage,
    body,
  });
}

/** Renders the landing page listing every domain. `domains` is an array of { slug, name, description }. */
export function renderLandingPage(domains, { defaultOgImage }) {
  const cards = domains
    .map(
      (domain) => `
        <a class="map-card" href="/${domain.slug}">
          <h2>${escapeHtml(domain.name)}</h2>
          <p>${escapeHtml(domain.description ?? "")}</p>
        </a>`
    )
    .join("");
  const body = `
    <div class="map-index">
      <h1>techmap</h1>
      <div class="map-grid">${cards}</div>
    </div>
  `;
  return renderShell({
    title: "techmap",
    ogTitle: "techmap",
    ogDescription: "A community-curated map of open-source technology.",
    ogImage: defaultOgImage,
    body,
  });
}
```

- [ ] **Step 3: Sanity-check the output with a throwaway script (not committed)**

Run:
```bash
node -e "
import('./scripts/render-page.mjs').then(({ renderDomainPage, renderLandingPage }) => {
  const domain = { slug: 'data-science', name: 'Data Science', description: 'A domain description' };
  const tree = { id: 'data-science', name: 'Data Science', children: [{ id: 'x', name: 'X', desc: 'Has a literal </script> tag in it' }] };
  const page = renderDomainPage(domain, tree, { embed: false, defaultOgImage: '/og-default.png' });
  console.log('has title:', page.includes('<title>Data Science</title>'));
  console.log('has og:image:', page.includes('content=\"/og-default.png\"'));
  console.log('has back-link:', page.includes('back-link'));
  console.log('script safely escaped:', page.includes('\\\\u003c/script') && !page.includes('Has a literal </script> tag'));
  const embedPage = renderDomainPage(domain, tree, { embed: true, defaultOgImage: '/og-default.png' });
  console.log('embed has no back-link:', !embedPage.includes('back-link'));
  const landing = renderLandingPage([domain], { defaultOgImage: '/og-default.png' });
  console.log('landing has card:', landing.includes('map-card') && landing.includes('href=\"/data-science\"'));
});
"
```
Expected: every line prints `true`.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: PASS — unaffected (this module has no automated test, per the design's decision to verify HTML templating manually rather than with unit tests).

- [ ] **Step 5: Commit**

```bash
git add app/index.html.template scripts/render-page.mjs
git commit -m "Add HTML shell template and render-page.mjs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `generate.mjs` orchestrator

**Files:**
- Create: `scripts/generate.mjs`

**Interfaces:**
- Consumes: `buildTree(tools, root)` (Task 1), `resolveImage(id, filenames)` (Task 2), `renderDomainPage(domain, tree, options)`/`renderLandingPage(domains, options)` (Task 6). Reads every `data/*.json` domain file and each domain's `data/<slug>/images/` folder. Reads `app/shared/`, `app/vendor/`, `app/og-default.png` (Tasks 4–5).
- Produces: `dist/` — the full generated site. No other task imports from `generate.mjs`; it's the top-level entry point invoked directly (`node scripts/generate.mjs`).

- [ ] **Step 1: Write `generate.mjs`**

Create `scripts/generate.mjs`:

```js
#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, cpSync } from "node:fs";
import { buildTree } from "./build-tree.mjs";
import { resolveImage } from "./resolve-image.mjs";
import { renderDomainPage, renderLandingPage } from "./render-page.mjs";

const DATA_DIR = "data";
const DIST_DIR = "dist";
const APP_DIR = "app";
const DEFAULT_OG_IMAGE = "/og-default.png";

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

const domainFiles = readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"));
const domains = [];

for (const file of domainFiles) {
  const domainPath = `${DATA_DIR}/${file}`;
  const domain = JSON.parse(readFileSync(domainPath, "utf8"));
  const slug = domain.slug;

  if (!Array.isArray(domain.tools)) {
    throw new Error(`${domainPath}: "tools" must be an array`);
  }

  const imagesDir = `${DATA_DIR}/${slug}/images`;
  let imageFilenames = [];
  try {
    imageFilenames = readdirSync(imagesDir);
  } catch {
    imageFilenames = [];
  }

  const resolvedTools = domain.tools.map((tool) => {
    if (!tool.id || !Array.isArray(tool.path)) {
      throw new Error(`${domainPath}: tool missing "id" or non-array "path": ${JSON.stringify(tool)}`);
    }
    const image = resolveImage(tool.id, imageFilenames);
    return image ? { ...tool, image } : tool;
  });

  const tree = buildTree(resolvedTools, { id: slug, name: domain.name });

  mkdirSync(`${DIST_DIR}/${slug}/images`, { recursive: true });
  mkdirSync(`${DIST_DIR}/embed/${slug}`, { recursive: true });

  writeFileSync(
    `${DIST_DIR}/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: false, defaultOgImage: DEFAULT_OG_IMAGE })
  );
  writeFileSync(
    `${DIST_DIR}/embed/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: true, defaultOgImage: DEFAULT_OG_IMAGE })
  );

  for (const filename of imageFilenames) {
    copyFileSync(`${imagesDir}/${filename}`, `${DIST_DIR}/${slug}/images/${filename}`);
  }

  domains.push({ slug, name: domain.name, description: domain.description ?? "" });
}

writeFileSync(`${DIST_DIR}/index.html`, renderLandingPage(domains, { defaultOgImage: DEFAULT_OG_IMAGE }));

cpSync(`${APP_DIR}/shared`, `${DIST_DIR}/shared`, { recursive: true });
cpSync(`${APP_DIR}/vendor`, `${DIST_DIR}/vendor`, { recursive: true });
copyFileSync(`${APP_DIR}/og-default.png`, `${DIST_DIR}/og-default.png`);

console.log(`Generated ${domains.length} domain(s) into ${DIST_DIR}/`);
```

- [ ] **Step 2: Run it**

Run: `node scripts/generate.mjs`
Expected: `Generated 1 domain(s) into dist/`.

- [ ] **Step 3: Verify the generated output's structure**

Run: `find dist -maxdepth 3 -type d | sort`
Expected includes: `dist`, `dist/data-science`, `dist/data-science/images`, `dist/embed`, `dist/embed/data-science`, `dist/shared`, `dist/vendor`.

Run: `test -f dist/index.html && test -f dist/data-science/index.html && test -f dist/embed/data-science/index.html && test -f dist/og-default.png && echo "ALL PRESENT"`
Expected: `ALL PRESENT`.

Run: `grep -c 'scikit-learn.png' dist/data-science/index.html`
Expected: a non-zero count (the inlined tree JSON references the resolved image filename).

Run: `ls dist/data-science/images | wc -l`
Expected: matches the image count from Task 3's Step 4 verification.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: PASS — unaffected (`generate.mjs` is I/O orchestration, verified manually here and again in Task 9's end-to-end pass, per the design's decision not to unit test it).

- [ ] **Step 5: Commit**

```bash
git add scripts/generate.mjs
git commit -m "Add generate.mjs static site generator orchestrator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Note: `dist/` itself is not committed — it doesn't exist in `.gitignore` yet at this point in the plan (that's added in Task 10), so confirm `git status` doesn't show `dist/` as untracked-and-about-to-be-added before running `git add scripts/generate.mjs` — use the explicit path (`git add scripts/generate.mjs`, not `git add .`) so `dist/` is never staged.

---

### Task 8: GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:** none — a standalone CI workflow, not imported by anything.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: node scripts/generate.mjs
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate the YAML syntax**

Run: `node -e "const {readFileSync} = require('fs'); const yaml = readFileSync('.github/workflows/deploy.yml','utf8'); console.log('lines:', yaml.split('\n').length)"` (a full YAML parse isn't available without a new dependency; this just confirms the file is readable). Also visually re-read the file to confirm indentation is consistent (2 spaces) and every `- uses:`/`- run:` step is nested correctly under its `steps:` list, since a YAML indentation error would only surface when GitHub Actions actually parses it.

This workflow cannot be fully verified from this environment — it requires an actual push and the repository's Pages source set to "GitHub Actions" (a one-time manual step in repo Settings → Pages, not part of this file). Note this limitation in the commit; actual CI verification happens after this plan is merged and pushed.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "Add GitHub Actions workflow to generate and deploy to GitHub Pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end manual verification (new system)

**Files:** none — verification only. `public/` remains untouched and fully functional throughout this task; both the old and new systems coexist.

**Interfaces:** none.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: PASS — all tests from Tasks 1–2 plus the pre-existing `layout.test.js` (12 build-tree/resolve-image tests + 9 layout tests = 21; the exact count depends on Tasks 1–2's final test counts, but there must be zero failures).

- [ ] **Step 2: Regenerate and serve the new site**

Run: `node scripts/generate.mjs && npx --yes serve dist -l 5001`
(Using port 5001, distinct from the old system's port 5000, in case both are ever run side by side.)

- [ ] **Step 3: Verify the landing page**

Open `http://localhost:5001/`. Expected: a "techmap" heading and one card, "Best Data Science Open Source Tools", linking to `/data-science`.

- [ ] **Step 4: Verify the domain page is fully interactive**

Click through to `http://localhost:5001/data-science/`. Expected: the same category boxes, sizes, labels, and logos as the current live `public/`-based site; clicking a category zooms in with a working breadcrumb; clicking a leaf opens the detail panel with logo, description, GitHub star button, and outbound link; a "← All maps" link back to `/` is visible and works.

- [ ] **Step 5: Verify the embed variant**

Open `http://localhost:5001/embed/data-science/` directly. Expected: the same interactive treemap, but with no "← All maps" link. Then create a throwaway local HTML file (e.g. `/tmp/embed-test.html`, not part of the repo) containing `<iframe src="http://localhost:5001/embed/data-science/" width="800" height="600"></iframe>` and open it in a browser — confirm the treemap renders and is clickable inside the iframe.

- [ ] **Step 6: Verify Open Graph tags**

Run: `curl -s http://localhost:5001/data-science/ | grep -E 'og:(title|description|image)'`
Expected: three lines showing the domain's name, description, and `/og-default.png` as the `og:image` content.

- [ ] **Step 7: Verify the missing-image fallback still works**

Temporarily rename one image file, e.g.:
```bash
mv data/data-science/images/scikit-learn.png data/data-science/images/scikit-learn.png.bak
node scripts/generate.mjs
```
Reload `http://localhost:5001/data-science/`, find the SciKit Learn box, confirm it now shows no logo image (just the text label — this is the existing, unchanged behavior for a tool with no resolved `image` at all, distinct from a broken URL). Revert:
```bash
mv data/data-science/images/scikit-learn.png.bak data/data-science/images/scikit-learn.png
node scripts/generate.mjs
```

- [ ] **Step 8: Stop the server and confirm a clean state**

Stop the `serve` process. Run: `git status --short`
Expected: no output (Step 7's temporary rename was fully reverted and re-generated; `dist/` is untracked and won't appear unless `.gitignore` already excludes it — if `dist/` shows as untracked here, that's expected and fine at this point in the plan, since `.gitignore` isn't updated until Task 10).

---

### Task 10: Remove the old system and update config/docs

**Files:**
- Delete: `public/` (entire directory)
- Delete: `firebase.json`
- Delete: `.firebaserc`
- Delete: `test/hydrate.test.js`
- Delete: `test/router.test.js`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:** none — this is cleanup and documentation, not new code. Nothing produced here is consumed elsewhere.

Only start this task after Task 9's end-to-end verification passed — this task deletes the old system's safety net.

- [ ] **Step 1: Delete the old system's files**

```bash
git rm -r public/
git rm firebase.json .firebaserc
git rm test/hydrate.test.js test/router.test.js
```

- [ ] **Step 2: Update `package.json`'s scripts**

Replace the `"scripts"` block in `package.json`:

```json
  "scripts": {
    "test": "node --test",
    "vendor:d3": "rm -rf public/vendor/d3-hierarchy && mkdir -p public/vendor && cp -r node_modules/d3-hierarchy/src public/vendor/d3-hierarchy",
    "dev": "npx --yes serve public -l 5000"
  },
```

with:

```json
  "scripts": {
    "test": "node --test",
    "generate": "node scripts/generate.mjs",
    "vendor:d3": "rm -rf app/vendor/d3-hierarchy && mkdir -p app/vendor && cp -r node_modules/d3-hierarchy/src app/vendor/d3-hierarchy",
    "dev": "npm run generate && npx --yes serve dist -l 5000"
  },
```

- [ ] **Step 3: Update `.gitignore`**

Replace the full contents of `.gitignore`:

```
node_modules/
.superpowers/
```

with:

```
node_modules/
.superpowers/
dist/
```

(The `firebase-debug.log` line is dropped — Firebase tooling is no longer part of this project.)

- [ ] **Step 4: Rewrite `README.md`**

Replace the full contents of `README.md`:

```markdown
# techmap

Turns a curated list of open-source tools into an interactive, zoomable
treemap — generated as static HTML and deployed to GitHub Pages.

## Develop

    npm install
    npm run dev

Generates `dist/` from `data/*.json` and serves it at
http://localhost:5000. Re-run `npm run dev` (or just `npm run generate`)
after editing any data file to regenerate.

## Test

    npm test

## Deploy

Deployment is automatic: pushing to `master` triggers
`.github/workflows/deploy.yml`, which runs the generator and publishes
`dist/` to GitHub Pages. The repository's Pages source must be set to
"GitHub Actions" in Settings → Pages (one-time setup, not part of the
workflow file).

## Adding a new map

Add `data/<slug>.json`:

    {
      "slug": "<slug>",
      "name": "Display Name",
      "description": "One-line description shown on the landing page.",
      "tools": [
        {
          "id": "some-tool",
          "path": ["Category Name"],
          "name": "Some Tool",
          "gh": "https://github.com/owner/repo",
          "link": "https://example.com",
          "desc": "What it does.",
          "weight": 1000
        }
      ]
    }

- `id` and `path` are required on every tool. `path` is the breadcrumb of
  category names from root to the tool (a single-level category is a
  one-element array; deeper nesting is a longer array).
- `name`, `desc`, `link`, `gh`, and `weight` may be omitted.
- Add a logo at `data/<slug>/images/<id>.<any extension>` — it's matched
  to the tool by id automatically, whatever format it's in.

Run `npm run generate` to confirm it builds before opening a PR.
```

- [ ] **Step 5: Verify no stale references remain**

Run: `grep -n "public/\|firebase" README.md package.json`
Expected: no output.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests from Tasks 1–2 plus `layout.test.js`, nothing referencing the deleted `hydrate.test.js`/`router.test.js`.

- [ ] **Step 7: Verify the new scripts work end-to-end**

Run: `npm run generate`
Expected: `Generated 1 domain(s) into dist/` (same as Task 9, now via the `npm run generate` alias).

Run: `git status --short`
Expected: only shows the deletions and modifications from this task's Steps 1–4 (plus possibly `data/` and other files from earlier tasks if this is being run as one continuous session) — `dist/` must NOT appear, confirming `.gitignore`'s new `dist/` line is working.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Remove Firebase Hosting SPA in favor of the static generator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
