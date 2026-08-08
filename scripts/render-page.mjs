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

/**
 * Escapes every `<` character so embedded JSON can't prematurely close its
 * `<script>` tag (e.g. via a `</script>` substring in the data). A `<` is a
 * perfectly ordinary character inside a JSON string, so replacing it with
 * `<` is a lossless, valid JSON escape — the parsed value is
 * unaffected, but no `</script>`-like substring can ever survive into the
 * raw HTML.
 */
function escapeScriptJson(json) {
  return json.replace(/</g, "\\u003c");
}

function renderShell({ title, ogTitle, ogDescription, ogImage, ogUrl, base, body }) {
  return TEMPLATE.replace(/{{TITLE}}/g, () => escapeHtml(title))
    .replace(/{{OG_TITLE}}/g, () => escapeHtml(ogTitle))
    .replace(/{{OG_DESCRIPTION}}/g, () => escapeHtml(ogDescription))
    .replace(/{{OG_IMAGE}}/g, () => escapeHtml(ogImage))
    .replace(/{{OG_URL}}/g, () => escapeHtml(ogUrl))
    .replace(/{{BASE}}/g, () => base)
    .replace("{{BODY}}", () => body);
}

/**
 * Renders a domain's full page (or its chrome-free embed variant, when
 * `embed` is true). `domain` is { slug, name, description }. `tree` is
 * buildTree's output; each leaf's `image` (when present) is already a
 * direct URL into the tool's source repo, ready to use as-is.
 */
export function renderDomainPage(domain, tree, { embed = false, defaultOgImage, siteUrl = "", basePath = "" }) {
  const backLink = embed ? "" : `<p class="back-link"><a href="${basePath}/">&larr; All maps</a></p>`;
  const ogUrl = `${siteUrl}${basePath}/${domain.slug}/`;
  const body = `
    <div id="app"></div>
    ${backLink}
    <script type="application/json" id="map-data">${escapeScriptJson(JSON.stringify(tree))}</script>
    <script type="module">
      import { mountTreemap } from "${basePath}/shared/treemap.js";
      import { createDetailPanel } from "${basePath}/shared/detail-panel.js";
      const mapData = JSON.parse(document.getElementById("map-data").textContent);
      const panel = createDetailPanel(document.body);
      mountTreemap(
        document.getElementById("app"),
        mapData,
        (leafData) => panel.open(leafData),
        () => panel.close()
      );
    </script>
  `;
  return renderShell({
    title: domain.name,
    ogTitle: domain.name,
    ogDescription: domain.description ?? "",
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}

/** Renders the landing page listing every domain. `domains` is an array of { slug, name, description }. */
export function renderLandingPage(domains, { defaultOgImage, siteUrl = "", basePath = "" }) {
  const cards = domains
    .map(
      (domain) => `
        <a class="map-card" href="${basePath}/${escapeHtml(domain.slug)}/">
          <h3>${escapeHtml(domain.name)}</h3>
          <p>${escapeHtml(domain.description ?? "")}</p>
        </a>`
    )
    .join("");
  const body = `
    <header class="hero">
      <div class="hero-motif" aria-hidden="true">
        <span class="hero-rect hero-rect-1"></span>
        <span class="hero-rect hero-rect-2"></span>
        <span class="hero-rect hero-rect-3"></span>
        <span class="hero-rect hero-rect-4"></span>
      </div>
      <div class="hero-content">
        <h1>awesomemap</h1>
        <p class="hero-tagline">Interactive, zoomable maps of open-source tool ecosystems — sized by adoption, explorable by category.</p>
      </div>
    </header>
    <div class="map-index">
      <h2 class="map-index-heading">Explore the maps</h2>
      <div class="map-grid">${cards}</div>
    </div>
  `;
  return renderShell({
    title: "awesomemap",
    ogTitle: "awesomemap",
    ogDescription: "A community-curated map of open-source technology.",
    ogImage: defaultOgImage,
    ogUrl: `${siteUrl}${basePath}/`,
    base: basePath,
    body,
  });
}
