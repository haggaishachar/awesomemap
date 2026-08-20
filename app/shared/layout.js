import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { formatStarCount } from "./star-history.js";

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
// Fallback only — used when the caller can't supply the viewport's actual
// available height (e.g. a caller that hasn't measured the DOM yet).
// Whenever a real `availableHeight` is passed in, it wins on mobile; see
// `computeStageSize`.
const STAGE_MOBILE_HEIGHT_RATIO = 1.3;
const STAGE_DESKTOP_HEIGHT_RATIO = 0.6; // matches the original 1000x600.
// Floor on the mobile stage height so a squeezed viewport (e.g. a
// landscape phone with the on-screen keyboard open) still gets a usable
// stage instead of a sliver.
const STAGE_MIN_MOBILE_HEIGHT_PX = 280;

/**
 * Computes the stage's `{width, height}` from the width available to it
 * (typically its container's `clientWidth`) and, optionally, the height
 * available below it in the viewport (`availableHeight` — typically the
 * viewport height minus whatever's already stacked above the stage, e.g.
 * the mode bar and breadcrumb).
 *
 * Width is capped at `STAGE_MAX_WIDTH`. At/above `STAGE_MOBILE_BREAKPOINT_PX`
 * the stage keeps the desktop landscape ratio (`STAGE_DESKTOP_HEIGHT_RATIO`)
 * regardless of `availableHeight` — desktop only scrolls a little past the
 * fold today and isn't meant to fill the window. Below the breakpoint, the
 * stage instead fills `availableHeight` (floored at
 * `STAGE_MIN_MOBILE_HEIGHT_PX`) so a phone visitor gets a map that uses the
 * actual screen instead of a fixed, height-agnostic ratio; if
 * `availableHeight` isn't a finite number (caller hasn't measured the DOM
 * yet), it falls back to the same width-ratio heuristic as before.
 *
 * Called once at mount and again on every resize/orientation change (see
 * `mountTreemap`'s `resizeStage` in `treemap.js`) — this is the only place
 * stage size is decided.
 */
export function computeStageSize(containerWidth, availableHeight) {
  const usable = Math.max(0, containerWidth - STAGE_SIDE_MARGIN_PX * 2);
  const width = Math.min(usable, STAGE_MAX_WIDTH);
  if (width >= STAGE_MOBILE_BREAKPOINT_PX) {
    return { width, height: width * STAGE_DESKTOP_HEIGHT_RATIO };
  }
  const height = Number.isFinite(availableHeight)
    ? Math.max(availableHeight, STAGE_MIN_MOBILE_HEIGHT_PX)
    : width * STAGE_MOBILE_HEIGHT_RATIO;
  return { width, height };
}

/**
 * Value accessor used by d3's hierarchy.sum(). Category nodes (nodes with
 * children) contribute nothing of their own — their size comes entirely
 * from their descendants. A leaf contributes its `sizes[sizeKey]` value
 * when present (the precomputed Popular/Rising size for the active mode),
 * falling back to its `weight` (or `1` if that's missing too) — so older
 * data without a `sizes` object, or a `sizeKey` no `sizes` entry exists
 * for, never breaks layout.
 */
export function weightOf(nodeData, sizeKey = "popular") {
  if (nodeData.children && nodeData.children.length > 0) return 0;
  const sizes = nodeData.sizes;
  if (sizes && typeof sizes[sizeKey] === "number") return sizes[sizeKey];
  return typeof nodeData.weight === "number" ? nodeData.weight : 1;
}

/**
 * Wraps the raw JSON tree in a d3 hierarchy with values summed via
 * weightOf for the given `sizeKey` ("popular", "rising7", "rising30", or
 * "rising90").
 */
export function buildHierarchy(rootData, sizeKey = "popular") {
  return hierarchy(rootData, (d) => d.children).sum((d) => weightOf(d, sizeKey));
}

/**
 * Computes x0/y0/x1/y1 on every node of the hierarchy, in a coordinate
 * space sized [0, width] x [0, height]. Mutates and returns `root`.
 */
export function computeLayout(root, width, height) {
  treemap()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(2)
    .paddingOuter(4)(root);
  return root;
}

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

/**
 * Builds a leaf box's accessible label for screen readers: the project's
 * name plus a short size context that a sighted visitor reads off the
 * box's *area* — the star count in Popular mode, or the star-growth stat
 * in Rising mode — information a screen reader has no other way to get,
 * since the box carries no visible number of its own. Mirrors
 * `detail-panel.js`'s own growth-line wording (star delta before percent,
 * "not enough history yet" for a too-new project) so the two stay
 * consistent. `leafData` is a leaf node's own `.data` (`name`, `weight`,
 * `growth`, `hasEnoughHistory`); `sizeKey` is the currently active
 * `"popular" | "rising7" | "rising30" | "rising90"` key.
 */
export function leafAriaLabel(leafData, sizeKey) {
  const name = leafData.name ?? leafData.id ?? "";

  if (sizeKey === "popular" || !sizeKey) {
    const stars = formatStarCount(leafData.weight);
    return stars ? `${name}, ${stars} stars` : name;
  }

  if (leafData.hasEnoughHistory && leafData.hasEnoughHistory[sizeKey] === false) {
    return `${name}, not enough history yet`;
  }

  const stats = leafData.growth?.[sizeKey];
  if (!stats) return name;

  const windowDays = sizeKey.replace("rising", "");
  const sign = stats.starDelta >= 0 ? "+" : "";
  const percent = Math.round(stats.percentDelta);
  return `${name}, ${sign}${stats.starDelta} stars (${sign}${percent}%) in ${windowDays} days`;
}

/**
 * Builds a category box's accessible label: its name plus how many
 * projects it contains — again, information otherwise conveyed only by
 * the box's visual size.
 */
export function categoryAriaLabel(name, leafCount) {
  return `${name}, category with ${leafCount} project${leafCount === 1 ? "" : "s"}`;
}

/** Builds the synthetic "N more" box's accessible label. */
export function othersAriaLabel(hiddenCount) {
  return `${hiddenCount} more project${hiddenCount === 1 ? "" : "s"}`;
}
