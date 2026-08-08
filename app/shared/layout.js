import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";

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
 * Projects a node's global rect (as set by computeLayout) into pixel
 * coordinates for display, given that `focusRect` currently fills the
 * container. This is what makes "zooming into a category" work: the
 * category's own rect maps to fill the container, and its children's rects
 * scale/translate the same way.
 */
export function projectRect(rect, focusRect, containerWidth, containerHeight) {
  const focusWidth = focusRect.x1 - focusRect.x0;
  const focusHeight = focusRect.y1 - focusRect.y0;
  const scaleX = containerWidth / focusWidth;
  const scaleY = containerHeight / focusHeight;
  return {
    left: (rect.x0 - focusRect.x0) * scaleX,
    top: (rect.y0 - focusRect.y0) * scaleY,
    width: (rect.x1 - rect.x0) * scaleX,
    height: (rect.y1 - rect.y0) * scaleY,
  };
}
