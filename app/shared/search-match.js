/**
 * Pure matching/ranking for the /search/ page. Kept dependency- and
 * DOM-free (mirrors compare-format.js's split from compare.js) so "does
 * this project match this query, and how well" is unit-testable without a
 * browser. `search.js` does the DOM wiring (fetching dist/compare-index.json
 * — the same cross-domain project index the /compare/ page already ships —
 * and calling rankProjects against it) and stays untested, per this repo's
 * convention for DOM-mounting glue.
 */

/** Lowercases for case-insensitive matching; tolerates `null`/`undefined`. */
function normalize(value) {
  return (value ?? "").toLowerCase();
}

/**
 * Scores one record against a already-normalized, non-empty `query`. Higher
 * is a better match; `0` means "not a match at all". Name/id matches rank
 * above tag matches, which rank above a description match — a query that
 * merely appears in a project's prose shouldn't outrank one that's
 * literally the project's name. An exact name/id match ranks highest of
 * all, ahead of a mere prefix, so searching "react" surfaces `react` itself
 * before `react-native` or `react-router`.
 */
function scoreRecord(record, query) {
  const name = normalize(record.name);
  const id = normalize(record.id);
  const tags = (record.tags ?? []).map(normalize);
  const desc = normalize(record.desc);

  if (name === query || id === query) return 100;
  if (name.startsWith(query)) return 90;
  if (id.startsWith(query)) return 85;
  if (tags.includes(query)) return 80;
  if (name.includes(query)) return 70;
  if (id.includes(query)) return 65;
  if (tags.some((tag) => tag.includes(query))) return 50;
  if (desc.includes(query)) return 30;
  return 0;
}

/**
 * Filters `records` (compare-index.json records, or anything with the same
 * `name`/`id`/`tags`/`desc`/`weight` shape) to those matching `query`,
 * ranked best-match-first (ties broken by star count, then name) — same
 * "reuse what compare-index.json already computed" approach `compare.js`
 * takes, just ranked instead of looked up by id. Returns `[]` for a blank
 * query (a search page's "type to search" state, not "match everything" —
 * the empty string is a substring of every record, which would otherwise
 * make an empty box appear to match the whole index).
 */
export function rankProjects(records, query) {
  const normalizedQuery = normalize(query).trim();
  if (normalizedQuery === "") return [];

  return records
    .map((record) => ({ record, score: scoreRecord(record, normalizedQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.record.weight ?? 0) - (a.record.weight ?? 0) || a.record.name.localeCompare(b.record.name))
    .map(({ record }) => record);
}
