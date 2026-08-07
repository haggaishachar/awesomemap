import { buildHierarchy, computeLayout, projectRect } from "./layout.js";

const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 600;

/**
 * Mounts a treemap for `mapData` into `container`. A leaf's `image`, when
 * present, is already a direct URL into its source repo. `onLeafClick(leafData)`,
 * if given, is called when a leaf box is clicked (categories zoom instead
 * of firing this callback).
 */
export function mountTreemap(container, mapData, onLeafClick) {
  const root = computeLayout(buildHierarchy(mapData), STAGE_WIDTH, STAGE_HEIGHT);

  container.innerHTML = "";
  const breadcrumb = document.createElement("div");
  breadcrumb.className = "treemap-breadcrumb";
  const stage = document.createElement("div");
  stage.className = "treemap-stage";
  stage.style.width = `${STAGE_WIDTH}px`;
  stage.style.height = `${STAGE_HEIGHT}px`;
  container.appendChild(breadcrumb);
  container.appendChild(stage);

  let focusNode = root;

  function zoomTo(node) {
    focusNode = node;
    renderBreadcrumb();
    renderLevel();
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
    const box = document.createElement("div");
    box.className = node.children ? "treemap-box treemap-category" : "treemap-box treemap-leaf";
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
        onLeafClick(node.data);
      });
    }

    return box;
  }

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
