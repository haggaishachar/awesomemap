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

// Org-name suffixes stripped before matching an owner against text —
// "heygen-com" is written "HeyGen", "Graphify-Labs" often just "Graphify Labs".
const OWNER_SUFFIX_PATTERN = /(ai|labs?|hq|inc|org|dev|io|com|team|official)$/;
/** Shortest normalized owner name trusted as an identity signal on its own — anything shorter matches too much unrelated text. */
const MIN_OWNER_MATCH_LENGTH = 4;

/** Lowercases and drops everything but letters and digits, so "All Hands AI", "All-Hands-AI" and "allhandsai" compare equal. */
function normalizeForMatch(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True when `text` names this specific project, not merely a word equal to
 * its repo name: either its `owner/repo` id (which any github.com link to
 * it contains) or its owner, tried with and without a trailing org suffix.
 * An owner form isn't trusted when it's too short or is just the repo name
 * again (e.g. `ollama/ollama`). A copy of awesomemap-data's
 * `blog-events.mjs` rule of the same name, which now gates new blog events
 * on it — kept in sync by hand, like readme-risers.mjs's own copy of `withEventReason`.
 */
export function mentionsProject(entity, text) {
  const haystack = String(text ?? "").toLowerCase();
  if (haystack.includes(entity.id.toLowerCase())) return true;

  const [owner, repo] = entity.id.split("/");
  const fullOwner = normalizeForMatch(owner);
  const repoNames = [normalizeForMatch(repo), normalizeForMatch(entity.name ?? "")];
  const ownerForms = [fullOwner.replace(OWNER_SUFFIX_PATTERN, ""), fullOwner].filter(
    (form) => form.length >= MIN_OWNER_MATCH_LENGTH && !repoNames.some((name) => name.includes(form)),
  );
  const normalizedHaystack = normalizeForMatch(haystack);
  return ownerForms.some((form) => normalizedHaystack.includes(form));
}

/**
 * Drops an entity's `blog` events whose stored title and url don't name
 * the project (`mentionsProject`), plus any pointing back at awesomemap.dev
 * itself. Blog detection used to keep any page matching a project's bare
 * name, so the stored events include hair-product "ponytail" launches,
 * SAP ECC posts and the like; awesomemap-data no longer records new ones,
 * and this keeps the already-stored ones off the site and README. Only
 * `blog` events are checked — HN/Reddit/Product Hunt events come from
 * exact url lookups, not name search. Returns the entity unchanged when
 * nothing is dropped.
 */
export function withTrustedEvents(entity) {
  if (!Array.isArray(entity?.events)) return entity;
  const events = entity.events.filter(
    (event) => event.type !== "blog" || (!/^https?:\/\/(www\.)?awesomemap\.dev\//.test(event.url) && mentionsProject(entity, `${event.title ?? ""} ${event.url}`)),
  );
  return events.length === entity.events.length ? entity : { ...entity, events };
}
