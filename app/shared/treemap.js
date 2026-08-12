import { buildHierarchy, computeLevelBoxes } from "./layout.js";

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

  function findNodeByIdPath(node, idPath) {
    let current = node;
    for (const id of idPath.slice(1)) {
      const next = current.children?.find((child) => child.data.id === id);
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
    const { data, rect } = othersBox;

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

    box.addEventListener("click", (event) => {
      event.stopPropagation();
      zoomToOthers(data, parentNode);
    });

    return box;
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
