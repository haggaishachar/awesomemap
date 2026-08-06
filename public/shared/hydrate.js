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
