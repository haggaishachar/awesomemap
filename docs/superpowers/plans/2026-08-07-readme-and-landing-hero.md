# README Rewrite & Landing Page Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the README into a public-facing awesome-list-style showcase (pointing at the live site) plus a `CONTRIBUTING.md` carrying the existing dev docs, and give the landing page a hero section with a refreshed, dark-mode-aware stylesheet.

**Architecture:** Two independent doc edits (`CONTRIBUTING.md`, `README.md`) and two independent code edits (`scripts/render-page.mjs` hero markup, `app/shared/treemap.css` palette/hero/dark-mode refresh). No JS behavior, data schema, or build changes.

**Tech Stack:** Plain Markdown, Node's built-in test runner (`node --test`), hand-written CSS (custom properties, `prefers-color-scheme`).

## Global Constraints

- Live site root: `https://haggaishachar.github.io/techmap/` (from `.github/workflows/deploy.yml`: `SITE_URL=https://haggaishachar.github.io`, `BASE_PATH=/techmap`).
- Current live map: slug `data-science`, name "Best Data Science Open Source Tools", description "Machine learning, deep learning, NLP, computer vision, and more." (`data/data-science.json`).
- No `LICENSE` file exists — do not add a license section.
- `CONTRIBUTING.md` must preserve the existing dev/deploy/schema content verbatim (no rewording — only relocation), per the approved spec.
- Keep the `#2b5fad` accent color as the light-mode accent.
- `npm test` must pass after every task.

---

### Task 1: Create `CONTRIBUTING.md`

**Files:**
- Create: `CONTRIBUTING.md`
- Modify: `README.md` (delete the moved sections only — full rewrite happens in Task 2)

**Interfaces:**
- Consumes: nothing.
- Produces: `CONTRIBUTING.md`, linked from `README.md` in Task 2 as `[CONTRIBUTING.md](CONTRIBUTING.md)`.

- [ ] **Step 1: Create `CONTRIBUTING.md` with the moved content**

```markdown
# Contributing to techmap

Local development and contribution guide for techmap.

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

Generated pages emit their own URLs (stylesheet, scripts, image paths,
inter-page links, `og:image`/`og:url`), so the generator needs to know
where the site is actually served from:

- `BASE_PATH` — the path prefix under which the site is served. Defaults
  to `""` (the domain root), which is what local `npm run dev`/
  `npm run generate` use — the local server serves `dist/` from `/`.
  `haggaishachar/techmap` is a GitHub Pages *project* site, so it's
  served at `https://haggaishachar.github.io/techmap/`, not at the
  domain root — the deploy workflow sets `BASE_PATH=/techmap` to match.
- `SITE_URL` — the absolute **origin only** (e.g.
  `https://haggaishachar.github.io`, no `/techmap` suffix and no
  trailing slash), combined with `BASE_PATH` to build absolute URLs for
  `og:image`/`og:url`, which link-preview scrapers require. Don't
  include the `/techmap` path in `SITE_URL` itself — it's already added
  via `BASE_PATH`, and including it in both would produce a doubled
  `/techmap/techmap/...` URL. Unset locally (relative URLs are fine for
  local dev); set by the deploy workflow in production.

This is an explicit, documented choice, not a hidden assumption — if you
fork this repo or serve it from a different path, set these env vars to
match your own deployment.

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

- [ ] **Step 2: Verify nothing else in the repo links to the old README anchors**

Run: `grep -rn "README.md#" --include="*.md" --include="*.mjs" --include="*.yml" .`
Expected: no matches (nothing links to README section anchors), so removing those sections from README in Task 2 breaks no links.

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "Add CONTRIBUTING.md carrying the existing dev/deploy/schema docs"
```

---

### Task 2: Rewrite `README.md`

**Files:**
- Modify: `README.md` (full replacement)

**Interfaces:**
- Consumes: `CONTRIBUTING.md` (Task 1) — linked, not duplicated.
- Produces: nothing consumed by later tasks (README is a leaf doc).

- [ ] **Step 1: Replace `README.md` with the showcase rewrite**

```markdown
# techmap

