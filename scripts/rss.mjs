const ITEM_LIMIT = 5;

/** Escapes text for safe interpolation into RSS/XML content. */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Formats a weekly snapshot's top risers as an HTML `<ul>` snippet for
 * one feed item's `<description>`. `risers` is a snapshot's `scopes.global`
 * array — awesomemap-data's `loadLeaderboardSnapshot` output, each row
 * already carrying display fields (id/name/domain/starDelta/percentDelta).
 */
function formatRiserListHtml(risers) {
  if (!risers || risers.length === 0) {
    return "<p>Not enough star-history yet for this week.</p>";
  }
  const items = risers
    .slice(0, ITEM_LIMIT)
    .map((r) => {
      const sign = r.starDelta > 0 ? "+" : "";
      const pct = r.percentDelta.toFixed(1);
      return `<li>${escapeXml(r.name)} (${escapeXml(r.domain)}) — ${sign}${r.starDelta} stars (${sign}${pct}%)</li>`;
    })
    .join("");
  return `<ul>${items}</ul>`;
}

/**
 * Builds an RSS 2.0 feed for the weekly rising leaderboard — the site's
 * first low-dependency subscription mechanism (issue #99), one `<item>`
 * per archived ISO week (awesomemap-data's `loadLeaderboardSnapshot`
 * output), newest first. This is the single global feed shipped for the
 * MVP; a per-domain feed would reuse this same shape over a snapshot's
 * `scopes[domainSlug]` slice instead of `scopes.global`, if ever added
 * later.
 *
 * Returns `null` when `siteUrl` is empty (e.g. local `npm run dev`), same
 * convention as `seo.mjs`'s `buildSitemap` — an RSS feed of relative URLs
 * isn't spec-compliant, and there's no meaningful site to subscribe to
 * locally.
 */
export function buildRisingFeed(weeklySnapshots, { siteUrl, basePath = "" }) {
  if (!siteUrl) return null;

  const origin = `${siteUrl}${basePath}`;
  const sorted = [...weeklySnapshots].sort((a, b) => b.isoWeek.localeCompare(a.isoWeek));

  const items = sorted
    .map((snapshot) => {
      const link = `${origin}/rising/archive/${snapshot.isoWeek}/`;
      const pubDate = new Date(snapshot.generatedAt).toUTCString();
      return `
    <item>
      <title>Rising this week: ${escapeXml(snapshot.isoWeek)}</title>
      <link>${link}</link>
      <guid>${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(formatRiserListHtml(snapshot.scopes?.global))}</description>
    </item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>awesomemap: Rising this week</title>
    <link>${origin}/rising/</link>
    <description>The biggest weekly star-growth risers across every awesomemap domain.</description>
    ${items}
  </channel>
</rss>
`;
}
