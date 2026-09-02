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
