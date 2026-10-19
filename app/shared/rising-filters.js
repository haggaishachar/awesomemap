// Client-side state for /rising/ and tiered archive week pages: which size
// tier (or Spiking), which window, which domain. Every combination is
// pre-rendered at build time (render-page.mjs's renderTieredRows); this only
// toggles `hidden`. "breakout" and "spiking" are duplicated from
// scripts/tiers.mjs rather than imported — scripts/ is build-time-only and
// never copied into dist/ (same convention as detail-panel.js).
export const DEFAULT_RISING_STATE = { tier: "breakout", window: "7", domain: "all" };
const WINDOW_LOCKED_TIERS = new Set(["spiking"]);

/** Reads `#<domain>`, `#<tier>`, or `#<domain>/<tier>` (either order); unknown parts are ignored. */
export function parseRisingHash(hash, { tierKeys, domainSlugs }) {
  const state = { ...DEFAULT_RISING_STATE };
  let raw;
  try {
    raw = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return state;
  }
  for (const part of raw.split("/")) {
    if (tierKeys.includes(part)) state.tier = part;
    else if (domainSlugs.includes(part)) state.domain = part;
  }
  return state;
}

/** The inverse of parseRisingHash, omitting defaults ("" for the default view). Window isn't encoded. */
export function buildRisingHash(state) {
  const parts = [];
  if (state.domain !== DEFAULT_RISING_STATE.domain) parts.push(state.domain);
  if (state.tier !== DEFAULT_RISING_STATE.tier) parts.push(state.tier);
  return parts.length > 0 ? `#${parts.join("/")}` : "";
}

/** Spiking only exists for the first window; size tiers keep whatever window the visitor chose. */
export function effectiveWindow(state, firstWindow = DEFAULT_RISING_STATE.window) {
  return WINDOW_LOCKED_TIERS.has(state.tier) ? firstWindow : state.window;
}

export function initRisingFilters(doc = document) {
  const tierButtons = [...doc.querySelectorAll(".rising-tier-bar [data-tier]")];
  const windowButtons = [...doc.querySelectorAll(".rising-window-bar [data-window]")];
  const domainButtons = [...doc.querySelectorAll(".rising-domain-filter [data-domain]")];
  const firstWindow = windowButtons[0]?.dataset.window ?? DEFAULT_RISING_STATE.window;

  const state = parseRisingHash(location.hash, {
    tierKeys: tierButtons.map((b) => b.dataset.tier),
    domainSlugs: domainButtons.map((b) => b.dataset.domain).filter((slug) => slug !== "all"),
  });
  state.window = firstWindow;

  function apply() {
    const windowNow = effectiveWindow(state, firstWindow);
    tierButtons.forEach((b) => {
      const active = b.dataset.tier === state.tier;
      b.classList.toggle("rising-tier-button-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    doc.querySelectorAll(".rising-tier-explainer").forEach((p) => {
      p.hidden = p.dataset.tier !== state.tier;
    });
    windowButtons.forEach((b) => {
      b.disabled = WINDOW_LOCKED_TIERS.has(state.tier) && b.dataset.window !== firstWindow;
      b.classList.toggle("treemap-window-button-active", b.dataset.window === windowNow);
    });
    doc.querySelectorAll(".rising-rows").forEach((el) => {
      el.hidden = el.dataset.tier !== state.tier || el.dataset.window !== windowNow;
    });
    if (domainButtons.length > 0) {
      domainButtons.forEach((b) => b.classList.toggle("rising-domain-button-active", b.dataset.domain === state.domain));
      const targetSectionId = state.domain === "all" ? "global" : state.domain;
      doc.querySelectorAll(".rising-section").forEach((section) => {
        section.hidden = section.id !== targetSectionId;
      });
    }
  }

  function commit() {
    apply();
    const hash = buildRisingHash(state);
    history.replaceState(null, "", hash || location.pathname + location.search);
  }

  tierButtons.forEach((b) => b.addEventListener("click", () => { state.tier = b.dataset.tier; commit(); }));
  windowButtons.forEach((b) => b.addEventListener("click", () => { if (!b.disabled) { state.window = b.dataset.window; commit(); } }));
  domainButtons.forEach((b) => b.addEventListener("click", () => { state.domain = b.dataset.domain; commit(); }));
  apply();
}
