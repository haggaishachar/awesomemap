/**
 * Groups a flat list of projects (each with a `path`: array of category
 * names from root to the project) into the nested {id, name, children} tree
 * shape the renderer expects. Categories are created implicitly from `path`
 * values, in first-appearance order — there is no separate category
 * schema. `root` supplies the id/name for the tree's root node.
 *
 * Throws if any project's `path` is not an array.
 */
export function buildTree(projects, root) {
  const rootNode = { id: root.id, name: root.name, children: [] };

  for (const project of projects) {
    if (!Array.isArray(project.path)) {
      throw new Error(`Project "${project.id}" has a non-array path`);
    }
    let node = rootNode;
    for (const categoryName of project.path) {
      let category = node.children.find((child) => child.children && child.name === categoryName);
      if (!category) {
        category = { id: categoryName, name: categoryName, children: [] };
        node.children.push(category);
      }
      node = category;
    }
    const { path, ...leafFields } = project;
    node.children.push({ ...leafFields, name: project.name ?? project.id, desc: project.desc ?? "" });
  }

  return rootNode;
}
