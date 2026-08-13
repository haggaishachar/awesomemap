# Mobile-Responsive Treemap Stage — Design

Status: Approved
Date: 2026-08-13

## Context

The treemap stage (`app/shared/treemap.js`) is sized to a hardcoded
1000×600px via `STAGE_WIDTH`/`STAGE_HEIGHT` module constants
(`treemap.js:3-4`). That size is applied directly to the stage element's
inline `width`/`height` styles, and is also fed into `computeLevelBoxes`
as the layout's `stageWidth`/`stageHeight` — it's the one number the whole
squarify layout is built against.

Verified live on the deployed site at a 375px viewport (an iPhone-class
width): `document.body.scrollWidth` is pinned to `1000`, i.e. the entire
page overflows horizontally. Mobile visitors get forced horizontal scroll
and have to pinch-zoom just to read box labels — the map is effectively
unusable at phone width today.

The rest of the page (`treemap.css`) is otherwise already responsive: the
hero, map index grid, breadcrumb, and mode bar all use relative sizing or
`max-width` + `auto` margins with no fixed pixel widths. The stage is the
one hardcoded element.

## Goals

- The treemap stage never exceeds the viewport width — no horizontal
  page overflow, no forced pinch-zoom, at any screen size down to a
  typical phone width.
- Below a mobile breakpoint, the stage uses a taller, portrait-friendly
  aspect ratio rather than just shrinking today's landscape (5:3) shape,
  so phone users get a map that fills more of their (tall, narrow)
  screen instead of a short, squished strip.
- The stage re-fits live when the viewport changes (window resize, phone
  rotation) — no stale sizing until the next full page load.
- Stay unit-testable without a browser for the pure sizing math, matching
  this repo's existing testing convention (no jsdom/browser-automation
  tests).

## Non-goals

- Tap-target sizing (`MIN_BOX_AREA_PX`, `PEEK_MIN_BOX_WIDTH`/`HEIGHT`,
  `PEEK_MIN_TILE_PX`, and friends) is unchanged. A smaller mobile stage
  will naturally fold more items into "Others" via the existing top-N
  mechanism (`selectTopWithOthers`/`estimateCapacity`) — that's already
  how the system degrades under less area, not new behavior.
- The detail panel's fixed 320px width (`detail-panel.css` rules in
  `treemap.css:221-277`) is unchanged.
- No change to the zoom/breadcrumb navigation model, the top-N/Others
  mechanism, or the peek-preview rendering — this only changes what
  width/height value the existing layout math is handed, and when.
- No new CSS breakpoints for the mode bar, breadcrumb, or detail panel —
  those are already fluid and unaffected by this change.

## Design

### `computeStageSize`: pure sizing function (`app/shared/layout.js`)

A new pure function, alongside the existing pure geometry helpers
(`weightOf`, `computeLayout`, `estimateCapacity`, etc.), so it's testable
the same way they are — no DOM involved:

```js
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

Constants (module-level in `layout.js`, alongside the function):

| Constant | Value | Meaning |
| --- | --- | --- |
| `STAGE_MAX_WIDTH` | `1000` | Today's fixed width, now a ceiling — the stage never grows past this regardless of viewport. |
| `STAGE_SIDE_MARGIN_PX` | `16` | Reserved on each side so boxes don't render flush against the screen edge on narrow viewports. |
| `STAGE_MOBILE_BREAKPOINT_PX` | `640` | Below this *stage* width (after the side margin is subtracted), switch to the taller mobile aspect ratio. |
| `STAGE_MOBILE_HEIGHT_RATIO` | `1.3` | height = width × 1.3 below the breakpoint (e.g. a 343px-wide stage → ~446px tall). |
| `STAGE_DESKTOP_HEIGHT_RATIO` | `0.6` | height = width × 0.6 at/above the breakpoint — today's 1000×600 ratio, unchanged at full size. |

Worked example, current desktop case (`containerWidth = 1000`):
`usable = 1000 - 32 = 968`, `width = min(968, 1000) = 968` (≥ the 640
breakpoint), `height = 968 × 0.6 ≈ 581`. That's a deliberate, minor
behavior change from today's exact 1000×600 — desktop now also gets a
small breathing-room margin instead of edge-to-edge 1000px. Nothing else
depends on the literal 1000×600 number, so this is not a regression.

### Wiring into `mountTreemap` (`app/shared/treemap.js`)

- Replace the module-level `STAGE_WIDTH`/`STAGE_HEIGHT` constants with
  `let stageWidth`/`let stageHeight`, initialized from
  `computeStageSize(container.clientWidth)` at the top of `mountTreemap`,
  before the first `renderLevel()` call.
- `renderLevel()` and `renderPeek()` already read the stage size only
  through the values passed into `computeLevelBoxes` — swap their
  `STAGE_WIDTH`/`STAGE_HEIGHT` references for `stageWidth`/`stageHeight`.
  No other change needed there; the peek preview's own sizing already
  derives from the *box's* rect, not the stage constants directly, so it
  cascades automatically.
- New `resizeStage()` function: recomputes `stageWidth`/`stageHeight` from
  the container's current width, applies them to `stage.style.width`/
  `style.height`, and — only if the size actually changed — calls
  `renderLevel()` to re-lay-out the current focus level. Zoom state
  (`focusNode`, `focusIdPath`) is untouched, so the user stays at whatever
  level they'd zoomed to.
- A `ResizeObserver` on `container`, installed once after the initial
  render, calls a debounced (~150ms, plain `setTimeout`) wrapper around
  `resizeStage()` on every size change — covers both window resize and
  phone rotation.

### Testing

- `layout.test.js`: unit tests for `computeStageSize` — at the
  breakpoint, just below it, just above it, and above `STAGE_MAX_WIDTH`
  (confirms the cap holds and the ratio switch lands on the right side).
- `treemap.js`'s DOM/`ResizeObserver` wiring has no existing test
  coverage to extend (nothing in that file is unit-tested today — it's
  exercised via the browser preview instead). Verify manually in the
  browser preview at a phone width (e.g. 375px) and a desktop width,
  confirming no horizontal overflow and that resizing the viewport
  re-fits the stage.
