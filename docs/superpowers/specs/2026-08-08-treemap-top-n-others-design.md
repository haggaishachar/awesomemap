# Treemap Top-N + Others — Design

Status: Superseded by [`2026-08-12-treemap-icon-grid-design.md`](2026-08-12-treemap-icon-grid-design.md)
Date: 2026-08-08

## Context

The treemap renderer (see [`2026-08-05-treemap-rendering-core-design.md`](2026-08-05-treemap-rendering-core-design.md))
draws one level of the hierarchy at a time: `renderLevel()` in
`app/shared/treemap.js` renders only `focusNode.children`, and only leaf
nodes (tools) get a logo — category nodes render as a label-only box
(`treemap.js:53-75`). Every domain map today is exactly two levels deep
(root → category → tool), so at the outermost zoom (map root) the viewer
sees only category boxes with no icons at all; tool logos only appear after
clicking a category to zoom into it. This was fine when `data-science` was
the only map (~11 categories), but with four more domains added
(DevOps, Security, Mobile Dev, Web Dev — each ~10 categories × ~5 tools) it's
now the first thing every visitor sees on every map.

There is currently no clustering, ranking, or box-count-limiting logic
anywhere in the renderer — every child of the focused node is always drawn,
regardless of how many there are or how small the resulting boxes get. Each
tool already carries a `weight` field (live GitHub star count, fetched by
`scripts/enrich-domain.mjs`) that's a natural ranking signal and is already
used to size boxes proportionally.

## Goals

- Show real tool icons immediately at the largest zoom (map root), not just
  after drilling into a category.
- Prevent any single treemap level from rendering more boxes than can stay
  legible, now and as maps grow (more categories, more tools per category).
- Reuse a single ranking primitive for both needs instead of two divergent
  implementations.

## Non-goals

- No changes to the data schema, `scripts/build-tree.mjs`, or how
  `data/<domain>.json` is authored/enriched — this is a render-time-only
  change.
- No change to the existing zoom/breadcrumb drill-down model.
- No deeper category nesting (subcategories) — today's data is two levels
  deep; the mechanism below generalizes to arbitrary depth but nothing in
  this spec requires it.

## Design

Two mechanisms, sharing one ranking helper.

### Shared helper: `selectTopWithOthers`

```js
selectTopWithOthers(children, capacity)
// → {
//     visible: [...top `capacity` children by weight desc, ties by name],
//     othersCount, othersWeight, othersChildren
//   }
// children.length <= capacity → passthrough, othersCount === 0
```

Pure, in `app/shared/layout.js`. Both mechanisms below call it; there is no
separate ranking logic anywhere else.

### Mechanism A — leaf preview ("peek") inside category boxes

The fix for "no icons at root." Once a category box's on-screen pixel rect
is known (after the existing layout pass), it renders a small preview strip
of its own top tool logos beneath the category label:

```
┌─────────────────────────────┐
│ Deep Learning                │
│  [🔥][🧠][⚡][+22]           │  ← top-3 logos + others chip
│                               │
└─────────────────────────────┘
```

- Chip capacity is computed from the box's actual pixel area via the shared
  `estimateCapacity(areaPx, minBoxAreaPx)` helper (passing a smaller
  `minBoxAreaPx` tuned for a logo chip rather than a full box), so it scales
  with box/screen size rather than a fixed count.
- `selectTopWithOthers(categoryLeaves, chipCapacity)` picks which logos show;
  if there are more leaves than fit, a muted `"+K"` chip is appended.
- This preview is purely decorative/additive — it does not affect the
  category box's weight-proportional size or the existing treemap layout.
