import { mountTreemap } from "./treemap.js";

const app = document.getElementById("app");
const slug = "data-science";
const imageBaseUrl = `/data/${slug}/images/`;

fetch(`/data/${slug}/data.json`)
  .then((response) => response.json())
  .then((mapData) => mountTreemap(app, mapData, imageBaseUrl));
