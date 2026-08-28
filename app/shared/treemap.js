import {
  buildHierarchy,
  computeLevelBoxes,
  computeStageSize,
  leafAriaLabel,
  categoryAriaLabel,
  othersAriaLabel,
} from "./layout.js";

// Debounce for the ResizeObserver in mountTreemap — avoids re-laying-out
// the whole stage on every intermediate frame of a window drag-resize.
const RESIZE_DEBOUNCE_MS = 150;
// Left below the stage on mobile (where its height fills the viewport),
// mirroring layout.js's STAGE_SIDE_MARGIN_PX so the stage doesn't run
// flush to the bottom edge of the screen.
const STAGE_BOTTOM_MARGIN_PX = 16;
// Deliberately duplicated from scripts/velocity.mjs's RISING_WINDOWS_DAYS
// rather than imported: scripts/ is a build-time-only Node directory that
// generate.mjs never copies into dist/, so this browser module can't
// import from it. Keep both lists in sync if a window is ever added.
const RISING_WINDOWS_DAYS = [7, 30, 90];

// A box needs roughly this much area to stay legible (label + logo)
// before it's worth its own slot instead of folding into "Others".
const MIN_BOX_AREA_PX = 12000;
// Same idea as MIN_BOX_AREA_PX, but for the small peek tiles shown inside
// a box that itself has children — much smaller, since a peek tile is
// just a logo with no label of its own.
const MIN_PEEK_AREA_PX = 2500;
// Below this, a box can't fit even one peek tile plus its own padding —
// skip the peek entirely rather than render an empty or cramped grid.
const PEEK_MIN_BOX_WIDTH = 60;
const PEEK_MIN_BOX_HEIGHT = 40;
// Packed tiles are weight-proportional, not a fixed grid, so a long tail
// of low-weight projects can land under any fixed size — skip rendering
// a real tile once it's too thin for its logo to read at all, rather
// than show an illegible sliver. The project stays reachable by zooming
// into the box; this only affects the decorative preview.
const PEEK_MIN_TILE_PX = 24;
// Matches .treemap-category's CSS padding (4px 6px) and one line of the
// 12px label, so the packed peek treemap lands inside the box's actual
// content area instead of under its own padding/label. Assumes the label
// wraps to at most one line — a category name long enough to wrap in a
// narrow box would need a taller reserve than this fixed constant.
const PEEK_HORIZONTAL_INSET_PX = 12;
const PEEK_VERTICAL_INSET_PX = 8;
const PEEK_LABEL_RESERVED_PX = 18;
// How many of a category's own biggest leaf descendants stand in for it
// in a peek tile (see `renderIconCollage`) — enough to read as "a group
// of things" at a glance without needing a grid bigger than 2x2.
const COLLAGE_MAX_ICONS = 4;

/**
 * Mounts a treemap for `mapData` into `container`. A project's `image`,
 * when present, is already a direct URL into its source repo.
 * `onLeafClick(leafData)`, if given, is called when a leaf box (or a leaf
 * shown in a peek preview) is clicked — categories and Others boxes zoom
 * instead of firing this callback. `leafData` is the leaf's data plus an
 * `activeSizeKey` field naming the size mode active when it was clicked
 * ("popular", "rising7", "rising30", or "rising90"), so the detail panel
 * can show the right stat. `onModeChange()`, if given, is called with no
 * arguments right after the Popular/Rising mode or window is switched —
 * consumers use it to dismiss any already-open detail panel, since its
 * baked-in growth stats would otherwise go stale against the new mode.
 *
 * `initialState` (`{ mode, window, idPath }`, e.g. from `zoom-url.js`'s
 * `parseZoomState`), if given, seeds the mode/window/zoom depth the
 * treemap mounts into — before the first render, so there's no flash of
 * the root view. `onNavigate(state, { replace })`, if given, is called
 * with the same shape right after a real (non-Others) zoom or a mode/window
 * switch, so a caller can mirror it into the URL; `replace` is `true` for
 * a mode/window switch (in place — not a step a back button should undo)
 * and `false` for a zoom (its own history entry). Zooming into a synthetic
 * "Others" box deliberately does *not* fire `onNavigate` — see
 * `zoomToOthers`. The returned handle's `applyState(state)` is the
 * inverse of `onNavigate`: it restores the treemap to match a state
 * (e.g. from a `popstate` event) without re-firing `onNavigate` itself,
 * so callers can round-trip state through the URL without looping.
 */
