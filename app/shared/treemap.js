import { buildHierarchy, computeLevelBoxes, selectTopWithOthers, sizeForWeight } from "./layout.js";

const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 600;
// Deliberately duplicated from scripts/velocity.mjs's RISING_WINDOWS_DAYS
// rather than imported: scripts/ is a build-time-only Node directory that
// generate.mjs never copies into dist/, so this browser module can't
// import from it. Keep both lists in sync if a window is ever added.
const RISING_WINDOWS_DAYS = [7, 30, 90];

// A box needs roughly this much area to stay legible (label + logo)
// before it's worth its own slot instead of folding into "Others".
const MIN_BOX_AREA_PX = 12000;
// Same idea as MIN_BOX_AREA_PX, but for the small peek icons shown inside
// a box that itself has children — much smaller, since a peek icon is
// just a logo with no label of its own.
const MIN_PEEK_AREA_PX = 2500;
const PEEK_MIN_ICON_PX = 20;
const PEEK_MAX_ICON_PX = 64;
// Below this, a box can't fit even one peek icon plus its own padding —
// skip the peek entirely rather than render an empty or cramped grid.
const PEEK_MIN_BOX_WIDTH = 60;
const PEEK_MIN_BOX_HEIGHT = 40;

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
 */
export function mountTreemap(container, mapData, onLeafClick, onModeChange) {
  let sizeMode = "popular"; // "popular" | "rising"
  let risingWindow = 30;
  let root = buildHierarchy(mapData, activeSizeKey());
  let focusNode = root;
  let focusIdPath = [root.data.id];

  container.innerHTML = "";
  const modeBar = document.createElement("div");
  modeBar.className = "treemap-mode-bar";
  const breadcrumb = document.createElement("div");
  breadcrumb.className = "treemap-breadcrumb";
  const stage = document.createElement("div");
  stage.className = "treemap-stage";
  stage.style.width = `${STAGE_WIDTH}px`;
  stage.style.height = `${STAGE_HEIGHT}px`;
  container.appendChild(modeBar);
  container.appendChild(breadcrumb);
  container.appendChild(stage);

  function activeSizeKey() {
    return sizeMode === "popular" ? "popular" : `rising${risingWindow}`;
  }

  function setSizeMode(nextMode, nextWindow) {
    sizeMode = nextMode;
    risingWindow = nextWindow;
    root = buildHierarchy(mapData, activeSizeKey());
    focusNode = findNodeByIdPath(root, focusIdPath);
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

  function zoomTo(node) {
    focusNode = node;
    focusIdPath = node.ancestors().reverse().map((ancestor) => ancestor.data.id);
    renderBreadcrumb();
    renderLevel();
  }

  /**
   * Zooms into a synthetic "Others" box: rebuilds it as a real d3
   * hierarchy (so its own children get `.value`s under the active
   * sizeKey, same as any other node), then patches `.parent` to
   * `parentNode` — the real box Others was hiding children of — so
   * `ancestors()` (breadcrumb, `focusIdPath`) walks back through the real
   * tree exactly like zooming into an ordinary category would.
   *
   * Note: switching Popular/Rising mode (or window) while focus is on this
   * synthetic node will not restore it — see `findNodeByIdPath` for why
   * that's the intended fallback, not a bug.
   */
  function zoomToOthers(othersData, parentNode) {
    const syntheticNode = buildHierarchy(othersData, activeSizeKey());
    syntheticNode.parent = parentNode;
    zoomTo(syntheticNode);
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
      stageWidth: STAGE_WIDTH,
      stageHeight: STAGE_HEIGHT,
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
      renderPeek(box, node.children);
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        zoomTo(node);
      });
    } else if (onLeafClick) {
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        onLeafClick({ ...node.data, activeSizeKey: key });
      });
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

    renderPeek(box, hiddenChildren);

    box.addEventListener("click", (event) => {
      event.stopPropagation();
      zoomToOthers(data, parentNode);
    });

    return box;
  }

  /**
   * Adds a small preview grid of `children`'s (real d3 nodes, each with
   * `.value` and `.data`) top items as clickable logo icons, sized by
   * weight, inside `box` — this is what makes a category or Others box
   * show tool logos before you zoom into it. Reads `box`'s own current
   * pixel size (already set by the caller) to decide how many icons fit;
   * skips entirely if there's not enough room for even one.
   */
  function renderPeek(box, children) {
    if (!children || children.length === 0) return;

    const width = parseFloat(box.style.width);
    const height = parseFloat(box.style.height);
    if (width < PEEK_MIN_BOX_WIDTH || height < PEEK_MIN_BOX_HEIGHT) return;

    const capacity = Math.floor((width * height) / MIN_PEEK_AREA_PX);
    if (capacity < 1) return;

    const { visible, othersCount, othersWeight } = selectTopWithOthers(children, capacity);
    const weights = visible.map((child) => child.value);
    const minWeight = Math.min(...weights);
    const maxWeight = othersCount > 0 ? Math.max(...weights, othersWeight) : Math.max(...weights);
    const maxIconPx = Math.max(
      PEEK_MIN_ICON_PX,
      Math.min(PEEK_MAX_ICON_PX, Math.floor(Math.min(width, height) * 0.4)),
    );
    const sizeRange = { minPx: PEEK_MIN_ICON_PX, maxPx: maxIconPx, minWeight, maxWeight };

    const grid = document.createElement("div");
    grid.className = "treemap-peek-grid";

    for (const child of visible) {
      grid.appendChild(renderPeekIcon(child, sizeForWeight(child.value, sizeRange)));
    }

    if (othersCount > 0) {
      const tag = document.createElement("span");
      tag.className = "treemap-peek-more";
      const side = sizeForWeight(othersWeight, sizeRange);
      tag.style.width = `${side}px`;
      tag.style.height = `${side}px`;
      tag.textContent = `+${othersCount}`;
      grid.appendChild(tag);
    }

    box.appendChild(grid);
  }

  /**
   * One clickable icon inside a peek grid. Mirrors the logo-vs-fallback
   * handling `renderBox` uses for a full leaf box. Clicking opens the
   * detail panel directly for a project, or zooms in directly for a
   * (nested) category — either way `stopPropagation`'d so it doesn't also
   * trigger the containing box's own zoom-in click handler.
   */
  function renderPeekIcon(child, sidePx) {
    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "treemap-peek-icon";
    icon.style.width = `${sidePx}px`;
    icon.style.height = `${sidePx}px`;
    icon.title = child.data.name;

    if (!child.children && child.data.image) {
      const img = document.createElement("img");
      img.src = child.data.image;
      img.alt = child.data.name;
      img.onerror = () => img.replaceWith(renderFallbackLogo(child.data.name));
      icon.appendChild(img);
    } else {
      icon.appendChild(renderFallbackLogo(child.data.name));
    }

    icon.addEventListener("click", (event) => {
      event.stopPropagation();
      if (child.children) {
        zoomTo(child);
      } else if (onLeafClick) {
        onLeafClick({ ...child.data, activeSizeKey: activeSizeKey() });
      }
    });

    return icon;
  }

  renderModeBar();
  renderBreadcrumb();
  renderLevel();

  return { zoomTo, root };
}

function renderFallbackLogo(name) {
  const fallback = document.createElement("span");
  fallback.className = "treemap-logo-fallback";
  fallback.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return fallback;
}
