import { readFileSync } from "node:fs";

const TEMPLATE = readFileSync(new URL("../app/index.html.template", import.meta.url), "utf8");

/** Escapes text for safe interpolation into HTML content. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escapes "</" sequences so embedded JSON can't prematurely close its <script> tag. */
function escapeScriptJson(json) {
  return json.replace(/</g, "\\u003c");
}

function renderShell({ title, ogTitle, ogDescription, ogImage, body }) {
  return TEMPLATE.replace(/{{TITLE}}/g, escapeHtml(title))
    .replace(/{{OG_TITLE}}/g, escapeHtml(ogTitle))
    .replace(/{{OG_DESCRIPTION}}/g, escapeHtml(ogDescription))
    .replace(/{{OG_IMAGE}}/g, escapeHtml(ogImage))
    .replace("{{BODY}}", body);
}

/**
 * Renders a domain's full page (or its chrome-free embed variant, when
 * `embed` is true). `domain` is { slug, name, description }. `tree` is
 * buildTree's output, with images already resolved onto each leaf.
 */
export function renderDomainPage(domain, tree, { embed = false, defaultOgImage }) {
  const backLink = embed ? "" : `<p class="back-link"><a href="/">&larr; All maps</a></p>`;
  const imageBaseUrl = `/${domain.slug}/images/`;
  const body = `
    <div id="app"></div>
    ${backLink}
    <script type="application/json" id="map-data">${escapeScriptJson(JSON.stringify(tree))}</script>
    <script type="module">
      import { mountTreemap } from "/shared/treemap.js";
      import { createDetailPanel } from "/shared/detail-panel.js";
      const mapData = JSON.parse(document.getElementById("map-data").textContent);
      const imageBaseUrl = ${JSON.stringify(imageBaseUrl)};
      const panel = createDetailPanel(document.body, imageBaseUrl);
      mountTreemap(document.getElementById("app"), mapData, imageBaseUrl, (leafData) => panel.open(leafData));
    </script>
  `;
  return renderShell({
    title: domain.name,
    ogTitle: domain.name,
    ogDescription: domain.description ?? "",
    ogImage: defaultOgImage,
    body,
  });
}

/** Renders the landing page listing every domain. `domains` is an array of { slug, name, description }. */
export function renderLandingPage(domains, { defaultOgImage }) {
  const cards = domains
    .map(
      (domain) => `
        <a class="map-card" href="/${domain.slug}">
          <h2>${escapeHtml(domain.name)}</h2>
          <p>${escapeHtml(domain.description ?? "")}</p>
        </a>`
    )
    .join("");
  const body = `
    <div class="map-index">
      <h1>techmap</h1>
      <div class="map-grid">${cards}</div>
    </div>
  `;
  return renderShell({
    title: "techmap",
    ogTitle: "techmap",
    ogDescription: "A community-curated map of open-source technology.",
    ogImage: defaultOgImage,
    body,
  });
}
