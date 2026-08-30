/**
 * Pure encode/decode helpers for reflecting the compare page's selected
 * project ids in its query string, so a comparison can be shared,
 * bookmarked, and reloaded. Framework- and DOM-free (no `window`/`location`
 * access), mirroring zoom-url.js's split from treemap.js — usable both
 * from compare.js's browser code and from `node --test`.
 *
 * Ids use repeated `id=` params rather than a single delimiter-joined
 * value, for the same reason zoom-url.js's `path=` params are repeated: a
 * project id is `owner/repo`, and joining ids with a delimiter that could
 * also appear inside one is exactly the ambiguity repeated params avoid.
 */

export const MAX_COMPARE_IDS = 4;

/**
 * Parses `searchParams` into an ordered, deduped list of project ids,
 * capped at `MAX_COMPARE_IDS` — extras beyond the cap are dropped rather
 * than treated as an error, so an old or hand-edited link degrades
 * gracefully instead of failing to load.
 */
export function parseCompareIds(searchParams) {
  const seen = new Set();
  const ids = [];
  for (const id of searchParams.getAll("id")) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === MAX_COMPARE_IDS) break;
  }
  return ids;
}

/** Inverse of parseCompareIds: builds a query string (including its leading `?`, or `""` for an empty list) from `ids`. */
export function formatCompareIds(ids) {
  const params = new URLSearchParams();
  for (const id of ids) params.append("id", id);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Normalizes user-typed input from the compare page's "add project" box
 * into a bare `owner/repo` id: trims whitespace, strips trailing
 * slash(es), and strips a `https://github.com/` prefix when present (a
 * pasted repo URL is a very likely input). Doesn't validate the result
 * exists — callers check that against the fetched compare index.
 */
export function normalizeProjectId(input) {
  const trimmed = input.trim().replace(/\/+$/, "");
  const githubPrefix = "https://github.com/";
  return trimmed.startsWith(githubPrefix) ? trimmed.slice(githubPrefix.length) : trimmed;
}
