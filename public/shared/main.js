import { mountTreemap } from "./treemap.js";
import { createDetailPanel } from "./detail-panel.js";

const app = document.getElementById("app");
const slug = "data-science";
const imageBaseUrl = `/data/${slug}/images/`;

const panel = createDetailPanel(document.body, imageBaseUrl);

fetch(`/data/${slug}/data.json`)
  .then((response) => response.json())
  .then((mapData) => mountTreemap(app, mapData, imageBaseUrl, (leafData) => panel.open(leafData)));
