/**
 * Pure formatting helpers for the compare page's stat cells — star deltas,
 * percentages, and plain counts (forks/open issues). Kept dependency- and
 * DOM-free (mirrors star-history.js's split from detail-panel.js) so the
 * numeric formatting is unit-testable without a browser.
 *
 * Duplicates render-page.mjs's formatSignedStars/formatSignedPercent rather
 * than importing them: scripts/ is build-time-only and never copied into
 * dist/, so client-side code keeps its own copy — the same reason
 * detail-panel.js already duplicates its own (simpler) growth formatting.
 */

/** Formats a star delta with a sign and thousands separators, e.g. `+12,400`. */
export function formatSignedStars(starDelta) {
  const sign = starDelta > 0 ? "+" : starDelta < 0 ? "−" : "";
  return `${sign}${Math.abs(starDelta).toLocaleString("en-US")}`;
}

/** Formats a percentage with a sign, e.g. `+1.4%` or `+0.24%` (sub-1% values get a second decimal, matching render-page.mjs's own rule). */
export function formatSignedPercent(percentDelta) {
  const sign = percentDelta > 0 ? "+" : percentDelta < 0 ? "−" : "";
  const magnitude = Math.abs(percentDelta);
  return `${sign}${magnitude.toFixed(magnitude < 1 ? 2 : 1)}%`;
}

/** Formats a plain count (forks, open issues) with thousands separators, or `"—"` when it isn't a finite number (no history captured yet). */
export function formatCount(n) {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

/**
 * Formats one growth-window cell for the compare table, e.g. `"+340 (+18.4%)"`.
 * Mirrors the "not enough history" convention used everywhere else momentum
 * is shown (detail-panel.js's renderGrowthLine, render-page.mjs's
 * renderMomentumStat).
 */
export function formatGrowthCell(growth, hasEnoughHistory) {
  if (!hasEnoughHistory) {
    return growth?.oldestDate ? `Not enough history yet — first tracked ${growth.oldestDate}.` : "Not enough history yet.";
  }
  if (!growth) return "—";
  return `${formatSignedStars(growth.starDelta)} (${formatSignedPercent(growth.percentDelta)})`;
}
