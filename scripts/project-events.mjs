/**
 * Pure helper for the project page's external-events timeline (MVP.md:
 * "External event timeline on the project page"). Kept dependency-free and
 * build-only — mirrors `app/shared/star-history.js`'s `sortedHistory` split
 * for the sibling `events` array on the same project entity (see
 * `data-store.mjs`), but lives under `scripts/` rather than `app/shared/`
 * since nothing client-side renders events yet.
 */

/**
 * Sorts a project entity's own `events` array oldest-first — the
 * build-time equivalent of `star-history.js`'s `sortedHistory`, for the
 * `events` array `scripts/snapshot-events.mjs` populates instead of
 * `history`. Returns `[]` for anything that isn't a real array (a project
 * with no recorded events yet).
 */
export function sortedEvents(events) {
  if (!Array.isArray(events)) return [];
  return [...events].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Picks the single most notable event within a trailing window, to explain
 * *why* a project is rising over that same period on the landing page's
 * "This week's signals" cards — not just that it is (MVP.md's homepage
 * signal cards, `this-weeks-signals.mjs`). `cutoffDateStr` is the window's
 * start date (inclusive, "YYYY-MM-DD"), the same one the candidate's own
 * growth stat was computed over — a project's months-old HN post has no
 * business explaining this week's spike. Among qualifying events, the
 * highest `points` wins; blog events, which carry no `points` field, only
 * win when nothing else in-window outranks them. Returns null when nothing
 * in `events` falls on or after `cutoffDateStr` (the common case — these
 * events are sparse, see sources.md).
 */
export function pickReasonEvent(events, cutoffDateStr) {
  const inWindow = sortedEvents(events).filter((event) => event.date >= cutoffDateStr);
  if (inWindow.length === 0) return null;
  return inWindow.reduce((best, event) => ((event.points ?? 0) > (best.points ?? 0) ? event : best));
}
