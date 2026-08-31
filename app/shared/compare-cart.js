import { MAX_COMPARE_IDS, formatCompareIds } from "./compare-url.js";

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

/**
 * DOM wiring — untested by this repo's convention (same as detail-panel.js
 * and treemap.js: DOM-mounting glue built directly on the tested pure
 * functions above, not itself unit-tested). Every page that can show a
 * + Compare button imports `initCompareCartUI` and calls it once, from an
 * inline bootstrap script mirroring the one render-page.mjs already emits
 * for the treemap/compare page — see renderCompareCartBootstrap.
 */

// Set by initCompareCartUI; refreshCompareButtons needs it to build the
// header link's href without every caller having to pass basePath through.
let currentBasePath = "";

/**
 * Re-applies visual state (label, `compare-toggle-added` class,
 * `aria-pressed`) to every `[data-compare-id]` button currently in the
 * DOM, and updates the header's Compare (n) link/href to match the cart.
 * Safe to call repeatedly — the detail panel calls this again each time
 * it rebuilds its content for a newly clicked leaf, since that leaf's
 * button didn't exist yet the last time this ran.
 */
export function refreshCompareButtons() {
  const cart = readCart();
  for (const button of document.querySelectorAll("[data-compare-id]")) {
    const added = cart.includes(button.dataset.compareId);
    button.textContent = added ? "✓ Added" : "+ Compare";
    button.classList.toggle("compare-toggle-added", added);
    button.setAttribute("aria-pressed", String(added));
  }
  const headerLink = document.getElementById("site-header-compare");
  if (headerLink) {
    headerLink.textContent = cart.length > 0 ? `Compare (${cart.length})` : "Compare";
    headerLink.href = `${currentBasePath}/compare/${formatCompareIds(cart)}`;
  }
}

/**
 * Wires up document-wide click delegation for every + Compare / ✓ Added
 * button on the page — delegated rather than bound per-button, so it
 * keeps working for buttons the detail panel creates after this runs
 * (e.g. opening a second leaf) without needing to be re-attached. Call
 * once per page load.
 */
export function initCompareCartUI(basePath = "") {
  currentBasePath = basePath;
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-compare-id]");
    if (!button) return;
    toggleCart(button.dataset.compareId);
    refreshCompareButtons();
  });
  refreshCompareButtons();
}
