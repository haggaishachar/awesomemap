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
