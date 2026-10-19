// Singular tier labels, duplicated from scripts/tiers.mjs's TIERS[].singular
// rather than imported — scripts/ is build-time-only and never copied into
// dist/ (same convention as detail-panel.js's DEFAULT_MOMENTUM_WINDOW_DAYS).
const TIER_SINGULAR_LABELS = { breakout: "Breakout", climbing: "Climbing", giants: "Giant" };

/**
 * The detail panel's rank line ("#3 Breakout in AI over 7 days") from one
 * window's `domainRank` entry (`{ tier, rank }`, stamped by generate.mjs),
 * or null when the project doesn't rank in that window.
 */
export function formatDomainRank(rankInfo, { windowDays, domainShort }) {
  if (!rankInfo || typeof rankInfo.rank !== "number") return null;
  const label = TIER_SINGULAR_LABELS[rankInfo.tier] ?? "rising";
  const where = domainShort ? `in ${domainShort}` : "in this domain";
  return `#${rankInfo.rank} ${label} ${where} over ${windowDays} days`;
}
