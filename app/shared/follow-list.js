/**
 * Pure "follow list" persistence and diffing — the lowest-complexity
 * follow/watch implementation for issue #99: no accounts, no server, just
 * a `localStorage`-backed list of projects/categories a visitor has
 * flagged, plus a "what changed since I followed this" diff. `storage` is
 * an injectable Storage-shaped object (`getItem`/`setItem`), same pattern
 * `app/shared/compare-cart.js` already uses, so this stays testable with
 * `node --test` without a real `localStorage` global.
 */

const STORAGE_KEY = "awesomemap:follows";

/**
 * Reads the follow list. Returns `[]` for anything missing, corrupted, or
 * malformed — a broken list degrades to "following nothing" rather than
 * throwing. Each entry is `{ type: "project"|"category", id, domainSlug,
 * name, lastSeenStars, lastSeenPercentDelta, addedAt }` — `id` is a
 * project's `owner/repo`, or a category's name (unique enough within one
 * domain, which `domainSlug` scopes it to).
 */
export function getFollowed(storage = globalThis.localStorage) {
  if (!storage) return [];
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.id === "string" && (entry.type === "project" || entry.type === "category")) : [];
  } catch {
    return [];
  }
}

function writeFollowed(entries, storage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — the follow
    // just doesn't persist for this interaction; nothing to recover from.
  }
}

/** Returns `true` when `type`+`id` is already in the follow list. */
export function isFollowed(type, id, storage = globalThis.localStorage) {
  return getFollowed(storage).some((entry) => entry.type === type && entry.id === id);
}

/**
 * Adds an entry to the follow list, unless one with the same `type`+`id`
 * is already present. `snapshot` carries whatever "current state" fields
 * `computeChangeSince` will later diff against (e.g. `{ lastSeenStars }`
 * for a project, `{ lastSeenPercentDelta }` for a category) — captured at
 * follow time so there's a baseline to compare a later visit's numbers to.
 * Returns the resulting list either way.
 */
export function addFollowed({ type, id, domainSlug = null, name, ...snapshot }, storage = globalThis.localStorage) {
  const current = getFollowed(storage);
  if (current.some((entry) => entry.type === type && entry.id === id)) return current;
  const next = [...current, { type, id, domainSlug, name, addedAt: new Date().toISOString(), ...snapshot }];
  writeFollowed(next, storage);
  return next;
}

/** Removes a `type`+`id` entry if present. Returns the resulting list either way — a no-op removal is not an error. */
export function removeFollowed(type, id, storage = globalThis.localStorage) {
  const current = getFollowed(storage);
  if (!current.some((entry) => entry.type === type && entry.id === id)) return current;
  const next = current.filter((entry) => !(entry.type === type && entry.id === id));
  writeFollowed(next, storage);
  return next;
}

/** Adds if absent, removes if present — what a Follow/Following toggle button calls on click. */
export function toggleFollowed(entry, storage = globalThis.localStorage) {
  return isFollowed(entry.type, entry.id, storage) ? removeFollowed(entry.type, entry.id, storage) : addFollowed(entry, storage);
}

/**
 * Diffs one followed entry against its current known state, returning
 * `{ changed, message }`. `current` is `{ stars }` for a project (its
 * latest known star count — from the project page's own data, or the
 * domain's history.json fetch the detail panel already makes; no new data
 * source) or `{ percentDelta }` for a category (from `categoryGrowthBySlug`,
 * already rendered on the category page). `changed` is `false` when there's
 * nothing to compare yet (e.g. `lastSeenStars` was never captured) — a
 * missing baseline is not itself a change.
 */
