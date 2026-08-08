import { buildHierarchy, computeLayout, projectRect } from "./layout.js";

const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 600;
// Deliberately duplicated from scripts/velocity.mjs's RISING_WINDOWS_DAYS
// rather than imported: scripts/ is a build-time-only Node directory that
// generate.mjs never copies into dist/, so this browser module can't
// import from it. Keep both lists in sync if a window is ever added.
const RISING_WINDOWS_DAYS = [7, 30, 90];

/**
 * Mounts a treemap for `mapData` into `container`. A leaf's `image`, when
 * present, is already a direct URL into its source repo. `onLeafClick(leafData)`,
 * if given, is called when a leaf box is clicked (categories zoom instead
 * of firing this callback) — `leafData` is the leaf's data plus an
 * `activeSizeKey` field naming the size mode active when it was clicked
 * ("popular", "rising7", "rising30", or "rising90"), so the detail panel
 * can show the right stat.
 */
export function mountTreemap(container, mapData, onLeafClick) {
  let sizeMode = "popular"; // "popular" | "rising"
  let risingWindow = 30;
  let root = computeLayout(buildHierarchy(mapData, activeSizeKey()), STAGE_WIDTH, STAGE_HEIGHT);
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
    root = computeLayout(buildHierarchy(mapData, activeSizeKey()), STAGE_WIDTH, STAGE_HEIGHT);
    focusNode = findNodeByIdPath(root, focusIdPath);
    renderModeBar();
    renderBreadcrumb();
    renderLevel();
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
    const focusRect = { x0: focusNode.x0, y0: focusNode.y0, x1: focusNode.x1, y1: focusNode.y1 };
    for (const child of focusNode.children ?? []) {
      const rect = projectRect(child, focusRect, STAGE_WIDTH, STAGE_HEIGHT);
      stage.appendChild(renderBox(child, rect));
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
