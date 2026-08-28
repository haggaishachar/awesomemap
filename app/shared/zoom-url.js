/**
 * Pure encode/decode helpers for reflecting a treemap's zoom depth and
 * Popular/Rising mode+window in a page's query string, so a zoomed-in view
 * can be shared, bookmarked, and reloaded, and so the browser back button
 * has real per-zoom-level history entries to step through. Framework- and
 * DOM-free (no `window`/`location` access) so it's usable both from
 * `treemap.js`'s browser code and from `node --test`; `treemap.js` owns
 * turning the parsed `idPath` into an actual focus node (it already has
 * the fallback logic for an id that no longer resolves, via
 * `findNodeByIdPath`) and owns all `history`/`location` calls.
 */

/**
 * Parses `searchParams` into `{ mode, window, idPath }`. Anything missing
 * or invalid (an unrecognized `mode`, a `window` outside `validWindows`)
 * falls back to the root/Popular/`validWindows[0]` default, so a stale or
 * hand-edited query string still lands somewhere sane rather than failing
 * to load. `idPath` is root-first, matching the shape `node.ancestors()`
 * already produces in `treemap.js` — `rootId` is prepended rather than
 * read from the URL, since a domain page always knows its own root from
 * context and never needs to spell it out in the query string.
 */
export function parseZoomState(searchParams, { rootId, validWindows }) {
  const mode = searchParams.get("mode") === "rising" ? "rising" : "popular";

  const requestedWindow = Number(searchParams.get("window"));
  const window = validWindows.includes(requestedWindow) ? requestedWindow : validWindows[0];

  const idPath = [rootId, ...searchParams.getAll("path")];

  return { mode, window, idPath };
}

/**
 * Inverse of `parseZoomState`: builds a query string (including its
 * leading `?`, or `""` for the bare default) reflecting `state`. Omits
 * anything already at its default so a fresh, un-zoomed Popular view keeps
 * the domain page's plain URL. `window` is only ever written while
 * `mode` is `"rising"` — a Popular-mode `window` carried over from an
 * earlier Rising visit isn't meaningful until Rising is active again, and
 * parsing back in without it already lands on `validWindows[0]`, the same
 * default a first-time switch to Rising gets.
 *
 * Each path segment gets its own repeated `path=` entry rather than a
 * single delimiter-joined value: category ids are free-form names (a
 * project's own id is `owner/repo`, and a category as ordinary as "CI/CD"
 * is entirely plausible), and `URLSearchParams` fully percent-decodes a
 * value before handing it back — a literal `/` inside one segment and a
 * `/` meant as a separator between segments would become indistinguishable
 * on the way back out. Repeated params sidestep that: each entry is
 * encoded and decoded exactly once, whatever it contains.
 */
export function formatZoomState({ mode, window, idPath }, { rootId, validWindows }) {
  const params = new URLSearchParams();

  for (const segment of idPath.slice(1)) {
    params.append("path", segment); // idPath[0] is always rootId; never written.
  }

  if (mode === "rising") {
    params.set("mode", "rising");
    if (window !== validWindows[0]) {
      params.set("window", String(window));
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}