export function computeChangeSince(followedEntry, current) {
  if (followedEntry.type === "project") {
    const { lastSeenStars } = followedEntry;
    const { stars } = current ?? {};
    if (typeof lastSeenStars !== "number" || typeof stars !== "number" || stars === lastSeenStars) {
      return { changed: false, message: null };
    }
    const delta = stars - lastSeenStars;
    const sign = delta > 0 ? "+" : "";
    return { changed: true, message: `${sign}${delta} stars since you followed` };
  }

  const { lastSeenPercentDelta } = followedEntry;
  const { percentDelta } = current ?? {};
  if (typeof lastSeenPercentDelta !== "number" || typeof percentDelta !== "number" || percentDelta === lastSeenPercentDelta) {
    return { changed: false, message: null };
  }
  const sign = percentDelta > lastSeenPercentDelta ? "+" : "";
  return { changed: true, message: `Growth moved to ${sign}${percentDelta.toFixed(1)}% since you followed` };
}

/**
 * Diffs every followed entry against a lookup of its current known state
 * (`currentById`, keyed by `type:id`, e.g. `"project:a/a"` or
 * `"category:Workflow Automation"`) and returns only the ones that
 * changed — what a "you're following N things, M changed" homepage widget
 * needs. An entry with no matching `currentById` key (its project/category
 * page hasn't been visited again yet to refresh known state) is skipped,
 * same as `computeChangeSince`'s "nothing to compare" case.
 */
export function computeChangesSince(followedEntries, currentById) {
  return followedEntries
    .map((entry) => ({ entry, ...computeChangeSince(entry, currentById?.[`${entry.type}:${entry.id}`]) }))
    .filter((result) => result.changed);
}

/**
 * DOM wiring — untested by this repo's convention (same as
 * `compare-cart.js`'s `initCompareCartUI`: DOM-mounting glue built
 * directly on the tested pure functions above). Fires a GoatCounter
 * custom event (`follow_add`/`follow_remove`) on every toggle when the
 * GoatCounter snippet is present (`window.goatcounter`, see
 * render-page.mjs's `configureAnalytics`); a no-op otherwise.
 */
function countEvent(name) {
  try {
    window.goatcounter?.count?.({ path: name, event: true });
  } catch {
    // Analytics unavailable/blocked — never let a tracking failure break
    // the follow toggle itself.
  }
}

/**
 * Re-applies "+ Follow"/"✓ Following" label and `aria-pressed` to every
 * `[data-follow-type][data-follow-id]` button currently in the DOM. Safe
 * to call repeatedly.
 */
export function refreshFollowButtons() {
  for (const button of document.querySelectorAll("[data-follow-type][data-follow-id]")) {
    const followed = isFollowed(button.dataset.followType, button.dataset.followId);
    button.textContent = followed ? "✓ Following" : "+ Follow";
    button.classList.toggle("follow-toggle-following", followed);
    button.setAttribute("aria-pressed", String(followed));
  }
}

/**
 * Wires up document-wide click delegation for every Follow button on the
 * page (delegated, same reasoning as `initCompareCartUI`). Each button
 * carries its entry's data via `data-follow-*` attributes: `type`, `id`,
 * `name`, and optionally `domain-slug`, `last-seen-stars` (a project),
 * `last-seen-percent-delta` (a category) — the baseline snapshot captured
 * at follow time. Call once per page load.
 */
export function initFollowUI() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-follow-type][data-follow-id]");
    if (!button) return;
    const entry = {
      type: button.dataset.followType,
      id: button.dataset.followId,
      name: button.dataset.followName,
      domainSlug: button.dataset.followDomainSlug ?? null,
      ...(button.dataset.followLastSeenStars ? { lastSeenStars: Number(button.dataset.followLastSeenStars) } : {}),
      ...(button.dataset.followLastSeenPercentDelta ? { lastSeenPercentDelta: Number(button.dataset.followLastSeenPercentDelta) } : {}),
    };
    const wasFollowed = isFollowed(entry.type, entry.id);
    toggleFollowed(entry);
    countEvent(wasFollowed ? "follow_remove" : "follow_add");
    refreshFollowButtons();
  });
  refreshFollowButtons();
}
