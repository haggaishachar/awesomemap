import { readFileSync } from "node:fs";

const TEMPLATE = readFileSync(new URL("../app/index.html.template", import.meta.url), "utf8");

const REPO_URL = "https://github.com/haggaishachar/awesomemap";

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

/** Site-wide nav bar: brand links home, right side links out to the GitHub repo. Omitted from embeds. */
function renderSiteHeader(basePath) {
  return `
    <header class="site-header">
      <a class="site-header-brand" href="${basePath}/">awesomemap</a>
      <div class="site-header-links">
        <a class="site-header-github" href="${REPO_URL}" aria-label="View awesomemap on GitHub">
          <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
          </svg>
        </a>
        <img class="site-header-stars" src="https://img.shields.io/github/stars/haggaishachar/awesomemap?style=social" alt="GitHub stars" width="94" height="20" loading="lazy" />
      </div>
    </header>`;
}

/** Site-wide footer: links back to the repo's license, contributing guide, and issue tracker. Omitted from embeds. */
function renderSiteFooter() {
  return `
    <footer class="site-footer">
      <a href="${REPO_URL}/blob/master/LICENSE">License</a>
      <a href="${REPO_URL}/blob/master/CONTRIBUTING.md">Contributing</a>
      <a href="${REPO_URL}/issues">Report an issue</a>
    </footer>`;
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
 * direct URL into the project's source repo, ready to use as-is.
 */
export function renderDomainPage(domain, tree, { embed = false, defaultOgImage, siteUrl = "", basePath = "" }) {
  const header = embed ? "" : renderSiteHeader(basePath);
  const footer = embed ? "" : renderSiteFooter();
  const ogUrl = `${siteUrl}${basePath}/${domain.slug}/`;
  // The domain's own `history.json` (copied from `data/history/<slug>.json`
  // by generate.mjs, when it exists) — fetched lazily by the detail panel
  // to draw its star-history sparkline. Always emitted, even for domains
  // with no history file yet; the panel's fetch fails gracefully (no
  // chart) rather than needing generate.mjs's fs state here.
  const historyUrl = `${basePath}/${domain.slug}/history.json`;
  const body = `
    ${header}
    <div id="app"></div>
    <script type="application/json" id="map-data">${escapeScriptJson(JSON.stringify(tree))}</script>
    <script type="module">
      import { mountTreemap } from "${basePath}/shared/treemap.js";
      import { createDetailPanel } from "${basePath}/shared/detail-panel.js";
      const mapData = JSON.parse(document.getElementById("map-data").textContent);
      const panel = createDetailPanel(document.body, { historyUrl: "${historyUrl}" });
      mountTreemap(
        document.getElementById("app"),
        mapData,
        (leafData) => panel.open(leafData),
        () => panel.close()
      );
    </script>
    ${footer}
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
    ${renderSiteHeader(basePath)}
    <header class="hero">
      <div class="hero-motif" aria-hidden="true">
        <span class="hero-rect hero-rect-1"></span>
        <span class="hero-rect hero-rect-2"></span>
        <span class="hero-rect hero-rect-3"></span>
        <span class="hero-rect hero-rect-4"></span>
      </div>
      <div class="hero-content">
        <h1>awesomemap</h1>
        <p class="hero-tagline">Interactive, zoomable maps of open-source project ecosystems — sized by adoption, explorable by category.</p>
      </div>
    </header>
    <div class="map-index">
      <h2 class="map-index-heading">Explore the maps</h2>
      <div class="map-grid">${cards}</div>
    </div>
    ${renderSiteFooter()}
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
