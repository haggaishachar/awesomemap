import { MAX_COMPARE_IDS } from "./compare-url.js";

/**
 * Persistent "compare cart" — a running list of project ids a visitor
 * builds up by clicking + Compare buttons while browsing (detail panel,
 * project pages, Rising/Tags rows), independent of any single page's URL.
 * Backed by `localStorage` so it survives navigating between pages;
 * `storage` is an injectable Storage-shaped object (`getItem`/`setItem`)
 * so this stays testable with `node --test` without a real
 * `localStorage` global. Capped at `MAX_COMPARE_IDS`, the same limit the
 * /compare/ page itself enforces (app/shared/compare-url.js) — the cart
 * is just a different way of arriving at the same URL-driven page.
 */

const STORAGE_KEY = "awesomemap:compare";

/** Reads the cart as an ordered list of ids. Returns `[]` for anything missing, corrupted, or malformed — a broken cart degrades to empty rather than throwing. */
export function readCart(storage = globalThis.localStorage) {
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
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeCart(ids, storage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — the cart just
    // doesn't persist for this interaction; nothing to recover from here.
  }
}

/** Adds `id` to the cart, unless it's already present or the cart is already at `MAX_COMPARE_IDS`. Returns the resulting list either way. */
export function addToCart(id, storage = globalThis.localStorage) {
  const current = readCart(storage);
  if (current.includes(id) || current.length >= MAX_COMPARE_IDS) return current;
  const next = [...current, id];
  writeCart(next, storage);
  return next;
}

/** Removes `id` from the cart if present. Returns the resulting list either way — a no-op removal (id never present) is not an error. */
export function removeFromCart(id, storage = globalThis.localStorage) {
  const current = readCart(storage);
  if (!current.includes(id)) return current;
  const next = current.filter((existing) => existing !== id);
  writeCart(next, storage);
  return next;
}

/** Adds `id` if absent, removes it if present — what a + Compare / ✓ Added toggle button calls on click. */
export function toggleCart(id, storage = globalThis.localStorage) {
  return readCart(storage).includes(id) ? removeFromCart(id, storage) : addToCart(id, storage);
}
