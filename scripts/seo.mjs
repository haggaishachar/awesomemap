/**
 * Builds a sitemap.xml document listing the landing page, the rising
 * leaderboard page, one entry per domain page, and any additional paths
 * the caller passes via `extraPaths` (e.g. the `/tags/` index and every
 * per-tag page — `generate.mjs` builds that list from the same tag slugs
 * it uses to write those pages to disk, so the sitemap and the actual
 * build output can't drift apart). `slugs` is the list of domain slugs
 * (e.g. `["data-science", "security"]`); `siteUrl`/`basePath` combine the
 * same way they do for `og:url` elsewhere in the generator. Embed pages
 * (`/embed/<slug>/`) are intentionally excluded — they're meant for
 * iframing into third-party pages, not for search discovery, and would
 * otherwise read as duplicate content of the domain pages.
 *
 * Returns `null` when `siteUrl` is empty (e.g. local `npm run dev`),
 * since a sitemap of relative URLs isn't spec-compliant and there's no
 * meaningful site to submit to a search engine locally.
 */
export function buildSitemap(slugs, { siteUrl, basePath, extraPaths = [] }) {
  if (!siteUrl) return null;

  const origin = `${siteUrl}${basePath}`;
  const urls = [
    `${origin}/`,
    `${origin}/rising/`,
    ...slugs.map((slug) => `${origin}/${slug}/`),
    ...extraPaths.map((path) => `${origin}${path}`),
  ];

  const urlEntries = urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`;
}

/**
 * Builds a robots.txt that allows full crawling and points at the
 * sitemap. Returns a sitemap-less robots.txt when `siteUrl` is empty,
 * for the same reason `buildSitemap` returns `null` in that case.
 */
export function buildRobots({ siteUrl, basePath }) {
  if (!siteUrl) return "User-agent: *\nAllow: /\n";
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}${basePath}/sitemap.xml\n`;
}

/**
 * Builds a schema.org WebSite JSON-LD object (a plain object — the caller
 * is responsible for `JSON.stringify`ing it into a `<script
 * type="application/ld+json">` block). Used once, on the landing page,
 * since a WebSite entity describes the site as a whole.
 */
export function buildWebsiteJsonLd({ name, description, url }) {
  return { "@context": "https://schema.org", "@type": "WebSite", name, description, url };
}

/**
 * Builds a schema.org ItemList JSON-LD object for one domain page, one
 * ListItem per project — in the same order the caller passes them,
 * 1-indexed per schema.org's `position` convention. `projects` is a
 * domain's flat project list (each `{ id, name, link, ... }`, the joined
 * shape `generate.mjs` builds from `data/domains/` + `data/projects/`).
 *
 * A project with no `link` is omitted rather than guessed at — `id` is
 * usually an `owner/repo` GitHub shorthand (see CONTRIBUTING.md) but isn't
 * guaranteed to be, so synthesizing a URL from it could point at nothing.
 */
export function buildItemListJsonLd(domainName, projects, { url }) {
  const itemListElement = projects
    .filter((project) => project.link)
    .map((project, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: project.name ?? project.id,
      url: project.link,
    }));
  return { "@context": "https://schema.org", "@type": "ItemList", name: domainName, url, itemListElement };
}

/**
 * Builds a schema.org SoftwareSourceCode JSON-LD object for one project's
 * canonical page — mirrors buildItemListJsonLd's plain-object style (the
 * caller JSON.stringify's it). `codeRepository` is the project's GitHub
 * URL.
 */
export function buildSoftwareSourceCodeJsonLd({ name, description, url, codeRepository }) {
  return { "@context": "https://schema.org", "@type": "SoftwareSourceCode", name, description, url, codeRepository };
}
