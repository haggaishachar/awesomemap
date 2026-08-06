import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";

/**
 * Value accessor used by d3's hierarchy.sum(). Category nodes (nodes with
 * children) contribute nothing of their own — their size comes entirely
 * from their descendants. Leaf nodes contribute their own `weight`, or `1`
 * if `weight` is missing, so a partially-filled dataset never breaks layout.
 */
export function weightOf(nodeData) {
  if (nodeData.children && nodeData.children.length > 0) return 0;
  return typeof nodeData.weight === "number" ? nodeData.weight : 1;
}

/** Wraps the raw JSON tree in a d3 hierarchy with values summed via weightOf. */
export function buildHierarchy(rootData) {
  return hierarchy(rootData, (d) => d.children).sum(weightOf);
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