export function mountTreemap(container, mapData, onLeafClick, onModeChange, { initialState, onNavigate } = {}) {
  let sizeMode = initialState?.mode ?? "popular"; // "popular" | "rising"
  // The shortest window, matching the one every server-rendered surface leads
  // with (generate.mjs's MOMENTUM_WINDOW_DAYS / TEASER_WINDOW_DAYS, both
  // RISING_WINDOWS_DAYS[0]), so a visitor who arrives from a landing card or a
  // leaderboard sees the map describing the same period those figures did.
  // It's also the only window that degrades gracefully as history accrues: a
  // longer default renders every box as insufficient-history until the
  // snapshot archive is deep enough to fill it.
  let risingWindow = initialState?.window ?? RISING_WINDOWS_DAYS[0];
  let root = buildHierarchy(mapData, activeSizeKey());
  // `findNodeByIdPath` walks as far into `initialState.idPath` as the
  // hierarchy actually resolves, falling back the same way a mode switch
  // does for a stale/foreign id — see its own doc comment.
  let focusNode = initialState?.idPath ? findNodeByIdPath(root, initialState.idPath) : root;
  let focusIdPath = focusNode.ancestors().reverse().map((ancestor) => ancestor.data.id);

  let stageWidth;
  let stageHeight;

  container.innerHTML = "";
  const modeBar = document.createElement("div");
  modeBar.className = "treemap-mode-bar";
  const breadcrumb = document.createElement("div");
  breadcrumb.className = "treemap-breadcrumb";
  const stage = document.createElement("div");
  stage.className = "treemap-stage";
  container.appendChild(modeBar);
  container.appendChild(breadcrumb);
  container.appendChild(stage);

  /**
   * Applies a freshly computed `{width, height}` to the stage element and
   * to the closure-scoped `stageWidth`/`stageHeight` that `renderLevel`
   * lays boxes out against. Doesn't itself re-render — callers that need
   * the new size reflected in the actual boxes call `renderLevel()` (or
   * the full initial render sequence) afterwards.
   */
  function applyStageSize(size) {
    stageWidth = size.width;
    stageHeight = size.height;
    stage.style.width = `${stageWidth}px`;
    stage.style.height = `${stageHeight}px`;
  }

  /**
   * The viewport height left for the stage: from the stage's own top
   * (i.e. below whatever precedes it on the page — the mode bar,
   * breadcrumb, and any page chrome like the site header) down
   * to the bottom of the window, minus a small margin. `getBoundingClientRect`
   * is viewport-relative, so this reflects the stage's actual on-page
   * position, not just its container's contents — safe to call before the
   * stage has ever been sized, since it depends only on what comes before
   * it in the page, never on its own current width/height. Re-measured on
   * every resize/orientation change and whenever the mode bar's own height
   * changes (e.g. the Rising window-row appearing) — both go through
   * `resizeStage` below.
   */
  function computeAvailableHeight() {
    return window.innerHeight - stage.getBoundingClientRect().top - STAGE_BOTTOM_MARGIN_PX;
  }

  function activeSizeKey() {
    return sizeMode === "popular" ? "popular" : `rising${risingWindow}`;
  }

  /** The `{ mode, window, idPath }` shape `onNavigate`/`applyState` share with `zoom-url.js`. */
  function currentState() {
    return { mode: sizeMode, window: risingWindow, idPath: focusIdPath };
  }

  function setSizeMode(nextMode, nextWindow) {
    sizeMode = nextMode;
    risingWindow = nextWindow;
    root = buildHierarchy(mapData, activeSizeKey());
    focusNode = findNodeByIdPath(root, focusIdPath);
    // Re-derived from the (possibly bailed-out-to-a-real-ancestor) focusNode
    // rather than left as-is: if Others didn't survive the switch, the old
    // focusIdPath would otherwise still describe the no-longer-current
    // synthetic node.
    focusIdPath = focusNode.ancestors().reverse().map((ancestor) => ancestor.data.id);
    renderModeBar();
    renderBreadcrumb();
    renderLevel();
    onModeChange?.();
    onNavigate?.(currentState(), { replace: true });
  }

  /**
   * Restores the treemap to `state` (`{ mode, window, idPath }`) without
   * firing `onNavigate` — the inverse direction from `setSizeMode`/`zoomTo`,
   * for a caller re-driving the treemap *from* an already-decided target
   * (e.g. a `popstate` event) rather than reporting a change it made itself.
   * Also fires `onModeChange` unconditionally: any already-open detail
   * panel may no longer even correspond to a visible leaf once focus has
   * jumped elsewhere, so it's dismissed the same as an in-treemap mode
   * switch would.
   */
  function applyState(state) {
    sizeMode = state.mode;
    risingWindow = state.window;
    root = buildHierarchy(mapData, activeSizeKey());
    focusNode = findNodeByIdPath(root, state.idPath);
    focusIdPath = focusNode.ancestors().reverse().map((ancestor) => ancestor.data.id);
    renderModeBar();
    renderBreadcrumb();
    renderLevel();
    onModeChange?.();
  }

  /**
   * Walks `idPath` (root-first, as produced by `zoomTo`/`node.ancestors()`)
   * down through `node`'s real children, used by `setSizeMode` to re-locate
   * the focus node in the freshly rebuilt hierarchy after a mode/window
   * switch. If `idPath` ends inside a synthetic "Others" box (an id like
   * `"<parentId>__others"` from `buildOthersNode`, reachable via
   * `zoomToOthers`), that id can't be found here: Others isn't part of
   * `mapData` and its membership is derived per-render from the *active*
   * sizeKey's weights (see `computeLevelBoxes`), so there's no stable
   * "same Others bucket" to look up across a mode switch — the top-N split
   * for Rising can legitimately differ from Popular. In that case the loop
   * below just stops one level up, at the real category Others was hiding
   * children of, and that becomes the new focus. This is intentional
   * fallback behavior, not a bug: landing on the real parent lets it
   * recompute its own top-N/Others split fresh for the new mode, which is
   * the only correct thing to show since the old Others box's contents may
   * no longer even be the right set of hidden children under the new mode.
   */
  function findNodeByIdPath(node, idPath) {
    let current = node;
    for (const id of idPath.slice(1)) {
      const next = current.children?.find((child) => child.data.id === id);
      // `next` is undefined here whenever `id` is a synthetic Others id (or,
      // in principle, any id no longer present after a data change) — see
      // the doc comment above for why stopping at `current` is correct.
      if (!next) break;
      current = next;
    }
    return current;
  }

  /** Sets focus to `node` and re-renders, without touching navigation state. */
  function focusOn(node) {
    focusNode = node;
    focusIdPath = node.ancestors().reverse().map((ancestor) => ancestor.data.id);
    renderBreadcrumb();
    renderLevel();
  }

  function zoomTo(node) {
    focusOn(node);
    onNavigate?.(currentState(), { replace: false });
  }

  /**
   * Zooms into a synthetic "Others" box: rebuilds it as a real d3
   * hierarchy (so its own children get `.value`s under the active
   * sizeKey, same as any other node), then patches `.parent` to
   * `parentNode` — the real box Others was hiding children of — so
   * `ancestors()` (breadcrumb, `focusIdPath`) walks back through the real
   * tree exactly like zooming into an ordinary category would.
   *
   * Deliberately calls `focusOn` rather than `zoomTo`: an Others bucket's
   * membership isn't stable across a mode/window switch (see
   * `findNodeByIdPath`), so it's not a meaningful thing to bookmark or
   * share — this view updates on-page like any other zoom, it just never
   * reaches `onNavigate`/the URL.
   *
   * Note: switching Popular/Rising mode (or window) while focus is on this
   * synthetic node will not restore it — see `findNodeByIdPath` for why
   * that's the intended fallback, not a bug.
   */
  function zoomToOthers(othersData, parentNode) {
    const syntheticNode = buildHierarchy(othersData, activeSizeKey());
    syntheticNode.parent = parentNode;
    focusOn(syntheticNode);
  }

  function renderModeBar() {
    modeBar.innerHTML = "";

    modeBar.appendChild(
      renderModeButton("Popular", sizeMode === "popular", () => setSizeMode("popular", risingWindow))
    );
    modeBar.appendChild(
      renderModeButton("Rising", sizeMode === "rising", () => setSizeMode("rising", risingWindow))
    );

    if (sizeMode === "rising") {
      const windowGroup = document.createElement("span");
      windowGroup.className = "treemap-window-group";
      for (const windowDays of RISING_WINDOWS_DAYS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className =
          "treemap-window-button" + (windowDays === risingWindow ? " treemap-window-button-active" : "");
        button.textContent = `${windowDays}d`;
        button.addEventListener("click", () => setSizeMode("rising", windowDays));
        windowGroup.appendChild(button);
      }
      modeBar.appendChild(windowGroup);
    }
  }

  function renderModeButton(label, isActive, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "treemap-mode-button" + (isActive ? " treemap-mode-button-active" : "");
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderBreadcrumb() {
    breadcrumb.innerHTML = "";
    const trail = focusNode.ancestors().reverse(); // root ... focusNode
    trail.forEach((node, index) => {
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.className = "treemap-crumb";
      crumb.textContent = node.data.name;
      crumb.disabled = index === trail.length - 1;
      crumb.addEventListener("click", () => zoomTo(node));
      breadcrumb.appendChild(crumb);
      if (index < trail.length - 1) {
        const sep = document.createElement("span");
        sep.className = "treemap-crumb-sep";
        sep.textContent = " › ";
        breadcrumb.appendChild(sep);
      }
    });
  }

  function renderLevel() {
    stage.innerHTML = "";
    const boxes = computeLevelBoxes(focusNode.children, {
      focusId: focusNode.data.id,
      sizeKey: activeSizeKey(),
      stageWidth,
      stageHeight,
      minBoxAreaPx: MIN_BOX_AREA_PX,
    });
    for (const box of boxes) {
      if (box.kind === "real") {
        stage.appendChild(renderBox(box.node, box.rect));
      } else {
        stage.appendChild(renderOthersBox(box, focusNode));
      }
    }
  }

  function renderBox(node, rect) {
    const key = activeSizeKey();
    const insufficientHistory =
      sizeMode === "rising" && node.data.hasEnoughHistory && node.data.hasEnoughHistory[key] === false;

    const box = document.createElement("div");
    box.className = node.children
      ? "treemap-box treemap-category"
      : "treemap-box treemap-leaf" + (insufficientHistory ? " treemap-box-insufficient-history" : "");
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const label = document.createElement("span");
    label.className = "treemap-label";
    label.textContent = node.data.name;
    box.appendChild(label);

    if (!node.children && node.data.image) {
      const img = document.createElement("img");
      img.className = "treemap-logo";
      img.src = node.data.image;
      img.alt = node.data.name;
      img.onerror = () => img.replaceWith(renderFallbackLogo(node.data.name));
      box.insertBefore(img, label);
    }

    if (node.children) {
      renderPeek(box, node.children, rect, node.data.id);
      makeBoxInteractive(box, categoryAriaLabel(node.data.name, node.leaves().length), () => zoomTo(node));
    } else if (onLeafClick) {
      makeBoxInteractive(box, leafAriaLabel(node.data, key), () =>
        onLeafClick({ ...node.data, activeSizeKey: key })
      );
    }

    return box;
  }

  /**
   * Renders a synthetic "N more" box: same look-and-feel entry point as
   * `renderBox`, but there's no real node to click into — clicking builds
   * one on the fly via `zoomToOthers`.
   */
  function renderOthersBox(othersBox, parentNode) {
    const { data, hiddenChildren, rect } = othersBox;

    const box = document.createElement("div");
    box.className = "treemap-box treemap-others";
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const label = document.createElement("span");
    label.className = "treemap-label";
    label.textContent = data.name;
    box.appendChild(label);

    renderPeek(box, hiddenChildren, rect, data.id);
    makeBoxInteractive(box, othersAriaLabel(hiddenChildren.length), () => zoomToOthers(data, parentNode));

    return box;
  }

  /**
   * Adds a small preview of `children`'s (real d3 nodes, each with
   * `.value` and `.data`) top items inside `box`, packed edge-to-edge via
   * the same `computeLevelBoxes` mini-treemap used for full-size boxes —
   * this is what makes a category or Others box show project logos
   * before you zoom into it, and it's why a tall narrow box packs its
   * tiles in a different arrangement than a short wide one: squarify
   * picks row/column splits from the box's own aspect ratio, the same
   * way it already does for the top-level category layout. `rect` is
   * `box`'s own already-set `{left, top, width, height}`; the insets
   * subtracted below match `.treemap-category`'s CSS padding and one
   * line of the label, so the packed tiles land inside the box's actual
   * content area instead of under its own padding/label. Skips entirely
   * if there's not enough room for even one tile.
   */
  function renderPeek(box, children, rect, focusId) {
    if (!children || children.length === 0) return;

    const width = rect.width - PEEK_HORIZONTAL_INSET_PX;
    const height = rect.height - PEEK_VERTICAL_INSET_PX - PEEK_LABEL_RESERVED_PX;
    if (width < PEEK_MIN_BOX_WIDTH || height < PEEK_MIN_BOX_HEIGHT) return;

    const peekBoxes = computeLevelBoxes(children, {
      focusId,
      sizeKey: activeSizeKey(),
      stageWidth: width,
      stageHeight: height,
      minBoxAreaPx: MIN_PEEK_AREA_PX,
    });
    if (peekBoxes.length === 0) return;

    const grid = document.createElement("div");
    grid.className = "treemap-peek-grid";
    grid.style.width = `${width}px`;
    grid.style.height = `${height}px`;

    for (const peekBox of peekBoxes) {
      if (peekBox.kind === "real" && Math.min(peekBox.rect.width, peekBox.rect.height) < PEEK_MIN_TILE_PX) {
        continue;
      }
      grid.appendChild(
        peekBox.kind === "real"
          ? renderPeekTile(peekBox.node, peekBox.rect)
          : renderPeekOthersTile(peekBox.data, peekBox.rect)
      );
    }

    box.appendChild(grid);
  }

  /**
   * One packed peek tile for a real project, a (nested) category, or a
   * project with no `image` of its own — a category gets `renderIconCollage`
   * rather than the plain fallback letter, since it stands for a whole
   * group of projects, not one. Clicking opens the detail panel directly
   * for a project, or zooms in directly for a category — either way
   * `stopPropagation`'d so it doesn't also trigger the containing box's
   * own zoom-in click handler.
   */
  function renderPeekTile(child, rect) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "treemap-peek-tile";
    tile.style.left = `${rect.left}px`;
    tile.style.top = `${rect.top}px`;
    tile.style.width = `${rect.width}px`;
    tile.style.height = `${rect.height}px`;
    tile.title = child.data.name;

    if (!child.children && child.data.image) {
      const img = document.createElement("img");
      img.src = child.data.image;
      img.alt = child.data.name;
      img.onerror = () => img.replaceWith(renderFallbackLogo(child.data.name));
      tile.appendChild(img);
    } else if (child.children) {
      tile.appendChild(renderIconCollage(child));
    } else {
      tile.appendChild(renderFallbackLogo(child.data.name));
    }

    tile.addEventListener("click", (event) => {
      event.stopPropagation();
      if (child.children) {
        zoomTo(child);
      } else if (onLeafClick) {
        onLeafClick({ ...child.data, activeSizeKey: activeSizeKey() });
      }
    });

    return tile;
  }

  /**
   * The peek's own truncation tile ("N more"), when even the small preview
   * can't fit every child. Deliberately non-interactive — the containing
   * box is already a click target that zooms in and reveals everything
   * (via the real top-level Others mechanism), so this tile doesn't need
   * its own click handling; a click on it simply bubbles up to that.
   */
  function renderPeekOthersTile(data, rect) {
    const tile = document.createElement("span");
    tile.className = "treemap-peek-tile treemap-peek-tile-others";
    tile.style.left = `${rect.left}px`;
    tile.style.top = `${rect.top}px`;
    tile.style.width = `${rect.width}px`;
    tile.style.height = `${rect.height}px`;
    tile.textContent = data.name;
    return tile;
  }

  renderModeBar();
  renderBreadcrumb();
  // Only now (after the mode bar and breadcrumb have real content) is the
  // stage's top offset — and so the height available below it — known.
  applyStageSize(computeStageSize(container.clientWidth, computeAvailableHeight()));
  renderLevel();

  /**
   * Recomputes the stage size from the container's current width and the
   * viewport height currently available below the stage, and — only if
   * it actually changed — applies it and re-lays-out the current focus
   * level. Zoom state (`focusNode`/`focusIdPath`) is untouched, so the
   * user stays at whatever level they'd zoomed to across a resize. Also
   * fires when the mode bar's own height changes (e.g. toggling into
   * Rising mode adds a window-button row): that changes `container`'s
   * total height, which the ResizeObserver below is watching.
   */
  function resizeStage() {
    const nextSize = computeStageSize(container.clientWidth, computeAvailableHeight());
    if (nextSize.width === stageWidth && nextSize.height === stageHeight) return;
    applyStageSize(nextSize);
    renderLevel();
  }

  // The synchronous `container.clientWidth` read above can race ahead of
  // the browser's own layout pass on a slow/cold first load (observed in
  // practice: `container.clientWidth` reading 0 despite the container
  // genuinely having width moments later), which locks the stage in at a
  // bogus size — usually 0, hiding every box and logo — until the next
  // *real* container resize fires the ResizeObserver below. A page that's
  // never manually resized (the common case) then never recovers. Guard
  // against that with two follow-up rechecks that don't depend on an
  // actual resize happening: one after this frame's layout has settled
  // (`requestAnimationFrame`), and one once the page — including its
  // stylesheet — has definitely finished loading (`load`), for the case
  // where even a frame later wasn't enough. Both are no-ops (via
  // `resizeStage`'s own bail-out) once the size already reads correctly.
  requestAnimationFrame(resizeStage);
  if (document.readyState === "complete") {
    resizeStage();
  } else {
    window.addEventListener("load", resizeStage, { once: true });
  }

  let resizeTimeoutId = null;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeTimeoutId !== null) clearTimeout(resizeTimeoutId);
    resizeTimeoutId = setTimeout(() => {
      resizeTimeoutId = null;
      resizeStage();
    }, RESIZE_DEBOUNCE_MS);
  });
  resizeObserver.observe(container);

  return { zoomTo, root, applyState };
}

