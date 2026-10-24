// scripts/badge.mjs
// The README badge every project page offers its maintainer
// (`/projects/<owner>/<repo>/badge.svg`, written by generate.mjs and
// rebuilt with the rest of the site daily). Shields.io's flat style, so it
// sits naturally next to a repo's existing build/license badges, with
// awesomemap's treemap glyph (the same one renderMapBadge in
// render-page.mjs uses) on the label side.

import { TIERS, DEFAULT_TIER } from "./tiers.mjs";
import { isoWeekBounds } from "./iso-week.mjs";

export const BADGE_LABEL = "awesomemap";

// Message-side colors, one per kind of claim pickBadgeClaim can make.
export const BADGE_COLORS = {
  rising: "#d9661f",
  peak: "#9a4f1a",
  growing: "#1a8a4a",
  categoryRank: "#2b5fad",
  listed: "#6e7781",
};

// A project at or below this 7-day growth falls through to its category
// rank instead — "+0.2% stars this week" on a big, steady project reads as
// a weak claim, not a good one.
export const MIN_GROWING_PERCENT = 1;

// Category ranks past this, or in the bottom half of the category, are
// left off the badge for the same reason ("#180 of 212" or "#5 of 6"
// isn't something a maintainer wants in their README).
export const MAX_CATEGORY_RANK = 10;

const TIER_SINGULAR = Object.fromEntries(TIERS.map((tier) => [tier.key, tier.singular]));

/**
 * Picks the strongest claim that's true of a project today, in priority
 * order: a rank on its domain's 7-day Rising leaderboard, then its best
 * archived Rising rank (dated), then 7-day star growth, then a top-10 star
 * rank in its category, then plain "listed in".
 * A Rising rank only carries its growth suffix at MIN_GROWING_PERCENT or
 * more, for the same reason. Never a decline — a slow week falls through
 * to the next claim down, so the badge never makes a project look worse
 * than leaving it off would.
 *
 * `risingRank` is `{ tier, rank }` (the same shape as a leaf's
 * `domainRank.rising7`) or null; `growth7d` is a `growth.rising7` entry
 * plus `hasEnoughHistory`; `categoryRank` is `{ rank, of }` or null.
 *
 * `peakRank` (a `bestArchivedRanks` entry, or null) is the best rank the
 * project reached in any archived week. It comes right after a live rank:
 * without it, a badge added during a spike would fall back to "listed in"
 * the week after, which is when a maintainer would take it down. It's
 * dated, so it never passes for this week's standing. A domain-scoped peak
 * is named via `domainShortBySlug` — it can come from another domain the
 * project is also curated into — falling back to `domainShort`.
 */
