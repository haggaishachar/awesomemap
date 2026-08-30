/**
 * Builds dist/compare-index.json's per-project records — a compact,
 * cross-domain-lookup-ready summary of every canonical project, so the
 * static /compare/ page can resolve arbitrary project ids client-side
 * without knowing which domain each one belongs to. Pure: takes data
 * generate.mjs's Pass 4 already has in hand for each project (no I/O, no
 * recomputation of growth or the momentum signal).
 */

/**
 * Rounds every window's `percentDelta` to 2 decimal places — the most
 * precision compare-format.js's formatSignedPercent ever displays (see its
 * `.toFixed(magnitude < 1 ? 2 : 1)`) — while leaving `starDelta` (already an
 * integer) and `oldestDate` untouched. Full floating-point precision on
 * `percentDelta` (e.g. `0.9328104909234664`) buys nothing the UI ever shows
 * and meaningfully bloats dist/compare-index.json across hundreds of
 * projects × three windows each.
 */
function roundGrowth(growth) {
  const rounded = {};
  for (const [key, window] of Object.entries(growth)) {
    rounded[key] = { ...window, percentDelta: Math.round(window.percentDelta * 100) / 100 };
  }
  return rounded;
}

/**
 * `project` is a sized, domain-attributed project record (see
 * velocity.mjs's computeProjectSizing and generate.mjs's
 * `allProjectsWithDomain`). `historySeries` is `starHistoryFor`'s
 * oldest-first output for this project (already computed by the caller for
 * the star-history chart) — its last entry, when present, supplies current
 * forks/open-issue counts (see snapshot-history.mjs's buildSnapshotEntry,
 * which captures them for exactly this purpose). `signalHeadline` is the
 * `explainSignal` headline the caller already computed for this project's
 * own page — reused here, not recomputed.
 */
export function buildCompareRecord(project, { historySeries = [], signalHeadline = null } = {}) {
  const latest = historySeries.length > 0 ? historySeries[historySeries.length - 1] : null;
  return {
    id: project.id,
    name: project.name ?? project.id,
    domainSlug: project.domainSlug,
    domainShort: project.domainShort ?? project.domainSlug,
    image: project.image ?? null,
    link: project.link ?? null,
    desc: project.desc ?? null,
    tags: project.tags ?? [],
    weight: project.weight ?? 0,
    growth: roundGrowth(project.growth ?? {}),
    hasEnoughHistory: project.hasEnoughHistory ?? {},
    forks: typeof latest?.forks === "number" ? latest.forks : null,
    openIssues: typeof latest?.openIssues === "number" ? latest.openIssues : null,
    signalHeadline: signalHeadline ?? null,
  };
}

/**
 * Collects buildCompareRecord results into the `{ [id]: record }` map
 * dist/compare-index.json ships, for O(1) client-side lookup by id.
 */
export function buildCompareIndex(records) {
  const index = {};
  for (const record of records) index[record.id] = record;
  return index;
}