/**
 * Wires `element` up as a keyboard-activatable equivalent of its click
 * handler: `role="button"`, tab-reachable, and Enter/Space trigger the
 * same `onActivate` a click does (Space's default page-scroll is
 * prevented, matching native `<button>` behavior) — plus `aria-label`.
 * Needed because the treemap's boxes are plain, absolutely-positioned
 * `<div>`s (unlike the already-native `<button>` peek tiles nested inside
 * them), so none of this is free without it.
 */
function makeBoxInteractive(element, label, onActivate) {
  element.setAttribute("role", "button");
  element.tabIndex = 0;
  element.setAttribute("aria-label", label);
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    onActivate();
  });
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  });
}

function renderFallbackLogo(name) {
  const fallback = document.createElement("span");
  fallback.className = "treemap-logo-fallback";
  fallback.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return fallback;
}

/**
 * Represents a category peek tile by a small collage of its own biggest
 * leaf descendants' logos, instead of one fallback letter standing in for
 * a whole group. `node.leaves()` is a d3-hierarchy built-in that walks
 * *every* level below `node` regardless of how deep it goes — so this
 * reads identically whether `node`'s children are projects directly (one
 * level of nesting) or another layer of categories (two, or more, as
 * today's Agents & Coding / LLM Infrastructure domains have): there's no
 * per-depth logic to keep in sync as more nesting is added. Leaves are
 * ranked by `.value` (already the active sizeKey's weight, via
 * `buildHierarchy`'s `.sum()`), so the icons shown are the category's
 * biggest projects, matching what "top n" means everywhere else in this
 * file (`selectTopWithOthers`). Falls back to the plain letter tile if
 * none of the category's leaves have an image at all.
 */
function renderIconCollage(node) {
  const topLeaves = node
    .leaves()
    .filter((leaf) => leaf.data.image)
    .sort((a, b) => b.value - a.value)
    .slice(0, COLLAGE_MAX_ICONS);

  if (topLeaves.length === 0) return renderFallbackLogo(node.data.name);

  const collage = document.createElement("div");
  collage.className = "treemap-collage";
  for (const leaf of topLeaves) {
    const img = document.createElement("img");
    img.src = leaf.data.image;
    img.alt = "";
    // A collage icon that fails just drops out rather than falling back
    // to a letter of its own — with up to COLLAGE_MAX_ICONS-1 other
    // icons (or, in the rare worst case, none) already conveying "this
    // is a group", a lone broken-image glyph here would only confuse.
    img.onerror = () => img.remove();
    collage.appendChild(img);
  }
  return collage;
}