export function pickBadgeClaim({ risingRank, peakRank = null, growth7d, categoryRank, categoryName, domainShort, domainShortBySlug = {} }) {
  if (risingRank && typeof risingRank.rank === "number") {
    const label = TIER_SINGULAR[risingRank.tier] ?? "Rising";
    const growthSuffix = growth7d?.hasEnoughHistory && growth7d.percentDelta >= MIN_GROWING_PERCENT ? ` · ${formatPercent(growth7d.percentDelta)} 7d` : "";
    return { message: `#${risingRank.rank} ${label} in ${domainShort}${growthSuffix}`, color: BADGE_COLORS.rising };
  }
  if (peakRank && typeof peakRank.rank === "number") {
    const label = TIER_SINGULAR[peakRank.tier] ?? "Rising";
    const where = peakRank.scope === "global" ? "overall" : `in ${domainShortBySlug[peakRank.scope] ?? domainShort}`;
    return { message: `#${peakRank.rank} ${label} ${where} · ${isoWeekMonth(peakRank.isoWeek)}`, color: BADGE_COLORS.peak };
  }
  if (growth7d?.hasEnoughHistory && growth7d.starDelta > 0 && growth7d.percentDelta >= MIN_GROWING_PERCENT) {
    return { message: `▲ ${formatPercent(growth7d.percentDelta)} stars this week`, color: BADGE_COLORS.growing };
  }
  if (categoryName && categoryRank && categoryRank.rank <= MAX_CATEGORY_RANK && categoryRank.rank <= categoryRank.of / 2) {
    return { message: `#${categoryRank.rank} of ${categoryRank.of} in ${categoryName}`, color: BADGE_COLORS.categoryRank };
  }
  return { message: `listed in ${categoryName ?? domainShort}`, color: BADGE_COLORS.listed };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 2026" for an ISO week label, taken from the week's closing Sunday. */
export function isoWeekMonth(isoWeek) {
  const { end } = isoWeekBounds(isoWeek);
  return `${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
}

const TIER_KEYS = new Set(TIERS.map((tier) => tier.key));

/**
 * Orders two archived ranks: lower rank wins; at equal rank a global rank
 * beats a domain one (the harder list to top), then the earlier week wins
 * (the date it was first reached is the one worth citing).
 */
function isBetterPeak(candidate, incumbent) {
  if (!incumbent) return true;
  if (candidate.rank !== incumbent.rank) return candidate.rank < incumbent.rank;
  const candidateGlobal = candidate.scope === "global";
  if (candidateGlobal !== (incumbent.scope === "global")) return candidateGlobal;
  return candidate.isoWeek < incumbent.isoWeek;
}

/**
 * Every project's best rank across `weeklySnapshots` (awesomemap-data's
 * archived weekly leaderboards, `loadLeaderboardSnapshot` outputs), as a
 * Map of id → `{ rank, tier, scope, isoWeek }` — pickBadgeClaim's
 * `peakRank`. Reads the tiered `<tier>:<scope>` keys; a pre-tier snapshot
 * (only plain `<scope>` keys) is read as Breakout, which is what those
 * plain keys hold in tiered snapshots too. Spiking is skipped — it isn't a
 * size tier. `knownScopes`, when given, drops ranks in a scope that no
 * longer exists (a since-removed domain), whose name a badge couldn't print.
 */
export function bestArchivedRanks(weeklySnapshots, { knownScopes = null } = {}) {
  const best = new Map();
  for (const snapshot of weeklySnapshots) {
    const scopes = snapshot?.scopes ?? {};
    const keys = Object.keys(scopes);
    const tiered = keys.some((key) => key.includes(":"));
    for (const key of keys) {
      let tier = DEFAULT_TIER;
      let scope = key;
      if (key.includes(":")) {
        [tier, scope] = key.split(":");
        if (!TIER_KEYS.has(tier)) continue;
      } else if (tiered) {
        continue; // a copy of `breakout:<scope>`, already counted
      }
      if (knownScopes && !knownScopes.has(scope)) continue;
      for (const row of scopes[key] ?? []) {
        if (!row?.id || typeof row.rank !== "number") continue;
        const candidate = { rank: row.rank, tier, scope, isoWeek: snapshot.isoWeek };
        if (isBetterPeak(candidate, best.get(row.id))) best.set(row.id, candidate);
      }
    }
  }
  return best;
}

function formatPercent(percent) {
  return `+${percent.toFixed(1)}%`;
}

/**
 * Each project's 1-based star rank within its top-level category
 * (`path[0]`), per domain — `Map<projectId, { rank, of }>`. Ties keep the
 * domain's own project order, so a rerun never shuffles equal-star rows.
 */
export function computeCategoryRanks(projects) {
  const byCategory = new Map();
  for (const project of projects) {
    const category = project.path?.[0];
    if (category === undefined) continue;
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(project);
  }
  const ranks = new Map();
  for (const members of byCategory.values()) {
    const sorted = [...members].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    sorted.forEach((project, index) => ranks.set(project.id, { rank: index + 1, of: sorted.length }));
  }
  return ranks;
}

// 11px DejaVu Sans advance widths for printable ASCII (32–126), measured
// in Chromium. Verdana — the badge's first-choice font, as in shields.io —
// runs close to these, and every <text> below carries an explicit
// textLength anyway, so whichever font a viewer actually has gets
// stretched or squeezed to the same box rather than overflowing it.
const ASCII_WIDTHS = [
  3.5, 4.4, 5.1, 9.2, 7, 10.5, 8.6, 3, 4.3, 4.3, 5.5, 9.2, 3.5, 4, 3.5, 3.7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 3.7, 3.7, 9.2, 9.2, 9.2, 5.8,
  11, 7.5, 7.5, 7.7, 8.5, 7, 6.3, 8.5, 8.3, 3.2, 3.2, 7.2, 6.1, 9.5, 8.2, 8.7, 6.6, 8.7, 7.6, 7, 6.7, 8.1, 7.5, 10.9, 7.5, 6.7, 7.5, 4.3,
  3.7, 4.3, 9.2, 5.5, 5.5, 6.7, 7, 6, 7, 6.8, 3.9, 7, 7, 3.1, 3.1, 6.4, 3.1, 10.7, 7, 6.7, 7, 7, 4.5, 5.7, 4.3, 7, 6.5, 9, 6.5, 6.5, 5.8,
  7, 3.7, 7, 9.2,
];
const OTHER_WIDTHS = { "·": 3.5, "▲": 8.5 };
const FALLBACK_WIDTH = 7;

/** Estimated rendered width, in px, of `text` at the badge's 11px font size. */
export function measureText(text) {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    width += code >= 32 && code <= 126 ? ASCII_WIDTHS[code - 32] : (OTHER_WIDTHS[char] ?? FALLBACK_WIDTH);
  }
  return width;
}

function escapeXml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const LABEL_COLOR = "#24292f";
const PADDING = 6;
const LOGO_WIDTH = 14;
const LOGO_GAP = 4;

/**
 * Renders a flat, 20px-tall two-part badge SVG: the treemap glyph and
 * `label` on the left, `message` on a `color` background on the right.
 * Self-contained (no external font or image), and every `id` is unique
 * to this one SVG's own content, so it renders the same as an `<img>` in
 * a README or inlined into a page beside another badge.
 */
export function renderBadgeSvg({ label = BADGE_LABEL, message, color }) {
  const labelTextWidth = Math.round(measureText(label));
  const messageTextWidth = Math.round(measureText(message));
  const labelWidth = PADDING + LOGO_WIDTH + LOGO_GAP + labelTextWidth + PADDING;
  const messageWidth = PADDING + messageTextWidth + PADDING;
  const width = labelWidth + messageWidth;
  const labelX = PADDING + LOGO_WIDTH + LOGO_GAP;
  const messageX = labelWidth + PADDING;
  const safeLabel = escapeXml(label);
  const safeMessage = escapeXml(message);
  const text = (x, textWidth, content) =>
    `<text x="${x}" y="15" fill="#010101" fill-opacity=".3" textLength="${textWidth}" lengthAdjust="spacingAndGlyphs">${content}</text>` +
    `<text x="${x}" y="14" textLength="${textWidth}" lengthAdjust="spacingAndGlyphs">${content}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${safeLabel}: ${safeMessage}">
<title>${safeLabel}: ${safeMessage}</title>
<linearGradient id="am-badge-shine" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="am-badge-round"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#am-badge-round)"><rect width="${labelWidth}" height="20" fill="${LABEL_COLOR}"/><rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${escapeXml(color)}"/><rect width="${width}" height="20" fill="url(#am-badge-shine)"/></g>
<g transform="translate(${PADDING},3) scale(.4375)"><rect width="18" height="32" rx="2" fill="#4f86d6"/><rect x="20" width="12" height="14" rx="2" fill="#9cc2f2"/><rect x="20" y="16" width="12" height="16" rx="2" fill="#2fb36a"/></g>
<g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">${text(labelX, labelTextWidth, safeLabel)}${text(messageX, messageTextWidth, safeMessage)}</g>
</svg>
`;
}

/**
 * The same claim as a shields.io endpoint document
 * (https://shields.io/badges/endpoint-badge), written next to badge.svg as
 * badge.json, for a maintainer who wants one of shields' own styles
 * (`for-the-badge`, `flat-square`, …) instead.
 */
export function buildShieldsEndpoint({ label = BADGE_LABEL, message, color }) {
  return { schemaVersion: 1, label, message, color: color.replace(/^#/, "") };
}

/** The Markdown snippet a project page's "Add badge" panel hands its maintainer to paste into their README. */
export function buildBadgeMarkdown(badgeUrl, pageUrl) {
  return `[![awesomemap](${badgeUrl})](${pageUrl})`;
}
