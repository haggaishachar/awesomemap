# Treemap Rendering Core — Design

Status: Approved
Date: 2026-08-05

## Context

`techmap` started as a small Node script (`to_html.js`) that reads a hand-curated
`data.json` (nested categories → tools, each with a name, description, link,
GitHub repo, and logo image) and renders it into flat nested HTML
(`<div>`/`<h2-3>`/`<p>`) — despite the project's name, not an actual visual
treemap. There's one existing dataset, `data-science/`, with ~60 tools and
their logo images already checked in.

The long-term goal is a web service where users can create their own maps,
add logos/entries, and vote on tech. That is a multi-tenant platform (accounts,
per-user map storage, submission/moderation, voting) — too large for one spec.
This document scopes only the **first, foundational piece**: turning the
existing static data into a real, interactive treemap visualization, with no
backend yet. Everything else (map creation platform, open-source
auto-sourcing via GitHub stars, commercial-mode manual entries + logo upload +
voting) is deferred to later specs that build on top of this.

### Sub-project sequence (for context, not all scoped here)

1. **Treemap rendering core** (this spec)
2. Map creation & hosting platform (accounts, per-map storage/routing)
3. Open-source auto-sourcing (GitHub search/API, live star counts)
4. Commercial mode: manual entries, logo upload, voting

Two competition modes are planned for later maps: open-source maps size boxes
by GitHub stars, commercial maps size boxes by votes. A project can appear in
both an open-source map and a commercial map if it has both an OSS repo and a
commercial offering. This spec's renderer is agnostic to where the sizing
number comes from — see "Data schema" below.

## Goals

- Render `data-science/data.json` (and any future map with the same schema)
  as an actual treemap: rectangles sized by weight, nested by category.
- Zoomable drill-down: click a category to zoom into its children; breadcrumb
  to zoom back out.
- Leaf boxes show a logo + name; clicking opens a detail panel with
  description, a GitHub-stars button, and an outbound link.
- Clean, shareable URLs (no `.html`, no query strings) via Firebase Hosting.
- No backend yet — static files only. Accounts, uploads, and voting are out of
  scope (deferred to sub-projects #2–#4).

## Non-goals

- User accounts, login, or any Firestore/Auth usage.
- Fetching live GitHub star counts (deferred to #3) — weights are static,
  hand-filled numbers in `data.json` for now.
- Creating new maps through a UI — new maps are still added by hand-authoring
  a new folder under `public/data/`.
- Voting or logo-upload UI.

## Architecture

A single-page static app, no framework, deployed to Firebase Hosting:

- One shell page, `public/index.html`, reads `location.pathname` (e.g.
  `/data-science`) to get the map slug.
- It fetches that map's data from a static path prefix, `public/data/<slug>/`,
  which is served as real files (not swallowed by the SPA rewrite).
- `firebase.json` declares a single catch-all rewrite (`**` → `/index.html`)
  so any path (`/data-science`, `/some-other-map`) resolves to the shell.
  This also matches the routing sub-project #2 will need once maps are
  created dynamically by users rather than as static folders, so it should
  not need rework then.
- The layout engine is D3's treemap module (`d3-hierarchy`), imported as an
  ES module (no bundler) — it turns the nested JSON tree + per-leaf weight
  into a set of nested rectangles. Rendering itself is plain DOM/CSS
  (absolutely-positioned divs sized from the computed layout), not SVG, so
  logos, text, and click targets are ordinary HTML elements.

### File layout

```
/public/
  index.html              # SPA shell: reads path, fetches map data, mounts viewer
  shared/
    treemap.js            # tree->hierarchy transform, D3 layout, zoom, rendering
    treemap.css
  data/
    data-science/
      data.json           # existing schema + new "weight" field per leaf
      images/*            # unchanged, moved from /data-science/images
/firebase.json
/.firebaserc
```

`to_html.js` and the top-level `data-science.html` are retired — superseded by
the client-side viewer. `data-science/` at the repo root is retired and
replaced by `public/data/data-science/`.

### Data schema

Category nodes are unchanged:
```json
{ "id": "ML", "name1": "Classic Machine Learning", "children": [ ... ] }
```

Leaf nodes gain a `weight` field (existing fields unchanged):
```json
{
  "id": "scikit-learn",
  "name1": "SciKit Learn",
  "image": "scikitlearn.png",
  "link": "https://scikit-learn.org/stable/",
  "desc": "Machine Learning in Python",
  "gh": "https://github.com/scikit-learn/scikit-learn",
  "weight": 58000
}
```

`weight` is an opaque number to the renderer — it does not know or care
whether it came from GitHub stars, votes, or was hand-entered. For this spec,
`weight` values for the ~60 existing `data-science` tools are hand-filled
with approximate current GitHub star counts. A missing `weight` on any leaf
defaults to `1` at render time so future data additions can't break layout.

## Components

1. **Data layer** — static `data.json` per map, plus its `images/` folder.
2. **Layout engine** — `d3-hierarchy`'s treemap (squarify tiling), converts
   the tree + weights into nested `{x0, y0, x1, y1}` rectangles.
3. **Renderer** — draws each rectangle as a positioned `<div>`. Category
   rectangles are labeled, clickable containers; leaf rectangles show a logo
   image and name, sized to fit.
4. **Zoom controller** — tracks the currently focused node. Clicking a
   category animates scale/translate to that subtree and recomputes layout
   scoped to its children; a breadcrumb trail lets the user zoom back out to
   any ancestor, including the root.
5. **Detail panel** — clicking a leaf slides in a panel with the logo, full
   description, the `github-buttons.js` star-count button (kept from the
   original script) when `gh` is present, and a link to `link`.
6. **Router/shell** — reads the path, derives the slug, fetches
   `/data/<slug>/data.json`, resolves image URLs against
   `/data/<slug>/images/`, and mounts the treemap. At the root path (`/`,
   empty slug), it instead renders a minimal index listing the available
   maps (for this spec, just a link to `/data-science`) rather than treating
   it as an unknown-slug 404 — this is the natural place sub-project #2 will
   later plug in a real "your maps" / discovery home page.

## Error handling

- Unknown slug (the `data.json` fetch 404s) → shell renders a "map not found"
  state instead of a blank page.
- Malformed/unparseable `data.json` → console error plus the same "map not
  found"-style fallback message (don't leave a blank screen).
- Leaf missing `weight` → treated as `1`.
- Missing/broken logo image (`<img>` `onerror`) → falls back to a placeholder
  box showing the tool's initial letter.

## Testing

- Pure logic gets unit tests via Node's built-in test runner (`node --test`,
  zero added dependencies): the tree→hierarchy transform, and the
  default-weight-when-missing fallback.
- Visual/interactive behavior (zoom in/out, breadcrumb, detail panel open/
  close, broken-image fallback, unknown-slug state) is verified manually in
  the browser — no automated browser testing in this spec.

## Deployment

- `firebase.json` (single catch-all rewrite as described above) and
  `.firebaserc` are committed to the repo.
- Deploy via `firebase deploy` (Firebase Hosting only — no Functions,
  Firestore, or Auth are configured in this spec).
