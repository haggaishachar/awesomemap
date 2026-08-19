/**
 * Builds a sitemap.xml document listing the landing page, the rising
 * leaderboard page, plus one entry per domain page. `slugs` is the list of
 * domain slugs (e.g. `["data-science", "security"]`); `siteUrl`/`basePath`
 * combine the same way they do for `og:url` elsewhere in the generator.
 * Embed pages (`/embed/<slug>/`) are intentionally excluded — they're meant
 * for iframing into third-party pages, not for search discovery, and would
 * otherwise read as duplicate content of the domain pages.
 *
 * Returns `null` when `siteUrl` is empty (e.g. local `npm run dev`),
 * since a sitemap of relative URLs isn't spec-compliant and there's no
 * meaningful site to submit to a search engine locally.
 */
export function buildSitemap(slugs, { siteUrl, basePath }) {
  if (!siteUrl) return null;

  const origin = `${siteUrl}${basePath}`;
  const urls = [`${origin}/`, `${origin}/rising/`, ...slugs.map((slug) => `${origin}/${slug}/`)];

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
