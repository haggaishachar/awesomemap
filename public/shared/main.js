import { mountTreemap } from "./treemap.js";
import { createDetailPanel } from "./detail-panel.js";
import { slugFromPath } from "./router.js";

const app = document.getElementById("app");
const slug = slugFromPath(window.location.pathname);

if (slug === "") {
  renderMapIndex();
} else {
  loadMap(slug);
}

function renderMapIndex() {
  app.innerHTML = `
    <div class="map-index">
      <h1>techmap</h1>
      <ul>
        <li><a href="/data-science">Best Data Science Open Source Tools</a></li>
      </ul>
    </div>
  `;
}

function renderNotFound(slug) {
  app.innerHTML = `
    <div class="map-not-found">
      <h1>Map not found</h1>
      <p>There's no map called "${slug}".</p>
      <p><a href="/">Back to all maps</a></p>
    </div>
  `;
}

function loadMap(slug) {
  const imageBaseUrl = `/data/${slug}/images/`;
  const panel = createDetailPanel(document.body, imageBaseUrl);

  fetch(`/data/${slug}/data.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`data.json fetch failed with ${response.status}`);
      return response.json();
    })
    .then((mapData) => {
      mountTreemap(app, mapData, imageBaseUrl, (leafData) => panel.open(leafData));
    })
    .catch((error) => {
      console.error(`Failed to load map "${slug}":`, error);
      renderNotFound(slug);
    });
}