- If a category box is too small to fit even one chip, the peek is skipped
  entirely (falls back to today's label-only box).

**Click behavior:**
- Clicking a previewed logo opens its detail panel directly (same panel used
  when already zoomed in) — a shortcut, `event.stopPropagation()`'d so it
  doesn't also trigger the category zoom.
- Clicking anywhere else in the box (label, background, the `"+K"` chip)
  zooms into the category, unchanged from today.

### Mechanism B — "Others" aggregate box at the rendered level

A general safety net so no single rendered level (root's categories, or a
zoomed category's leaves) ever exceeds a legible box count. Before
`buildHierarchy` sums weights, any node whose children exceed a capacity
(estimated from `STAGE_WIDTH × STAGE_HEIGHT` and a minimum legible box area)
has its lowest-weighted tail replaced by one synthetic node:

```js
{ id: "__others__", name: `+${othersCount} others`, weight: othersWeight,
  __isOthers: true, __hiddenChildren: othersChildren }
```

This synthetic node flows through the existing, unmodified `d3-hierarchy`
treemap layout like any real node — its `weight` makes it size
proportionally, so it's a real box, not a UI overlay. `renderBox()` detects
`node.data.__isOthers` and renders it as a distinct muted/dashed tile instead
of a category or leaf box.

**Click behavior:** expands in place — marks that node's id as "expanded"
(tracked in a `Set` scoped to the current focus level) and re-renders the
level with the full, un-truncated child list. No navigation/zoom involved.
The expanded set is cleared whenever `zoomTo()` changes the focus node, so
expanding "others" in one category (or at root) never leaks into a
different level's rendering.

With today's data (≤11 categories, ≤44 tools in one category) this rarely
triggers — it exists so future/larger maps degrade gracefully instead of
rendering dozens of unreadably small boxes.

## Components

- **`app/shared/layout.js`** — add `selectTopWithOthers`, `estimateCapacity`,
  and a tree-transform step (used by `buildHierarchy` or a new
  `buildDisplayHierarchy` wrapping it) that synthesizes `__isOthers` nodes
  per Mechanism B before the tree is summed/laid out.
- **`app/shared/treemap.js`** —
  - `renderLevel()`: run the synthesis step (respecting any expanded-others
    ids for the current focus) before laying out/drawing the level's boxes.
  - `renderBox()`: handle `__isOthers` nodes (Mechanism B tile + expand
    click); for category boxes, additionally call a new `renderPeek(node,
    rect)` (Mechanism A).
  - `renderPeek(node, rect)`: computes chip capacity from `rect`, calls
    `selectTopWithOthers` on `node`'s leaves, appends logo chips + optional
    `"+K"` chip with the click behaviors described above.
- **`app/shared/treemap.css`** — new classes: `.treemap-peek`,
  `.treemap-peek-logo`, `.treemap-peek-more`, `.treemap-others`.

## Data flow

Unchanged upstream: `scripts/build-tree.mjs` and the fetched
`data/<slug>/data.json` are not modified. A category's leaves are already
present in its d3 hierarchy subtree once fetched, so both mechanisms operate
entirely at render time on data already in memory — no new fetches, no
build-step changes.

## Error handling

- Fewer children than capacity (either mechanism) → passthrough, no others
  tile / no peek chip — identical to today's rendering.
- Category box too small for even one peek chip → skip the peek, fall back
  to label-only box.
- Broken peek logo → reuses the existing `onerror` → fallback-letter
  treatment already applied to the main leaf logo (`treemap.js:80`).
- Zero-leaf category (defensive; shouldn't occur given the data schema) →
  peek renders nothing extra, box behaves as a plain category box.

## Testing

- Unit tests (Node's built-in `node --test`, matching existing convention):
  - `selectTopWithOthers`: passthrough when under capacity; correct top-K +
    others count/weight sum when over; tie-break by name; capacity-1 edge
    case.
  - `estimateCapacity`: floors correctly; minimum of 1.
- Manual browser verification (matching the original treemap spec's
  convention — no automated browser testing): peek rendering at various
  category box sizes, others-tile expand-in-place, peek-chip-click-vs-box-
  click distinction, window resize behavior.

## Deployment

No deployment changes — same static Firebase Hosting setup, no new files
outside `app/shared/`.
