/**
 * Extracts a map slug from a pathname like "/data-science" or
 * "/data-science/". An empty string means the root/index page.
 */
export function slugFromPath(pathname) {
  return pathname.replace(/^\/+|\/+$/g, "");
}