**[→ Explore the live maps](https://haggaishachar.github.io/techmap/)**

Interactive, zoomable treemaps of open-source tool ecosystems. Every
rectangle is a tool; its size reflects adoption, and its place in the map
is its category. Zoom into a category to see what's inside it, click any
tool to see what it does and jump to its GitHub repo or homepage.

## Maps

| Map | Description |
| --- | --- |
| [Data Science](https://haggaishachar.github.io/techmap/data-science/) | Machine learning, deep learning, NLP, computer vision, and more. |

More domains — web dev, DevOps & infra, security, mobile dev — are on the way.

## How it works

- Each map is a curated, hand-weighted dataset of tools grouped by category.
- Click a category to zoom in; use the breadcrumb to zoom back out.
- Click any tool for a detail panel with its description, GitHub link, and homepage.

## Contributing

Want to add a tool, fix a map, or run techmap locally? See
[CONTRIBUTING.md](CONTRIBUTING.md).
```

- [ ] **Step 2: Confirm the live map table matches `data/*.json`**

Run: `for f in data/*.json; do node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(d.slug,'|',d.name,'|',d.description)" "$f"; done`
Expected: one line, `data-science | Best Data Science Open Source Tools | Machine learning, deep learning, NLP, computer vision, and more.` — matches the README table row's description text (the table uses the friendlier link text "Data Science" rather than the full display name, which is intentional awesome-list style).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Rewrite README as an awesome-list-style showcase pointing at the live site"
```

---

### Task 3: Add a hero section to the landing page

**Files:**
- Modify: `scripts/render-page.mjs:70-95` (`renderLandingPage`)
- Test: `test/render-page.test.js`

**Interfaces:**
- Consumes: nothing new — same `renderLandingPage(domains, { defaultOgImage, siteUrl, basePath })` signature.
- Produces: landing page body now contains `<header class="hero">…</header>` before `<div class="map-index">`, and `.map-index` no longer contains an `<h1>` (moved into the hero) — Task 4's CSS targets the class names introduced here (`.hero`, `.hero-motif`, `.hero-rect`, `.hero-rect-1..4`, `.hero-content`, `.hero-tagline`, `.map-index-heading`).

- [ ] **Step 1: Write the failing test**

Add to `test/render-page.test.js`:

```javascript
test("landing page renders a hero with title and tagline above the map grid", () => {
  const html = renderLandingPage(
    [{ slug: "data-science", name: "Data Science", description: "desc" }],
    { defaultOgImage: "/og-default.png", basePath: "" }
  );
  assert.match(html, /<header class="hero">/);
  assert.match(html, /<h1>techmap<\/h1>/);
  assert.match(html, /class="hero-tagline"/);
  // Hero must come before the map grid in document order.
  assert.ok(html.indexOf('class="hero"') < html.indexOf('class="map-grid"'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/render-page.test.js`
Expected: FAIL — no `class="hero"` in current output (landing page body only has `.map-index`/`<h1>`).

- [ ] **Step 3: Update `renderLandingPage` in `scripts/render-page.mjs`**

Replace the `body` template in `renderLandingPage` (currently `scripts/render-page.mjs:80-85`):

```javascript
  const body = `
    <header class="hero">
      <div class="hero-motif" aria-hidden="true">
        <span class="hero-rect hero-rect-1"></span>
        <span class="hero-rect hero-rect-2"></span>
        <span class="hero-rect hero-rect-3"></span>
        <span class="hero-rect hero-rect-4"></span>
      </div>
      <div class="hero-content">
        <h1>techmap</h1>
        <p class="hero-tagline">Interactive, zoomable maps of open-source tool ecosystems — sized by adoption, explorable by category.</p>
      </div>
    </header>
    <div class="map-index">
      <h2 class="map-index-heading">Explore the maps</h2>
      <div class="map-grid">${cards}</div>
    </div>
  `;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/render-page.test.js`
Expected: PASS, all tests in the file green (including the pre-existing card-link tests, which don't touch the hero markup).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/render-page.mjs test/render-page.test.js
git commit -m "Add hero section to the landing page"
```

---

### Task 4: Refresh `app/shared/treemap.css` (palette, hero, dark mode)

**Files:**
- Modify: `app/shared/treemap.css` (full replacement)

**Interfaces:**
- Consumes: the class names Task 3 introduced (`.hero`, `.hero-motif`, `.hero-rect`, `.hero-rect-1..4`, `.hero-content`, `.hero-tagline`, `.map-index-heading`) plus all pre-existing classes (`.treemap-stage`, `.treemap-box`, `.treemap-category`, `.treemap-leaf`, `.treemap-label`, `.treemap-logo`, `.treemap-logo-fallback`, `.treemap-breadcrumb`, `.treemap-crumb`, `.treemap-crumb-sep`, `.detail-panel`, `.detail-panel-open`, `.detail-panel-close`, `.detail-panel-logo`, `.detail-panel-link`, `.map-index`, `.map-not-found`, `.map-grid`, `.map-card`, `.back-link`).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Replace `app/shared/treemap.css` in full**

```css
:root {
  --color-bg: #f4f4f6;
  --color-surface: #ffffff;
  --color-text: #1a1a1a;
  --color-text-muted: #555555;
  --color-accent: #2b5fad;
  --color-accent-soft: rgba(43, 95, 173, 0.12);
  --color-border: #e2e2e6;
  --shadow-sm: 0 1px 4px rgba(0, 0, 0, 0.1);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.12);
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #14161c;
    --color-surface: #1e2129;
    --color-text: #edeef2;
    --color-text-muted: #a3a7b3;
    --color-accent: #6fa0e6;
    --color-accent-soft: rgba(111, 160, 230, 0.16);
    --color-border: #2c303a;
    --shadow-sm: 0 1px 4px rgba(0, 0, 0, 0.4);
    --shadow-md: 0 4px 20px rgba(0, 0, 0, 0.5);
  }
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
}

.treemap-stage {
  position: relative;
  margin: 24px auto;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.treemap-box {
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--color-surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.treemap-category {
  background: var(--color-accent-soft);
  align-items: flex-start;
  justify-content: flex-start;
  padding: 4px 6px;
  cursor: pointer;
}

.treemap-leaf {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  cursor: pointer;
  padding: 4px;
}

.treemap-label {
  font-size: 12px;
  color: var(--color-text);
}

.treemap-logo {
  max-width: 60%;
  max-height: 50%;
  object-fit: contain;
  margin-bottom: 4px;
}

.treemap-logo-fallback {
  font-size: 20px;
  font-weight: bold;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.treemap-breadcrumb {
  max-width: 1000px;
  margin: 12px auto 0;
  font-size: 14px;
}

.treemap-crumb {
  background: none;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  font: inherit;
  padding: 2px 4px;
}

.treemap-crumb:disabled {
  color: var(--color-text);
  cursor: default;
  font-weight: 600;
}

.treemap-crumb-sep {
  color: var(--color-text-muted);
}

.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: 100%;
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  padding: 20px;
  box-sizing: border-box;
  transform: translateX(100%);
  transition: transform 0.2s ease-out;
  overflow-y: auto;
}

.detail-panel-open {
  transform: translateX(0);
}

.detail-panel-close {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 22px;
  background: none;
  border: none;
  color: var(--color-text);
  cursor: pointer;
}

.detail-panel-logo {
  max-width: 100%;
  max-height: 120px;
  object-fit: contain;
  display: block;
  margin: 12px auto;
}

.detail-panel-link {
  display: inline-block;
  margin-top: 12px;
  color: var(--color-accent);
}

.hero {
  position: relative;
  overflow: hidden;
  padding: 72px 24px 56px;
  text-align: center;
  background: linear-gradient(180deg, var(--color-accent-soft), transparent);
}

.hero-motif {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.hero-rect {
  position: absolute;
  border-radius: 12px;
  background: var(--color-accent);
  opacity: 0.08;
}

.hero-rect-1 {
  width: 220px;
  height: 140px;
  top: -30px;
  left: 8%;
  transform: rotate(-6deg);
}

.hero-rect-2 {
  width: 160px;
  height: 160px;
  top: 40px;
  right: 10%;
  opacity: 0.12;
  transform: rotate(10deg);
}

.hero-rect-3 {
  width: 120px;
  height: 90px;
  bottom: -20px;
  left: 22%;
  opacity: 0.1;
  transform: rotate(4deg);
}

.hero-rect-4 {
  width: 90px;
  height: 90px;
  bottom: 10px;
  right: 22%;
  opacity: 0.14;
  transform: rotate(-12deg);
}

.hero-content {
  position: relative;
  z-index: 1;
  max-width: 640px;
  margin: 0 auto;
}

.hero h1 {
  margin: 0;
  font-size: clamp(2.5rem, 6vw, 3.5rem);
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: -0.02em;
}

.hero-tagline {
  margin: 16px 0 0;
  font-size: 1.05rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.map-index,
.map-not-found {
  box-sizing: border-box;
  max-width: 960px;
  margin: 40px auto 64px;
  padding: 0 24px;
  text-align: center;
}

.map-index-heading {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 16px;
}

.map-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  text-align: left;
}

.map-card {
  display: block;
  padding: 16px;
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  text-decoration: none;
  color: inherit;
  transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
}

.map-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.map-card h2 {
  margin: 0 0 8px;
  font-size: 16px;
  color: var(--color-accent);
}

.map-card p {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-muted);
}

.back-link {
  max-width: 1000px;
  margin: 12px auto 0;
  font-size: 14px;
}

.back-link a {
  color: var(--color-accent);
  text-decoration: none;
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS (CSS changes are not exercised by the JS test suite; this confirms nothing else broke).

- [ ] **Step 3: Regenerate and manually verify in a browser**

Run: `npm run dev`
Open `http://localhost:5000` and `http://localhost:5000/data-science/`. Check:
- Landing page shows the hero (title, tagline, faint rotated rectangles) above the map grid.
- Map cards lift slightly on hover.
- Toggle OS/browser dark mode (or DevTools → Rendering → "Emulate CSS media feature prefers-color-scheme") and confirm both pages switch to the dark palette with readable text/contrast, including the detail panel (click a tool on the data-science map).

- [ ] **Step 4: Commit**

```bash
git add app/shared/treemap.css
git commit -m "Refresh landing/domain page styles: palette variables, hero, dark mode"
```
