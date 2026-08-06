import { buildHierarchy, computeLayout, projectRect } from "./layout.js";

const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 600;

/**
 * Mounts a treemap for `mapData` (the parsed data.json tree) into
 * `container`. `imageBaseUrl` is the folder that leaf `image` filenames are
 * resolved against (e.g. "/data/data-science/images/").
 */
export function mountTreemap(container, mapData, imageBaseUrl) {
  const root = computeLayout(buildHierarchy(mapData), STAGE_WIDTH, STAGE_HEIGHT);

  container.innerHTML = "";
  const stage = document.createElement("div");
  stage.className = "treemap-stage";
  stage.style.width = `${STAGE_WIDTH}px`;
  stage.style.height = `${STAGE_HEIGHT}px`;
  container.appendChild(stage);

  renderLevel(stage, root, imageBaseUrl);

  return { root };
}

/** Renders `focusNode`'s children as boxes positioned within `stage`. */
function renderLevel(stage, focusNode, imageBaseUrl) {
  stage.innerHTML = "";
  const focusRect = { x0: focusNode.x0, y0: focusNode.y0, x1: focusNode.x1, y1: focusNode.y1 };

  for (const child of focusNode.children ?? []) {
    const rect = projectRect(child, focusRect, STAGE_WIDTH, STAGE_HEIGHT);
    stage.appendChild(renderBox(child, rect, imageBaseUrl));
  }
}

function renderBox(node, rect, imageBaseUrl) {
  const box = document.createElement("div");
  box.className = node.children ? "treemap-box treemap-category" : "treemap-box treemap-leaf";
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;

  const label = document.createElement("span");
  label.className = "treemap-label";
  label.textContent = node.data.name1;
  box.appendChild(label);

  if (!node.children && node.data.image) {
    const img = document.createElement("img");
    img.className = "treemap-logo";
    img.src = imageBaseUrl + node.data.image;
    img.alt = node.data.name1;
    img.onerror = () => img.replaceWith(renderFallbackLogo(node.data.name1));
    box.insertBefore(img, label);
  }

  return box;
}

function renderFallbackLogo(name) {
  const fallback = document.createElement("span");
  fallback.className = "treemap-logo-fallback";
  fallback.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return fallback;
}
