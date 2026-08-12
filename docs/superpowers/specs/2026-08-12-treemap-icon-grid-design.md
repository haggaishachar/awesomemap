# Treemap Recursive Icon Grid — Design

Status: Approved
Date: 2026-08-12

Supersedes: [`2026-08-08-treemap-top-n-others-design.md`](2026-08-08-treemap-top-n-others-design.md)
(approved but never implemented — no code or plan doc ever followed it).
That spec's two-mechanism split (a decorative "peek" strip inside
label-only category boxes, plus a separate full-leaf-treemap-with-safety-
net once zoomed in) is replaced here by one mechanism used at every depth.
Its `selectTopWithOthers`/`estimateCapacity` shape is reused.

## Context

Today, `renderLevel()` in `app/shared/treemap.js` draws exactly one level
of the hierarchy at a time — `focusNode.children` — and only leaf nodes get
a logo; a category box is label-only until you zoom into it
(`treemap.js:139-165`). Every child is always drawn, however many there
are, so a category with many tools gets many illegibly thin boxes instead
of a curated view. This was fine for the original single-domain map;
across five domains, and with real logos about to land for most tools
(see the image-coverage work landing alongside this), it's the first
impression of every map.

The reference point for this design is a "logo landscape" layout (e.g.
chiefmartec's Marketing Technology Landscape): each region shows a curated
set of the most important logos, sized by importance, with an overflow
indicator for the rest.

## Goals

- Every box that has children — at any depth, including the map root —
  shows a preview of its own top tools as logos, not just a label.
- The preview always fits the box: as a box grows (root → zoomed
  category → zoomed sub-group), more of its children are promoted from
  "hidden" to "shown," and shown icons render larger.
- Degrades gracefully to hundreds of tools in one category: only the most
  important ones are ever drawn as icons; the rest collapse into a single
  "Others" tile, itself drillable the same way.
- One rendering mechanism, reused recursively, rather than special-casing
  "root," "zoomed-in," and "too many children" separately.
- Stay unit-testable without a browser (matches existing test convention —
  no jsdom/browser-automation tests in this repo).

## Non-goals

- No data schema changes. `path` stays whatever depth it already is;
  today every domain is two levels (root → category → tool) but nothing
  here assumes that — a category-of-categories renders the same way a
  category-of-tools does.
- No change to the zoom/breadcrumb navigation model itself (`zoomTo()`,
  `focusIdPath`) — "Others" reuses it rather than replacing it.
- No change to how the *category* level's own box area is computed —
  that's still today's weight-proportional squarify treemap. This spec
  only changes what's drawn *inside* a box.

## Design

### One renderer, every depth

Any node with children — a real category, or a synthetic "Others" bucket
(below) — is drawn as: a label, plus a preview grid of its own direct
children, sized to whatever pixel rect the box currently has. There is no
separate "collapsed root" vs "zoomed" rendering path: zooming just means
`zoomTo()` makes that node's box fill the stage, so the *same* renderer
runs again with a bigger rect, and naturally promotes more children out of
"Others" (bigger rect → higher capacity). Reaching a category whose
children are leaf tools (rather than sub-categories) renders identically —
top-N tool icons plus an Others tile if there are more than fit.

Clicking a shown icon (leaf or category) still does what it does today:
a leaf opens its detail panel directly; a category zooms in. Clicking the
"Others" tile zooms into it exactly like a category (see below). Clicking
elsewhere in the box (label, empty space) zooms into that box, unchanged
from today.

### Selecting what's shown: `selectTopWithOthers` + `estimateCapacity`

Reused from the shelved spec, in `app/shared/layout.js`:

```js
estimateCapacity(areaPx, minItemAreaPx) // → Math.max(1, Math.floor(areaPx / minItemAreaPx))

selectTopWithOthers(children, capacity)
// → { visible, othersCount, othersWeight, othersChildren }
// children sorted by weight desc (ties by name) before slicing;
// children.length <= capacity → passthrough, othersCount === 0
```

Both are pure functions of numbers/arrays — no DOM — so they're directly
unit-testable. `capacity` is computed as `estimateCapacity(rectAreaPx,
MIN_ICON_AREA_PX) - 1` whenever `children.length` might exceed it (the
`-1` reserves a slot for the Others tile; skipped when everything fits
without it).

This is deliberately an *estimate*, not a live-measured fit: it avoids a
browser-only measure/re-render loop and keeps the decision testable in
plain Node. It can run a little loose (a slightly-too-small last icon) —
acceptable for a preview grid, and simpler than exactly replicating
flexbox's wrapping.

### Icon sizing (weighted)

Within the `visible` set for one box, each icon's side length:

```js
sizeForWeight(weight, { minPx, maxPx, minWeight, maxWeight })
// linear interpolation over sqrt(weight), clamped to [minPx, maxPx]
// minWeight === maxWeight (single visible child) → maxPx
```

`minPx`/`maxPx` themselves scale with the box's own rect (bigger box →
bigger min/max range), so the *same* tool can render at different sizes in
different boxes — expected, since "bigger box" already means "zoomed in,
give me more detail." The Others tile is sized the same way, using
`othersWeight` (the sum of hidden children's weight) as its input — a
large hidden pile reads as a visually bigger tile than a small one.

Layout of the sized icons inside the box is plain CSS flex-wrap — the
sizing/selection decision above is what keeps it from overflowing (with
the acceptable slack noted above); flexbox just needs to place boxes of
known sizes, not decide how many fit.

### "Others" as a zoomable synthetic node

`selectTopWithOthers`'s `othersChildren` becomes a synthetic node on
click:

```js
{ id: `${parentId}__others`, name: `${othersCount} more`, children: othersChildren }
```

Passed through `hierarchy()` and given its own small treemap layout (via
the existing `computeLayout`, sized to the stage — it doesn't need to
share a coordinate space with the rest of the tree; `zoomTo()`/
`projectRect()` only ever care about a node's rect relative to its own
children). `zoomTo()` runs unmodified — Others is just a node with
children as far as breadcrumb/navigation logic is concerned. This means
Others nests arbitrarily deep for very large categories (Others → Others
→ Others), always through the same code path.

## Components

- **`app/shared/layout.js`** — add `estimateCapacity`, `selectTopWithOthers`,
  `sizeForWeight`; a `buildOthersNode(parentId, hiddenChildren)` helper for
  the synthetic node.
- **`app/shared/treemap.js`** —
  - `renderBox()`: for any node with children (real or synthetic Others),
    call a new `renderPreviewGrid(node, rectPx)` instead of/alongside the
    label.
  - `renderPreviewGrid(node, rectPx)`: computes capacity from `rectPx`,
    calls `selectTopWithOthers`, sizes each visible child via
    `sizeForWeight`, renders icons + optional Others tile.
  - Others tile click handler: builds the synthetic node via
    `buildOthersNode`, lays it out, and calls the existing `zoomTo()`.
- **`app/shared/treemap.css`** — new classes: `.treemap-preview-grid`,
  `.treemap-preview-icon`, `.treemap-others-tile`.

## Data flow

Unchanged upstream — `scripts/build-tree.mjs` and `data/<slug>.json` are
not touched by this spec. Everything here operates at render time on data
already in memory. (The separate image-coverage work improves how many
tools *have* a logo at all — orthogonal to this spec, but this view's
usefulness depends on it landing.)

## Error handling

- Fewer children than capacity → passthrough, no Others tile — identical
  to a plain grid.
- Box too small for even one icon at `minPx` → skip the preview grid
  entirely, fall back to a label-only box (today's behavior).
- Broken tool logo → existing `onerror` fallback-letter treatment
  (`treemap.js:163`), unchanged.
- Single visible child (capacity of 1, or only one child exists) →
  `sizeForWeight` returns `maxPx`, no divide-by-zero from equal min/max
  weight.
- Zero-child node (defensive; shouldn't occur) → preview grid renders
  nothing, box behaves as a plain label-only box.

## Testing

- Unit tests (`node --test`, matching existing convention), all pure:
  - `estimateCapacity`: floors correctly, minimum of 1.
  - `selectTopWithOthers`: passthrough under capacity; correct top-K +
    others count/weight sum when over; tie-break by name; capacity-1 and
    capacity-0 edges.
  - `sizeForWeight`: clamps at both ends; single-child (min===max weight)
    case; linear interpolation midpoint check.
  - `buildOthersNode`: id/name shape, children passthrough.
- Manual browser verification (matching existing convention — no
  automated browser testing): preview grid at various box sizes, Others
  zoom-in and breadcrumb zoom-back-out, nested Others, broken-logo
  fallback, resize behavior.

## Deployment

No deployment changes — same static Firebase Hosting setup, no new files
outside `app/shared/`.
