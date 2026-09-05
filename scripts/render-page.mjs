import { readFileSync } from "node:fs";
import { RISING_WINDOWS_DAYS, SCORE_SMOOTHING_CONSTANT } from "./velocity.mjs";
import { rankGroups } from "./group-growth.mjs";
import { SMALL_PROJECT_STAR_THRESHOLD, MIN_MEANINGFUL_STAR_DELTA } from "./this-weeks-signals.mjs";
import { buildWebsiteJsonLd, buildItemListJsonLd, buildSoftwareSourceCodeJsonLd } from "./seo.mjs";
import {
  githubRepoUrl,
  buildStarChart,
  positionAnnotations,
  starHistoryCaption,
  formatEventDate,
  FULL_CHART_WIDTH,
  FULL_CHART_HEIGHT,
  FULL_CHART_PADDING,
} from "../app/shared/star-history.js";
import { buildTwitterShareUrl, buildLinkedInShareUrl, buildRedditShareUrl } from "../app/shared/share-links.js";
import { buildEmbedSnippet } from "../app/shared/embed-snippet.js";

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

/** Renders a JSON-LD structured-data block, escaped the same way the map-data block is (see `escapeScriptJson`) so no field can prematurely close the `<script>` tag. */
function renderJsonLd(data) {
  return `<script type="application/ld+json">${escapeScriptJson(JSON.stringify(data))}</script>`;
}

/**
 * Turns a raw tag string into its URL path segment (`/tags/<slug>/`).
 * GitHub topics are already lowercase and hyphen-separated, so this is
 * close to identity — centralizing it here (instead of inlining
 * `encodeURIComponent` at each call site that builds a tag URL) keeps "how
 * a tag becomes a route" one decision. `generate.mjs` imports this same
 * function to name each tag's directory on disk, so a page's URL and its
 * file path can never drift apart.
 */
export function tagSlug(tag) {
  return encodeURIComponent(tag);
}

/**
 * Site-wide nav bar: brand (icon + wordmark) links home, right side links
 * out to the GitHub repo. Omitted from embeds.
 *
 * On narrow viewports the links panel is collapsed behind the hamburger
 * button (`.site-header-toggle`) rather than left to wrap onto however many
 * rows it takes — see the `.site-header` mobile rule in treemap.css for why
 * unwrapped/wrapped both used to be a problem. The toggle just flips an
 * `is-open` class and its own `aria-expanded`; every link is a plain `<a>`
 * that navigates away on click, so there's no separate "close on selection"
 * logic to wire up.
 */
function renderSiteHeader(basePath) {
  return `
    <header class="site-header" id="site-header">
      <a class="site-header-brand" href="${basePath}/">
        <svg class="site-header-logo" viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
          <rect x="0" y="0" width="18" height="32" rx="2" fill="#2b5fad"/>
          <rect x="20" y="0" width="12" height="14" rx="2" fill="#6fa0e6"/>
          <rect x="20" y="16" width="12" height="16" rx="2" fill="#1a8a4a"/>
        </svg>
        awesomemap
      </a>
      <button type="button" class="site-header-toggle" id="site-header-toggle" aria-expanded="false" aria-controls="site-header-links" aria-label="Toggle menu">
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M2 4h12M2 8h12M2 12h12"/>
        </svg>
      </button>
      <div class="site-header-links" id="site-header-links">
        <a class="site-header-search" href="${basePath}/search/" aria-label="Search projects">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.5" d="M11.5 6.75a4.75 4.75 0 1 1-9.5 0 4.75 4.75 0 0 1 9.5 0Z"/>
            <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M10.4 10.4 14 14"/>
          </svg>
        </a>
        <a class="site-header-rising" href="${basePath}/rising/">Rising</a>
        <a class="site-header-tags" href="${basePath}/tags/">Tags</a>
        <a class="site-header-compare" id="site-header-compare" href="${basePath}/compare/">Compare</a>
        <a class="site-header-submit" href="${basePath}/submit/">Suggest a project</a>
        <a class="site-header-github" href="${REPO_URL}" aria-label="View awesomemap on GitHub">
          <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
          </svg>
        </a>
        <img class="site-header-stars" src="https://img.shields.io/github/stars/haggaishachar/awesomemap?style=social" alt="GitHub stars" width="94" height="20" loading="lazy" />
      </div>
    </header>
    <script>
      document.getElementById("site-header-toggle").addEventListener("click", (event) => {
        const isOpen = document.getElementById("site-header").classList.toggle("is-open");
        event.currentTarget.setAttribute("aria-expanded", String(isOpen));
      });
    </script>`;
}

/**
 * Bootstrap script wiring up the compare cart (app/shared/compare-cart.js)
 * for any page that can show a + Compare button — the detail panel,
 * project pages, /rising/ rows, and tag-page rows. Sits right after
 * renderSiteHeader in every caller (both are omitted together for
 * embeds), since it needs #site-header-compare to already be in the DOM.
 * A page with no + Compare buttons at all still gets this for free (it's
 * a no-op until one exists), rather than every page-render function
 * needing to remember to opt in individually.
 */
function renderCompareCartBootstrap(basePath) {
  return `
    <script type="module">
      import { initCompareCartUI } from "${basePath}/shared/compare-cart.js";
      initCompareCartUI("${basePath}");
    </script>`;
}

/** Site-wide footer: links back to the ranking methodology, the repo's license, contributing guide, issue tracker, and the contact form. Omitted from embeds. */
function renderSiteFooter(basePath) {
  return `
    <footer class="site-footer">
      <a href="${basePath}/methodology/">How we rank</a>
      <a href="${REPO_URL}/blob/master/LICENSE">License</a>
      <a href="${REPO_URL}/blob/master/CONTRIBUTING.md">Contributing</a>
      <a href="${REPO_URL}/issues">Report an issue</a>
      <a href="${basePath}/contact/">Contact us</a>
    </footer>`;
}

/**
 * The "awesomemap.dev" attribution badge shown below every treemap — full
 * domain pages and the chrome-free `/embed/<slug>/` pages alike. Embeds are
 * the reason this exists: dropped into someone else's site via `<iframe>`,
 * they'd otherwise carry zero attribution back, since `embed` already
 * strips the header/footer that would normally do that job.
 */
function renderMapBadge(siteUrl, basePath) {
  return `
    <a class="map-badge" href="${siteUrl}${basePath}/" target="_blank" rel="noopener">
      <svg class="map-badge-logo" viewBox="0 0 32 32" width="14" height="14" aria-hidden="true">
        <rect x="0" y="0" width="18" height="32" rx="2" fill="#2b5fad"/>
        <rect x="20" y="0" width="12" height="14" rx="2" fill="#6fa0e6"/>
        <rect x="20" y="16" width="12" height="16" rx="2" fill="#1a8a4a"/>
      </svg>
      awesomemap.dev
    </a>`;
}

// One small brand glyph per share channel, inline so no icon font/extra
// request is needed — same `currentColor` convention as the site header's
// GitHub icon, so each button's existing text color drives its icon too.
const SHARE_ICONS = {
  x: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M18.244 2H21l-6.53 7.47L22 22h-6.9l-5.4-7.02L3.4 22H1l7.02-8.03L2 2h7l4.86 6.42L18.244 2Zm-1.21 18h1.86L7.08 4H5.1l11.93 16Z"/></svg>',
  linkedin:
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.64h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.6c0-1.34-.02-3.06-1.87-3.06-1.87 0-2.16 1.46-2.16 2.96V21h-4V9Z"/></svg>',
  reddit:
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M22 12.1c0-1.16-.94-2.1-2.1-2.1-.56 0-1.06.22-1.44.57-1.4-.94-3.31-1.55-5.42-1.63l1.06-3.3 2.87.63a1.5 1.5 0 1 0 .14-.9l-3.2-.7a.4.4 0 0 0-.48.28l-1.2 3.75c-2.16.06-4.11.68-5.53 1.63A2.1 2.1 0 0 0 4.1 10a2.1 2.1 0 0 0-1 3.95c-.03.18-.04.36-.04.55 0 3.02 3.53 5.47 7.88 5.47s7.88-2.45 7.88-5.47c0-.18-.01-.36-.04-.53A2.1 2.1 0 0 0 22 12.1ZM8.2 13.4a1.2 1.2 0 1 1 2.4 0 1.2 1.2 0 0 1-2.4 0Zm7.32 3.06c-.8.8-2.05 1.19-3.52 1.19s-2.72-.4-3.52-1.19a.4.4 0 1 1 .57-.56c.63.63 1.63.95 2.95.95s2.32-.32 2.95-.95a.4.4 0 1 1 .57.56Zm-.24-1.86a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z"/></svg>',
};

/**
 * Share row (X/LinkedIn/Reddit) and Embed toggle for a domain page, placed
 * below the map (see renderDomainPage) so the buttons read as acting on the
 * map above them rather than on the page as a whole. X/LinkedIn/Reddit are
 * plain links — the URL shape alone is enough, no client JS involved —
 * built by share-links.js and escaped the same way every other href on the
 * page is; each carries a channel icon (SHARE_ICONS) alongside its label.
 * There's no separate "copy link" button — the map badge right below
 * already links to this same canonical URL, and browsers make copying a
 * page's own address a one-click affair from the address bar. The embed
 * snippet (from embed-snippet.js) is escaped a *second* time here:
 * embed-snippet.js's own escaping makes the iframe tag itself valid HTML,
 * and this escaping is what makes that markup display as literal source
 * text inside the `<textarea>` rather than being parsed as a tag. Omitted
 * entirely from the embed variant — an embedded map has nothing further to
 * share or embed.
 */
function renderMapActions({ ogUrl, embedUrl, domainName, basePath }) {
  const xUrl = escapeHtml(buildTwitterShareUrl(ogUrl, domainName));
  const linkedInUrl = escapeHtml(buildLinkedInShareUrl(ogUrl));
  const redditUrl = escapeHtml(buildRedditShareUrl(ogUrl, domainName));
  const embedSnippet = escapeHtml(buildEmbedSnippet(embedUrl, domainName));
  return `
    <div class="map-actions">
      <div class="map-share" role="group" aria-label="Share this map">
        <a class="map-share-x" href="${xUrl}" target="_blank" rel="noopener">${SHARE_ICONS.x} X</a>
        <a class="map-share-linkedin" href="${linkedInUrl}" target="_blank" rel="noopener">${SHARE_ICONS.linkedin} LinkedIn</a>
        <a class="map-share-reddit" href="${redditUrl}" target="_blank" rel="noopener">${SHARE_ICONS.reddit} Reddit</a>
      </div>
      <button type="button" class="map-embed-toggle" aria-expanded="false" aria-controls="map-embed-panel">Embed</button>
    </div>
    <div class="map-embed-panel" id="map-embed-panel" hidden>
      <textarea class="map-embed-code" readonly>${embedSnippet}</textarea>
      <button type="button" class="map-embed-copy">Copy</button>
    </div>`;
}

/**
 * Wires up renderMapActions's embed-copy button and the embed panel's
 * show/hide toggle. Sits right after that markup in every caller, the same
 * convention renderCompareCartBootstrap follows for the header.
 */
function renderMapActionsBootstrap(basePath) {
  return `
    <script type="module">
      import { copyToClipboard } from "${basePath}/shared/clipboard.js";
      function flashCopied(button) {
        const original = button.textContent;
        button.textContent = "Copied!";
        setTimeout(() => { button.textContent = original; }, 1500);
      }
      document.querySelector(".map-embed-copy").addEventListener("click", async (event) => {
        await copyToClipboard(document.querySelector(".map-embed-code").value);
        flashCopied(event.currentTarget);
      });
      const embedToggle = document.querySelector(".map-embed-toggle");
      const embedPanel = document.getElementById("map-embed-panel");
      embedToggle.addEventListener("click", () => {
        const opening = embedPanel.hidden;
        embedPanel.hidden = !opening;
        embedToggle.setAttribute("aria-expanded", String(opening));
      });
    </script>`;
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
export function renderDomainPage(
  domain,
  tree,
  {
    embed = false,
    defaultOgImage,
    siteUrl = "",
    basePath = "",
    teaser = [],
    categoryGrowth = [],
    momentumWindowDays = RISING_WINDOWS_DAYS[0],
    topTags = [],
    risingTags = [],
  }
) {
  const header = embed ? "" : renderSiteHeader(basePath);
  const compareCartScript = embed ? "" : renderCompareCartBootstrap(basePath);
  const footer = embed ? "" : renderSiteFooter(basePath);
  // Omitted from embeds along with the rest of the chrome (see the other
  // `embed ? "" : ...` assignments below) — a domain's name and description
  // are page framing, not part of the visualization itself. Every other
  // inner page already opens with this same `.rising-hero` header; the
  // domain page was the one surface with no on-page heading or description
  // at all, dropping a direct visitor straight into the map with no context
  // for what it's scoped to.
  const heroSection = embed
    ? ""
    : `
    <header class="rising-hero">
      <h1>${escapeHtml(domain.name)}</h1>
      <p class="rising-hero-tagline">${escapeHtml(domain.description ?? "")}</p>
    </header>`;
  const teaserSection = embed
    ? ""
    : renderRisingTeaser(teaser, { heading: "Rising this week", href: `${basePath}/rising/#${domain.slug}`, showDomain: false, basePath });
  // Omitted from embeds along with the rest of the chrome — an embedded map is
  // a visualization, not a page.
  const categorySection = embed ? "" : renderCategoryMomentum(categoryGrowth, { windowDays: momentumWindowDays });
  const tagSection = embed ? "" : renderTagWidget(topTags, risingTags, { basePath, windowDays: momentumWindowDays });
  const ogUrl = `${siteUrl}${basePath}/${domain.slug}/`;
  const embedUrl = `${siteUrl}${basePath}/embed/${domain.slug}/`;
  // Omitted from the embed variant, like the rest of the page chrome — an
  // embedded map is already what these buttons would point at embedding or
  // sharing, so it has nothing further to offer. Placed below the map itself
  // (see `body` below) rather than above it, so the buttons read as acting
  // on the map a visitor has just seen, not on a page they haven't scrolled
  // into yet.
  const mapActionsSection = embed
    ? ""
    : renderMapActions({ ogUrl, embedUrl, domainName: domain.name, basePath }) + renderMapActionsBootstrap(basePath);
  // Unlike the rest of the chrome above, shown on *both* variants — see
  // renderMapBadge's own doc comment for why embeds need this most.
  const mapBadge = renderMapBadge(siteUrl, basePath);
  // Omitted from the embed variant along with the header/footer/teaser —
  // it's structured data for search engines, and embed pages are already
  // excluded from the sitemap as duplicate content (see seo.mjs).
  const itemListJsonLd = embed
    ? ""
    : renderJsonLd(buildItemListJsonLd(domain.name, domain.projects ?? [], { url: ogUrl }));
  // The domain's own `history.json` (built by generate.mjs from each
  // project entity's own `history` array — see data/projects/) — fetched
  // lazily by the detail panel to draw its star-history sparkline. Always
  // emitted, even for a domain whose projects have no snapshots yet; the
  // panel degrades gracefully (no chart) rather than needing generate.mjs's
  // fs state here.
  const historyUrl = `${basePath}/${domain.slug}/history.json`;
  const body = `
    ${header}
    ${heroSection}
    ${compareCartScript}
    ${itemListJsonLd}
    <div id="app"></div>
    <script type="application/json" id="map-data">${escapeScriptJson(JSON.stringify(tree))}</script>
    <script type="module">
      import { mountTreemap } from "${basePath}/shared/treemap.js";
      import { createDetailPanel } from "${basePath}/shared/detail-panel.js";
      import { parseZoomState, formatZoomState } from "${basePath}/shared/zoom-url.js";
      const mapData = JSON.parse(document.getElementById("map-data").textContent);
      const panel = createDetailPanel(document.body, { historyUrl: "${historyUrl}", basePath: "${basePath}", showProjectPageLink: ${!embed}, showCompareLink: ${!embed} });
      // \`validWindows\` comes from generate.mjs's own RISING_WINDOWS_DAYS
      // (baked in at build time) rather than a browser-side copy, so this
      // list can't drift from the one that actually built \`mapData\`.
      const zoomUrlOptions = { rootId: "${tree.id}", validWindows: ${JSON.stringify(RISING_WINDOWS_DAYS)} };
      function stateUrl(state) {
        return location.pathname + formatZoomState(state, zoomUrlOptions) + location.hash;
      }
      const initialState = parseZoomState(new URLSearchParams(location.search), zoomUrlOptions);
      // Gives the very first back-press (after any zoom) a defined entry to
      // return to, instead of one with no state attached.
      history.replaceState(initialState, "", stateUrl(initialState));
      const treemap = mountTreemap(
        document.getElementById("app"),
        mapData,
        (leafData) => panel.open(leafData),
        () => panel.close(),
        {
          initialState,
          onNavigate: (state, { replace }) => {
            if (replace) {
              history.replaceState(state, "", stateUrl(state));
            } else {
              history.pushState(state, "", stateUrl(state));
            }
          },
        }
      );
      // Restores the treemap to match the URL after a back/forward
      // navigation — \`event.state\` is whatever was pushed/replaced above,
      // except on the very first pop back to a page loaded before this
      // code ever ran a replaceState, when it's null.
      window.addEventListener("popstate", (event) => {
        const state = event.state ?? parseZoomState(new URLSearchParams(location.search), zoomUrlOptions);
        treemap.applyState(state);
      });
    </script>
    ${mapBadge}
    ${mapActionsSection}
    ${embed ? "" : '<hr class="map-section-divider" />'}
    <div class="domain-insights">
      ${categorySection}
      ${tagSection}
      ${teaserSection}
    </div>
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

/** Formats a star delta with a sign and thousands separators, e.g. `+12,400`. */
function formatSignedStars(starDelta) {
  const sign = starDelta > 0 ? "+" : starDelta < 0 ? "−" : "";
  return `${sign}${Math.abs(starDelta).toLocaleString("en-US")}`;
}

/**
 * Formats a percentage with a sign, e.g. `+1.4%` or `+0.24%`.
 *
 * Sub-1% values get a second decimal because that's the range a whole
 * ecosystem's weekly growth actually lives in: at one decimal, five domains
 * spanning 0.065% to 0.12% all render as an identical "+0.1%", which makes a
 * list that claims to be ranked by growth rate look arbitrary. Above 1% the
 * extra digit is just noise, so it's dropped.
 */
function formatSignedPercent(percentDelta) {
  const sign = percentDelta > 0 ? "+" : percentDelta < 0 ? "−" : "";
  const magnitude = Math.abs(percentDelta);
  return `${sign}${magnitude.toFixed(magnitude < 1 ? 2 : 1)}%`;
}

/** The CSS class carrying the green/red growth colour, matching the rising rows' convention. */
function growthDirectionClass(starDelta) {
  return starDelta > 0 ? "momentum-up" : starDelta < 0 ? "momentum-down" : "momentum-flat";
}

/**
 * Renders a group's growth as a short stat line — the shared presentation for
 * a domain's momentum and a category's momentum, since both are
 * `computeGroupGrowth` results.
 *
 * A group without enough history reports *when tracking started* rather than a
 * `0%` it hasn't earned. Two domains currently have no snapshots at all, and
 * showing them as flat would be indistinguishable from a genuinely stalled
 * ecosystem — the same distinction the detail panel already draws for a single
 * project ("Not enough history yet — first tracked …").
 */
function renderMomentumStat(growth, { windowDays }) {
  if (!growth || !growth.hasEnoughHistory) {
    const since = growth?.oldestDate ? ` — first tracked ${escapeHtml(growth.oldestDate)}` : "";
    return `<span class="momentum-stat momentum-pending">Not tracked yet${since}</span>`;
  }
  return `
    <span class="momentum-stat ${growthDirectionClass(growth.starDelta)}">
      <strong>${formatSignedPercent(growth.percentDelta)}</strong>
      <span class="momentum-abs">${formatSignedStars(growth.starDelta)} stars in ${windowDays}d</span>
    </span>`;
}

/**
 * Renders a domain's categories ranked by growth rate — the zoom below the
 * domain level, answering "where inside this ecosystem is the heat?".
 * `rankedCategories` is `rankGroups` output over `{ key, growth }`.
 */
function renderCategoryMomentum(rankedCategories, { windowDays, limit = 5 }) {
  const tracked = rankedCategories.filter((category) => category.growth.hasEnoughHistory);
  if (tracked.length === 0) return "";
  const rows = tracked
    .slice(0, limit)
    .map(
      (category) => `
        <li class="momentum-row">
          <span class="momentum-row-rank">${category.rank}</span>
          <span class="momentum-row-name" title="${escapeHtml(category.key)}">${escapeHtml(category.key)}</span>
          <span class="momentum-row-coverage">${category.growth.trackedCount}/${category.growth.projectCount} tracked</span>
          ${renderMomentumStat(category.growth, { windowDays })}
        </li>`
    )
    .join("");
  return `
    <section class="category-momentum">
      <h2 class="category-momentum-heading">Where the heat is</h2>
      <ol class="momentum-rows-list">${rows}</ol>
    </section>`;
}

/**
 * Renders a domain page's "Top tags" widget — a third section in
 * `.domain-insights`, alongside "Where the heat is" and the rising teaser.
 * `topTags` is `computeTopTags` output for this domain's projects (no
 * history needed); `risingTags` is `computeRisingTags` output for the same
 * domain at `windowDays`, used only to decorate a top-tag row with a
 * growth badge when that same tag also qualifies as rising. This lookup is
 * a display-only join — `tag-growth.mjs` already decided eligibility and
 * ranking for both lists; this only asks "does this tag also appear in
 * that other already-ranked list."
 */
function renderTagWidget(topTags, risingTags, { basePath, windowDays, limit = 8 }) {
  if (topTags.length === 0) return "";
  const risingByTag = new Map(risingTags.map((entry) => [entry.tag, entry]));
  const rows = topTags
    .slice(0, limit)
    .map((entry) => {
      const rising = risingByTag.get(entry.tag);
      const badge = rising ? renderMomentumStat(rising.growth, { windowDays }) : "";
      const count = `${entry.projectCount} project${entry.projectCount === 1 ? "" : "s"}`;
      return `
        <li class="momentum-row">
          <span class="momentum-row-rank">${entry.rank}</span>
          <a class="momentum-row-name" href="${basePath}/tags/${tagSlug(entry.tag)}/" title="${escapeHtml(entry.tag)}">${escapeHtml(entry.tag)}</a>
          <span class="momentum-row-coverage">${count}</span>
          ${badge}
        </li>`;
    })
    .join("");
  return `
    <section class="category-momentum">
      <h2 class="category-momentum-heading">Top tags in this domain</h2>
      <ol class="momentum-rows-list">${rows}</ol>
    </section>`;
}

/**
 * Renders the landing page listing every domain. `domains` is an array of
 * { slug, name, shortName, description, growth } where `growth` is that
 * domain's `computeGroupGrowth` result for the momentum window.
 *
 * Cards are ordered by growth rate rather than by filename, so the page opens
 * on an answer ("AI is moving fastest this week") instead of an alphabetical
 * index. Untracked domains sort last — see `rankGroups`.
 */
export function renderLandingPage(
  domains,
  { defaultOgImage, siteUrl = "", basePath = "", signals = {}, signalsByDomain = {}, momentumWindowDays = RISING_WINDOWS_DAYS[0] }
) {
  const rankedDomains = rankGroups(
    domains.map((domain) => ({
      key: domain.slug,
      domain,
      growth: domain.growth ?? { hasEnoughHistory: false, percentDelta: 0 },
    }))
  );

  const cards = rankedDomains
    .map(({ domain, growth }) => {
      // The heading is the short name, not the long SEO title: nine cards all
      // opening with "Best … Open Source Projects" are unscannable and defeat
      // the growth comparison the ordering is there to support. The full name
      // stays in `title`, and every domain page still carries it in its own
      // <title>, <h1>, og:* tags, and JSON-LD.
      const count = growth?.projectCount ? `<span class="map-card-count">${growth.projectCount} projects</span>` : "";
      return `
        <a class="map-card" href="${basePath}/${escapeHtml(domain.slug)}/" title="${escapeHtml(domain.name)}">
          <h3>${escapeHtml(domain.shortName ?? domain.name)}</h3>
          <p>${escapeHtml(domain.description ?? "")}</p>
          <span class="map-card-meta">
            ${count}
            ${renderMomentumStat(growth, { windowDays: momentumWindowDays })}
          </span>
        </a>`;
    })
    .join("");
  const signalsSection = renderThisWeeksSignals(signals, { basePath, domains, signalsByDomain });
  const websiteJsonLd = renderJsonLd(
    buildWebsiteJsonLd({
      name: "awesomemap",
      description: "A community-curated map of open-source technology.",
      url: `${siteUrl}${basePath}/`,
    })
  );
  const body = `
    ${renderSiteHeader(basePath)}
    ${renderCompareCartBootstrap(basePath)}
    ${websiteJsonLd}
    <header class="hero">
      <div class="hero-motif" aria-hidden="true">
        <span class="hero-rect hero-rect-1"></span>
        <span class="hero-rect hero-rect-2"></span>
        <span class="hero-rect hero-rect-3"></span>
        <span class="hero-rect hero-rect-4"></span>
      </div>
      <div class="hero-content">
        <h1>awesomemap</h1>
        <p class="hero-tagline">What's taking off in open source — spotted by growth, not just stars.</p>
      </div>
    </header>
    ${signalsSection}
    <div class="map-index">
      <h2 class="map-index-heading">Explore the maps</h2>
      <p class="map-index-note">Ranked by how fast each ecosystem grew over the last ${momentumWindowDays} days — growth rate, not size.</p>
      <div class="map-grid">${cards}</div>
    </div>
    ${renderSiteFooter(basePath)}
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

/**
 * Formats one leaderboard entry (as returned by leaderboard.mjs's
 * computeLeaderboard) as a row. `showDomain` controls whether the
 * cross-domain tag is shown — true for the global list, false for a single
 * domain's own list. The name links to the project's own internal page
 * (`/projects/<id>/`, prefixed by `basePath`) rather than straight to
 * `entry.link` (the external homepage) — that page is what shows the
 * description, star-history sparkline, domain rank, and tags before
 * sending visitors onward. `entry.link` is used only as a fallback for the
 * (currently theoretical) case of an entry with no project id. `entry.eventReason`
 * (joined on by generate.mjs's `withEventReason`, scoped to this row's own
 * window — 7d/30d/90d can each point at a different event, or none) renders
 * as a compact badge next to the repo id, omitted just as often as shown
 * since these events are sparse — see the homepage signal cards' `reason`
 * line for the same data shown as a full sentence, where there's room for one.
 */
function renderRisingRow(entry, { showDomain, basePath }) {
  const arrowSymbol = entry.rankDelta > 0 ? "▲" : entry.rankDelta < 0 ? "▼" : "–";
  const arrowClass = entry.rankDelta > 0 ? "rising-row-up" : entry.rankDelta < 0 ? "rising-row-down" : "rising-row-flat";
  const movedBy = Math.abs(entry.rankDelta);
  const sign = entry.starDelta > 0 ? "+" : "";
  const pct = entry.percentDelta.toFixed(1);
  const icon = entry.image ? `<img class="rising-row-icon" src="${escapeHtml(entry.image)}" alt="" loading="lazy" />` : "";
  const domainShort = entry.domainShort ?? entry.domain;
  const domainTag = showDomain
    ? `<span class="rising-row-domain" title="${escapeHtml(entry.domain)}">${escapeHtml(domainShort)}</span>`
    : "";
  const repoId = entry.id ? `<span class="rising-row-repo">${escapeHtml(entry.id)}</span>` : "";
  // Compact badge, not the homepage cards' full sentence — this row has no
  // spare width for one. Reuses EVENT_TYPE_LABELS' short form (already
  // shown on the project page's own timeline) rather than a separate label
  // map; the fuller "why" sentence goes in the tooltip instead, for anyone
  // who hovers.
  const reasonBadge = entry.eventReason
    ? `<span class="rising-row-reason" title="${escapeHtml(formatEventReasonTitle(entry.eventReason))}">${escapeHtml(EVENT_TYPE_LABELS[entry.eventReason.type] ?? entry.eventReason.type)}</span>`
    : "";
  const projectHref = entry.id ? `${basePath}/projects/${entry.id}/` : (entry.link ?? "#");
  // Only a real project id is addable to the compare cart — an entry
  // without one (the theoretical fallback above) has no compare-index.json
  // record to toggle against.
  const compareToggle = entry.id
    ? `<button type="button" class="rising-row-compare compare-toggle" data-compare-id="${escapeHtml(entry.id)}" aria-pressed="false">+ Compare</button>`
    : "";
  return `
    <li class="rising-row" data-domain="${escapeHtml(entry.domainSlug ?? "")}">
      <span class="rising-row-rank">${entry.rank}</span>
      ${icon}
      <span class="rising-row-title">
        <a class="rising-row-name" href="${escapeHtml(projectHref)}">${escapeHtml(entry.name)}</a>
        ${repoId}
        ${reasonBadge}
      </span>
      ${domainTag}
      <span class="rising-row-arrow ${arrowClass}">${arrowSymbol}${movedBy > 0 ? movedBy : ""}</span>
      <span class="rising-row-delta">${sign}${entry.starDelta} (${sign}${pct}%)</span>
      ${compareToggle}
    </li>`;
}

/** Renders a leaderboard's rows, or a not-ready placeholder when `entries` is empty (e.g. a domain too new for this window). Shared with the teaser sections added in Task 4. */
function renderRisingRows(entries, { showDomain, basePath }) {
  if (entries.length === 0) {
    return `<p class="rising-empty">Not enough star-history yet for this window.</p>`;
  }
  return `<ol class="rising-rows-list">${entries.map((entry) => renderRisingRow(entry, { showDomain, basePath })).join("")}</ol>`;
}

/**
 * Renders a short teaser (already-sliced entries, typically top 5, 7-day
 * window) linking to the full leaderboard — used on the landing page
 * (global) and each domain page (that domain's own list).
 */
function renderRisingTeaser(entries, { heading, href, showDomain, basePath }) {
  return `
    <section class="rising-teaser">
      <h2 class="rising-teaser-heading">${escapeHtml(heading)}</h2>
      ${renderRisingRows(entries, { showDomain, basePath })}
      <a class="rising-teaser-link" href="${escapeHtml(href)}">See full leaderboard →</a>
    </section>`;
}

/**
 * One card in the landing page's "This week's signals" module — same shape for
 * every signal type, just a different label/title/stat/meta/href/desc. `desc`
 * (a project's own `data/projects/**.json` `desc` field) is omitted when the
 * project has none, same fallback `renderHeaderCell` in compare.js uses.
 * `reason` (from `formatEventReason`) is the answer to "why" — an in-window
 * external mention explaining the stat above it — and is omitted just as
 * often as it's shown, since these events are sparse (see sources.md); a
 * card with no in-window event renders exactly as it did before this
 * existed. The navigable content lives in an inner `<a>` rather than making
 * the whole card a link, so the `compare-toggle` button (`compareId`, when
 * the signal has a project id) can sit alongside it as its own click target
 * instead of nesting a `<button>` inside an `<a>` — invalid HTML that
 * would also make the button's click bubble into the card's navigation.
 * `reason` is plain text rather than a link to the mention itself for the
 * same reason: it lives inside that same outer `<a>`, and a nested `<a>`
 * would be invalid HTML too — the project's own page links to the mention.
 */
function renderSignalCard({ label, title, stat, meta, href, compareId, desc, reason }) {
  const reasonLine = reason ? `<span class="signal-card-reason">${escapeHtml(reason)}</span>` : "";
  const metaLine = meta ? `<span class="signal-card-meta">${escapeHtml(meta)}</span>` : "";
  const descLine = desc ? `<span class="signal-card-desc">${escapeHtml(desc)}</span>` : "";
  const compareToggle = compareId
    ? `<button type="button" class="signal-card-compare compare-toggle" data-compare-id="${escapeHtml(compareId)}" aria-pressed="false">+ Compare</button>`
    : "";
  return `
    <div class="signal-card">
      <a class="signal-card-link" href="${escapeHtml(href)}">
        <span class="signal-card-label">${label}</span>
        <span class="signal-card-title">${escapeHtml(title)}</span>
        <span class="signal-card-stat">${stat}</span>
        ${reasonLine}
        ${metaLine}
        ${descLine}
      </a>
      ${compareToggle}
    </div>`;
}

// Short phrase per event type for a signal card's "why" line — deliberately
// more editorial than EVENT_TYPE_LABELS' plain names, since this reads as a
// headline fragment ("Featured on Hacker News"), not a tag. Falls back to a
// generic template for a type this map hasn't caught up with yet, same
// convention as EVENT_TYPE_LABELS' own fallback.
const EVENT_REASON_PHRASES = {
  hn: "Featured on Hacker News",
  lobsters: "Discussed on Lobsters",
  reddit: "Trending on Reddit",
  producthunt: "Launched on Product Hunt",
  bluesky: "Buzzing on Bluesky",
  blog: "Covered in the press",
};

/** Formats a signal candidate's `eventReason` (from `pickReasonEvent`, joined on by generate.mjs) into the card's "why" phrase, or null when it has none. */
function formatEventReason(eventReason) {
  if (!eventReason) return null;
  return EVENT_REASON_PHRASES[eventReason.type] ?? `Mentioned on ${eventReason.type}`;
}

/** Full-sentence tooltip for a rising row's compact reason badge — the same phrase as the homepage cards, plus a points count when the event type carries one (blog events don't, see sources.md). */
function formatEventReasonTitle(eventReason) {
  const phrase = formatEventReason(eventReason);
  if (!phrase) return null;
  return typeof eventReason.points === "number" ? `${phrase} · ${formatCount(eventReason.points)} pts` : phrase;
}

/**
 * Renders one scope's up to-four cards (biggest mover, unexpected breakout,
 * heating-up project, one-to-watch) built from a `pickThisWeeksSignals`
 * result — either the global pool or a single domain's. Any signal that's
 * `null` (no qualifying candidate — including a scope where nothing cleared
 * `MIN_MEANINGFUL_STAR_DELTA` this week) is skipped. Falls back to the same
 * not-enough-history message `renderRisingRows` uses, rather than rendering
 * an empty grid, so switching the domain filter to a domain without enough
 * history (or without any meaningful growth) yet doesn't just leave blank
 * space.
 */
function renderSignalCards({ mover, heatingUp, watch, breakout } = {}, { basePath }) {
  const cards = [
    mover &&
      renderSignalCard({
        label: "🔥 Biggest mover",
        title: mover.name,
        stat: `+${mover.starDelta} stars (+${mover.percentDelta.toFixed(1)}%) this week`,
        meta: mover.domainShort,
        href: `${basePath}/projects/${mover.id}/`,
        compareId: mover.id,
        desc: mover.desc,
        reason: formatEventReason(mover.eventReason),
      }),
    breakout &&
      renderSignalCard({
        label: "🚀 Unexpected breakout",
        title: breakout.name,
        stat: `${breakout.relativeMultiple.toFixed(1)}× faster than ${breakout.categoryName} this week`,
        meta: breakout.domainShort,
        href: `${basePath}/projects/${breakout.id}/`,
        compareId: breakout.id,
        desc: breakout.desc,
        reason: formatEventReason(breakout.eventReason),
      }),
    heatingUp &&
      renderSignalCard({
        label: "📈 Heating up",
        title: heatingUp.name,
        stat: `+${heatingUp.percentDelta.toFixed(1)}% this week`,
        meta: heatingUp.domainShort,
        href: `${basePath}/projects/${heatingUp.id}/`,
        compareId: heatingUp.id,
        desc: heatingUp.desc,
        reason: formatEventReason(heatingUp.eventReason),
      }),
    watch &&
      renderSignalCard({
        label: "👀 One to watch",
        title: watch.name,
        stat: `+${watch.percentDelta.toFixed(1)}% this week · ★ ${formatStars(watch.currentStars)}`,
        meta: watch.domainShort,
        href: `${basePath}/projects/${watch.id}/`,
        compareId: watch.id,
        desc: watch.desc,
        reason: formatEventReason(watch.eventReason),
      }),
  ].filter(Boolean);

  if (cards.length === 0) {
    return `<p class="signals-empty">Not enough star-history yet for this window.</p>`;
  }
  return `<div class="signals-grid">${cards.join("")}</div>`;
}

/**
 * Renders the landing page's "This week's signals" module: a domain filter
 * bar (mirroring the one on `/rising/` — swapping which pre-rendered scope
 * is visible client-side rather than navigating away), the global "All
 * domains" cards plus one hidden card-set per domain from
 * `signalsByDomain`, and a link to the full `/rising/` leaderboard. The
 * whole section is omitted when neither the global scope nor any domain has
 * a qualifying signal yet, rather than rendering an empty shell.
 */
function renderThisWeeksSignals(signals = {}, { basePath, domains = [], signalsByDomain = {} }) {
  const hasSignal = (s) => Boolean(s?.mover || s?.heatingUp || s?.watch || s?.breakout);
  if (!hasSignal(signals) && !domains.some((domain) => hasSignal(signalsByDomain[domain.slug]))) return "";

  const domainFilterBar =
    domains.length > 0
      ? `
    <div class="signals-domain-filter" role="group" aria-label="Filter this week's signals by domain">
      <button type="button" class="signals-domain-button signals-domain-button-active" data-domain="all">All</button>
      ${domains
        .map(
          (domain) =>
            `<button type="button" class="signals-domain-button" data-domain="${escapeHtml(domain.slug)}">${escapeHtml(domain.shortName ?? domain.name)}</button>`
        )
        .join("")}
    </div>`
      : "";

  const scopes = [
    `<div class="signals-scope" data-signals-scope="all">${renderSignalCards(signals, { basePath })}</div>`,
    ...domains.map(
      (domain) =>
        `<div class="signals-scope" data-signals-scope="${escapeHtml(domain.slug)}" hidden>${renderSignalCards(signalsByDomain[domain.slug], { basePath })}</div>`
    ),
  ].join("");

  // Same show/hide-by-id approach as /rising/'s domain filter (see
  // renderRisingPage) — every scope is pre-rendered at build time, so
  // switching domains never re-fetches or recomputes anything client-side.
  const filterScript =
    domains.length > 0
      ? `
    <script>
      document.querySelectorAll(".signals-domain-filter button").forEach((button) => {
        button.addEventListener("click", () => {
          const selected = button.dataset.domain;
          document.querySelectorAll(".signals-domain-filter button").forEach((b) => {
            b.classList.toggle("signals-domain-button-active", b === button);
          });
          document.querySelectorAll(".this-weeks-signals [data-signals-scope]").forEach((el) => {
            el.hidden = el.dataset.signalsScope !== selected;
          });
        });
      });
    </script>`
      : "";

  return `
    <section class="this-weeks-signals">
      <h2 class="this-weeks-signals-heading">This week's signals</h2>
      ${domainFilterBar}
      ${scopes}
      <a class="this-weeks-signals-link" href="${basePath}/rising/">See full leaderboard →</a>
    </section>
    ${filterScript}`;
}

/**
 * Renders one leaderboard section's three window variants (7/30/90 days),
 * only the first shown initially — the rest sit `hidden` until the page's
 * window-toggle script flips them, so switching windows never re-fetches
 * or recomputes anything client-side. `leaderboardsByWindow` is
 * `{ [windowDays]: { [scopeKey]: entries[] } }`; `scopeKey` selects which
 * leaderboard within each window this section shows.
 */
function renderRisingWindowVariants(leaderboardsByWindow, scopeKey, { showDomain, basePath }) {
  return RISING_WINDOWS_DAYS.map((windowDays, index) => {
    const entries = leaderboardsByWindow[windowDays]?.[scopeKey] ?? [];
    const hiddenAttr = index === 0 ? "" : " hidden";
    return `<div class="rising-rows" data-window="${windowDays}"${hiddenAttr}>${renderRisingRows(entries, { showDomain, basePath })}</div>`;
  }).join("");
}

/** One full leaderboard section (heading + all three window variants), anchorable by `id`. `hidden` starts the whole section — not just individual rows — collapsed, for sections the domain filter hasn't selected yet. */
function renderRisingSection({ id, heading, leaderboardsByWindow, scopeKey, showDomain, basePath, hidden = false }) {
  return `
    <section class="rising-section" id="${escapeHtml(id)}"${hidden ? " hidden" : ""}>
      <h2 class="rising-section-heading">${escapeHtml(heading)}</h2>
      ${renderRisingWindowVariants(leaderboardsByWindow, scopeKey, { showDomain, basePath })}
    </section>`;
}

/**
 * Renders the dedicated Rising page: the cross-domain "Hottest overall"
 * leaderboard (global top 20 by score), plus one hidden section per domain
 * — that domain's own top 20, computed by filtering to it *before* ranking
 * (`computeLeaderboard(..., { scope: domain.slug })`), not by slicing rows
 * out of the already-limited global top 20. The domain quick filter swaps
 * which section is visible instead of hiding individual rows, so a domain
 * whose risers don't crack the global top 20 (e.g. one growing more slowly
 * than the domains dominating "Hottest overall") still shows its own
 * leaders rather than an empty list. `domains` is `[{ slug, name,
 * shortName }]`; `leaderboardsByWindow` is `{ [windowDays]: { global:
 * entries[], [slug]: entries[] } }` — the shape `generate.mjs` builds from
 * `leaderboard.mjs`'s `computeLeaderboard`.
 */
export function renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage, siteUrl = "", basePath = "", generatedAt = new Date() }) {
  const globalSection = renderRisingSection({
    id: "global",
    heading: "Hottest overall",
    leaderboardsByWindow,
    scopeKey: "global",
    showDomain: true,
    basePath,
  });

  const domainSections = domains
    .map((domain) =>
      renderRisingSection({
        id: domain.slug,
        heading: `Hottest in ${domain.shortName ?? domain.name}`,
        leaderboardsByWindow,
        scopeKey: domain.slug,
        showDomain: false,
        basePath,
        hidden: true,
      })
    )
    .join("");

  const windowBar = `
    <div class="rising-window-bar">
      ${RISING_WINDOWS_DAYS.map(
        (windowDays, index) =>
          `<button type="button" class="treemap-window-button${index === 0 ? " treemap-window-button-active" : ""}" data-window="${windowDays}">${windowDays}d</button>`
      ).join("")}
    </div>`;

  // Swaps which leaderboard section is shown instead of scrolling a
  // filtered-out list — "All" (the default) shows "Hottest overall";
  // picking a domain shows that domain's own top 20 section instead.
  const domainFilterBar = `
    <div class="rising-domain-filter" role="group" aria-label="Filter by domain">
      <button type="button" class="rising-domain-button rising-domain-button-active" data-domain="all">All</button>
      ${domains
        .map(
          (domain) =>
            `<button type="button" class="rising-domain-button" data-domain="${escapeHtml(domain.slug)}">${escapeHtml(domain.shortName ?? domain.name)}</button>`
        )
        .join("")}
    </div>`;

  const body = `
    ${renderSiteHeader(basePath)}
    ${renderCompareCartBootstrap(basePath)}
    <header class="rising-hero">
      <h1>Rising stars</h1>
      <p class="rising-hero-tagline">Star-growth leaders across every awesomemap domain.</p>
      <p class="rising-updated">Updated ${escapeHtml(generatedAt.toISOString().slice(0, 10))}</p>
    </header>
    ${domainFilterBar}
    ${windowBar}
    <div class="rising-page">
      ${globalSection}
      ${domainSections}
    </div>
    <script>
      document.querySelectorAll(".rising-window-bar button").forEach((button) => {
        button.addEventListener("click", () => {
          const selected = button.dataset.window;
          document.querySelectorAll(".rising-window-bar button").forEach((b) => {
            b.classList.toggle("treemap-window-button-active", b === button);
          });
          document.querySelectorAll(".rising-rows").forEach((el) => {
            el.hidden = el.dataset.window !== selected;
          });
        });
      });
      function applyDomainFilter(selected) {
        document.querySelectorAll(".rising-domain-filter button").forEach((b) => {
          b.classList.toggle("rising-domain-button-active", b.dataset.domain === selected);
        });
        const targetSectionId = selected === "all" ? "global" : selected;
        document.querySelectorAll(".rising-section").forEach((section) => {
          section.hidden = section.id !== targetSectionId;
        });
      }
      document.querySelectorAll(".rising-domain-filter button").forEach((button) => {
        button.addEventListener("click", () => applyDomainFilter(button.dataset.domain));
      });
      // Arriving via a domain quick-filter link (e.g. #artificial-intelligence,
      // as used by the landing page's quicklinks and each domain page's Rising
      // teaser) pre-applies that domain's filter instead of just scrolling.
      const initialDomain = decodeURIComponent(location.hash.slice(1));
      if (document.querySelector(\`.rising-domain-filter button[data-domain="\${initialDomain}"]\`)) {
        applyDomainFilter(initialDomain);
      }
    </script>
    ${renderSiteFooter(basePath)}
  `;

  return renderShell({
    title: "Rising — awesomemap",
    ogTitle: "Rising — awesomemap",
    ogDescription: "Star-growth leaders across every awesomemap domain, updated daily.",
    ogImage: defaultOgImage,
    ogUrl: `${siteUrl}${basePath}/rising/`,
    base: basePath,
    body,
  });
}

/** Formats a plain (non-delta) star count with thousands separators, e.g. `12,400`. */
function formatStars(stars) {
  return Number(stars).toLocaleString("en-US");
}

/** Formats a plain repo count (forks, open issues) with thousands separators, or `"—"` when it isn't a finite number (no history snapshot captured it yet) — server-side counterpart to compare-format.js's client-side formatCount. */
function formatCount(n) {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

/** One row in the global "Top tags" list — star-ranked, no growth window involved. */
function renderTopTagRow(entry, { basePath }) {
  const count = `${entry.projectCount} project${entry.projectCount === 1 ? "" : "s"}`;
  return `
    <li class="momentum-row">
      <span class="momentum-row-rank">${entry.rank}</span>
      <a class="momentum-row-name" href="${basePath}/tags/${tagSlug(entry.tag)}/" title="${escapeHtml(entry.tag)}">${escapeHtml(entry.tag)}</a>
      <span class="momentum-row-coverage">${count}</span>
      <span class="momentum-abs">★ ${formatStars(entry.totalStars)}</span>
    </li>`;
}

function renderTopTagsList(topTags, { basePath, limit }) {
  if (topTags.length === 0) return `<p class="rising-empty">No tags yet.</p>`;
  return `<ol class="momentum-rows-list">${topTags
    .slice(0, limit)
    .map((entry) => renderTopTagRow(entry, { basePath }))
    .join("")}</ol>`;
}

/** One row in a "Rising tags" window's list — same shape as the domain widget's rows, always showing a growth badge (every entry here is, by construction, rising). */
function renderRisingTagRow(entry, { basePath, windowDays }) {
  const count = `${entry.projectCount} project${entry.projectCount === 1 ? "" : "s"}`;
  return `
    <li class="momentum-row">
      <span class="momentum-row-rank">${entry.rank}</span>
      <a class="momentum-row-name" href="${basePath}/tags/${tagSlug(entry.tag)}/" title="${escapeHtml(entry.tag)}">${escapeHtml(entry.tag)}</a>
      <span class="momentum-row-coverage">${count}</span>
      ${renderMomentumStat(entry.growth, { windowDays })}
    </li>`;
}

/** Renders the three window variants for the "Rising tags" list, only the first shown initially — mirrors `renderRisingWindowVariants`' precomputed/client-toggled pattern. */
function renderRisingTagsWindowVariants(risingTagsByWindow, { basePath, limit }) {
  return RISING_WINDOWS_DAYS.map((windowDays, index) => {
    const entries = (risingTagsByWindow[windowDays] ?? []).slice(0, limit);
    const hiddenAttr = index === 0 ? "" : " hidden";
    const body =
      entries.length === 0
        ? `<p class="rising-empty">Not enough star-history yet for this window.</p>`
        : `<ol class="momentum-rows-list">${entries.map((entry) => renderRisingTagRow(entry, { basePath, windowDays })).join("")}</ol>`;
    return `<div class="rising-rows" data-window="${windowDays}"${hiddenAttr}>${body}</div>`;
  }).join("");
}

/**
 * Renders the global `/tags/` page: a "Top tags" list (star-ranked, no
 * window) and a "Rising tags" list with the same 7/30/90-day window toggle
 * `/rising/` uses (precomputed per window, swapped client-side — no
 * client-side recomputation). No per-domain filtering here — domain-scoped
 * tag rankings already live on each domain page's widget (see
 * `renderTagWidget`); a second filtering mechanism for the same data would
 * just duplicate it.
 */
export function renderTagsIndexPage(topTags, risingTagsByWindow, { defaultOgImage, siteUrl = "", basePath = "", generatedAt = new Date(), limit = 30 }) {
  const windowBar = `
    <div class="rising-window-bar">
      ${RISING_WINDOWS_DAYS.map(
        (windowDays, index) =>
          `<button type="button" class="treemap-window-button${index === 0 ? " treemap-window-button-active" : ""}" data-window="${windowDays}">${windowDays}d</button>`
      ).join("")}
    </div>`;

  const body = `
    ${renderSiteHeader(basePath)}
    ${renderCompareCartBootstrap(basePath)}
    <header class="rising-hero">
      <h1>Tags</h1>
      <p class="rising-hero-tagline">The technologies awesomemap's projects carry, across every domain.</p>
      <p class="rising-updated">Updated ${escapeHtml(generatedAt.toISOString().slice(0, 10))}</p>
    </header>
    <div class="rising-page">
      <section class="rising-section">
        <h2 class="rising-section-heading">Top tags</h2>
        ${renderTopTagsList(topTags, { basePath, limit })}
      </section>
      <section class="rising-section">
        <h2 class="rising-section-heading">Rising tags</h2>
        ${windowBar}
        ${renderRisingTagsWindowVariants(risingTagsByWindow, { basePath, limit })}
      </section>
    </div>
    <script>
      document.querySelectorAll(".rising-window-bar button").forEach((button) => {
        button.addEventListener("click", () => {
          const selected = button.dataset.window;
          document.querySelectorAll(".rising-window-bar button").forEach((b) => {
            b.classList.toggle("treemap-window-button-active", b === button);
          });
          document.querySelectorAll(".rising-rows").forEach((el) => {
            el.hidden = el.dataset.window !== selected;
          });
        });
      });
    </script>
    ${renderSiteFooter(basePath)}
  `;

  return renderShell({
    title: "Tags — awesomemap",
    ogTitle: "Tags — awesomemap",
    ogDescription: "Top and rising technology tags across every awesomemap domain.",
    ogImage: defaultOgImage,
    ogUrl: `${siteUrl}${basePath}/tags/`,
    base: basePath,
    body,
  });
}

/**
 * One row on a per-tag page's project list — same visual shape as a
 * rising-leaderboard row (rank, icon, name, domain badge), with a plain
 * star count in the trailing slot instead of a growth delta, since a tag
 * page ranks by absolute popularity, not by a growth window.
 */
function renderTagProjectRow(project, rank) {
  const icon = project.image ? `<img class="rising-row-icon" src="${escapeHtml(project.image)}" alt="" loading="lazy" />` : "";
  const domainBadge = project.domainShort
    ? `<span class="rising-row-domain" title="${escapeHtml(project.domainName ?? project.domainShort)}">${escapeHtml(project.domainShort)}</span>`
    : "";
  const stars = typeof project.weight === "number" ? `★ ${formatStars(project.weight)}` : "";
  const compareToggle = project.id
    ? `<button type="button" class="rising-row-compare compare-toggle" data-compare-id="${escapeHtml(project.id)}" aria-pressed="false">+ Compare</button>`
    : "";
  return `
    <li class="rising-row">
      <span class="rising-row-rank">${rank}</span>
      ${icon}
      <span class="rising-row-title">
        <a class="rising-row-name" href="${escapeHtml(project.link ?? "#")}">${escapeHtml(project.name ?? project.id)}</a>
      </span>
      ${domainBadge}
      <span class="rising-row-delta">${stars}</span>
      ${compareToggle}
    </li>`;
}

/**
 * Renders one tag's page: header stats (project count, combined stars,
 * default-window growth) then every carrying project, in the order the
 * caller passes them (sorted by stars descending — `generate.mjs`'s job,
 * not this function's), each with a domain badge since one tag can span
 * several domains. Gets the same SEO treatment (`ItemList` JSON-LD,
 * canonical) as a domain page — the ~600 pages like this one are a
 * genuine long-tail search surface. `growth` is a `computeGroupGrowth`
 * result for the page's default window (may report
 * `hasEnoughHistory: false`, rendered the same way `renderMomentumStat`
 * already handles that everywhere else).
 */
export function renderTagPage(tag, projects, growth, { defaultOgImage, siteUrl = "", basePath = "", windowDays = RISING_WINDOWS_DAYS[0] }) {
  const ogUrl = `${siteUrl}${basePath}/tags/${tagSlug(tag)}/`;
  const itemListJsonLd = renderJsonLd(buildItemListJsonLd(tag, projects, { url: ogUrl }));
  const rows = projects.map((project, index) => renderTagProjectRow(project, index + 1)).join("");
  const totalStars = projects.reduce((sum, project) => sum + (typeof project.weight === "number" ? project.weight : 0), 0);
  const projectWord = `project${projects.length === 1 ? "" : "s"}`;

  const body = `
    ${renderSiteHeader(basePath)}
    ${renderCompareCartBootstrap(basePath)}
    ${itemListJsonLd}
    <header class="rising-hero">
      <h1>${escapeHtml(tag)}</h1>
      <p class="rising-hero-tagline">${projects.length} ${projectWord} tagged <strong>${escapeHtml(tag)}</strong> · ★ ${formatStars(totalStars)} combined</p>
      ${renderMomentumStat(growth, { windowDays })}
    </header>
    <div class="rising-page">
      <section class="rising-section">
        <ol class="rising-rows-list">${rows}</ol>
      </section>
    </div>
    ${renderSiteFooter(basePath)}
  `;

  return renderShell({
    title: `${tag} — awesomemap`,
    ogTitle: `${tag} — awesomemap`,
    ogDescription: `${projects.length} open-source ${projectWord} tagged ${tag} on awesomemap.`,
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}

/**
 * Merges a project's parallel `growth`/`hasEnoughHistory` objects (as built
 * by `computeProjectSizing` in velocity.mjs, kept separate for the
 * treemap's own sizing use) into the single `{ ...growth, hasEnoughHistory
 * }` shape `renderMomentumStat` expects — the same shape a
 * `computeGroupGrowth` result already carries inline.
 */
function projectGrowthStat(project, windowDays) {
  const key = `rising${windowDays}`;
  return { ...project.growth?.[key], hasEnoughHistory: project.hasEnoughHistory?.[key] === true };
}

/**
 * Renders a project page's breadcrumb: Home, its canonical domain, then
 * every level of its category path (e.g. two segments for the
 * artificial-intelligence domain's nested categories) — a display-only
 * walk of `project.path`. The signal's category-relative comparison (built
 * in generate.mjs) is always pinned to `path[0]` regardless of how many
 * levels render here.
 */
function renderProjectBreadcrumb(project, domain, basePath) {
  const crumbs = [
    `<a href="${basePath}/">Home</a>`,
    `<a href="${basePath}/${escapeHtml(domain.slug)}/">${escapeHtml(domain.shortName ?? domain.name)}</a>`,
    ...(project.path ?? []).map((segment) => `<span>${escapeHtml(segment)}</span>`),
  ];
  return `<nav class="project-breadcrumb" aria-label="Breadcrumb">${crumbs.join('<span aria-hidden="true"> › </span>')}</nav>`;
}

/**
 * Server-rendered star-history chart for a project page — the full-size,
 * axis-labeled sibling of the detail panel's compact chart (both share
 * app/shared/star-history.js's `buildStarChart` geometry; a static page
 * has no client fetch to lazily draw a chart from, so this one is built
 * at generate time). `historySeries` is `starHistoryFor`'s output
 * (oldest-first `{date, stars}[]`). `eventsSeries` (same convention as
 * `renderProjectEventsTimeline`'s own parameter) is overlaid as clickable
 * annotation markers along the chart's baseline via `positionAnnotations`
 * — the "why did this grow, and when" pairing with that function's full
 * chronological list below the chart; an event outside the chart's own
 * date range is simply omitted from the chart (still in that list,
 * unaffected). Renders nothing when there are fewer than 2 history
 * points, matching `buildStarChart`'s own "nothing to draw" convention.
 */
function renderProjectStarChart(historySeries, eventsSeries) {
  const chart = buildStarChart(historySeries, {
    width: FULL_CHART_WIDTH,
    height: FULL_CHART_HEIGHT,
    padding: FULL_CHART_PADDING,
    showAxes: true,
  });
  if (!chart) return "";
  const caption = starHistoryCaption(historySeries);

  const gridLines = chart.yAxisTicks
    .map(
      (tick) =>
        `<line class="star-chart-gridline" x1="${FULL_CHART_PADDING.left}" x2="${chart.width - FULL_CHART_PADDING.right}" y1="${tick.y}" y2="${tick.y}" />`
    )
    .join("");
  const yLabels = chart.yAxisTicks
    .map(
      (tick) =>
        `<text class="star-chart-axis-label" x="${FULL_CHART_PADDING.left - 6}" y="${tick.y}" text-anchor="end" dominant-baseline="middle">${escapeHtml(tick.label)}</text>`
    )
    .join("");
  const xLabels = chart.xAxisTicks
    .map((tick) => `<text class="star-chart-axis-label" x="${tick.x}" y="${tick.y}" text-anchor="middle">${escapeHtml(tick.label)}</text>`)
    .join("");
  const points = chart.points
    .map(
      (p) =>
        `<circle class="star-chart-point" cx="${p.x}" cy="${p.y}" r="3"><title>${escapeHtml(formatEventDate(p.date))}: ${escapeHtml(formatStars(p.stars))} stars</title></circle>`
    )
    .join("");
  const annotations = positionAnnotations(eventsSeries, chart)
    .map(({ x, y, event }) => {
      const label = EVENT_TYPE_LABELS[event.type] ?? event.type;
      return `
      <a class="star-chart-annotation" href="${escapeHtml(event.url)}" target="_blank" rel="noopener" transform="translate(${x}, ${y})">
        <title>${escapeHtml(label)}: ${escapeHtml(event.title)} (${escapeHtml(formatEventDate(event.date))})</title>
        <path d="M-5,10 L5,10 L0,1 Z" />
      </a>`;
    })
    .join("");

  return `
    <div class="project-star-chart">
      <svg class="star-chart-svg" viewBox="0 0 ${chart.width} ${chart.height}" width="${chart.width}" height="${chart.height}">
        ${gridLines}
        <path class="star-chart-area" d="${chart.areaPath}" />
        <path class="star-chart-line" d="${chart.path}" />
        ${points}
        ${yLabels}
        ${xLabels}
        ${annotations}
      </svg>
      <p class="detail-panel-star-chart-caption">${escapeHtml(caption)}</p>
    </div>`;
}

/**
 * Server-rendered tag chips for a project page — same visual/routing
 * convention as the detail panel's client-rendered chips
 * (app/shared/detail-panel.js's renderTagChips), reimplemented as an HTML
 * string since this runs at build time, not in the browser.
 */
function renderProjectTagChips(tags, basePath) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  const chips = tags
    .map((tag) => `<a class="detail-panel-tag" href="${basePath}/tags/${tagSlug(tag)}/">${escapeHtml(tag)}</a>`)
    .join("");
  return `<div class="detail-panel-tags">${chips}</div>`;
}

const EVENTS_TIMELINE_LIMIT = 20;
const EVENT_TYPE_LABELS = { hn: "HN", lobsters: "Lobsters", reddit: "Reddit", producthunt: "Product Hunt", bluesky: "Bluesky", blog: "Blog" };

// Emoji + noun phrase per event type for the rolled-up summary line above
// the timeline — one group per type actually present, e.g. "💬 3 Hacker
// News discussions". Keyed in the display order the summary renders
// mapped types in; an unmapped type (see EVENT_TYPE_LABELS' own fallback)
// falls back to a generic 🔗 "mention" phrase built from its raw type
// string, appended after every mapped type.
const EVENT_SUMMARY_PHRASES = {
  hn: { emoji: "💬", singular: "Hacker News discussion", plural: "Hacker News discussions" },
  lobsters: { emoji: "🦞", singular: "Lobsters discussion", plural: "Lobsters discussions" },
  reddit: { emoji: "👽", singular: "Reddit discussion", plural: "Reddit discussions" },
  producthunt: { emoji: "📣", singular: "Product Hunt launch", plural: "Product Hunt launches" },
  bluesky: { emoji: "🦋", singular: "Bluesky mention", plural: "Bluesky mentions" },
  blog: { emoji: "📰", singular: "publication", plural: "publications" },
};

/**
 * Rolls `eventsSeries` up into one summary line — "how much coverage did
 * this project get, and where" — grouped by `event.type` and rendered in
 * `EVENT_SUMMARY_PHRASES`' fixed key order (so the line reads the same
 * regardless of chronological mix), with any unmapped type appended after
 * in first-seen order. Counts the *full* series, not
 * `renderProjectEventsTimeline`'s `EVENTS_TIMELINE_LIMIT`-capped rendered
 * slice, since this answers "total coverage," not "what's listed below."
 * Returns "" for an empty series, same convention as the timeline itself.
 */
function renderProjectEventsSummary(eventsSeries) {
  if (!Array.isArray(eventsSeries) || eventsSeries.length === 0) return "";
  const counts = new Map();
  for (const event of eventsSeries) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }
  const mappedTypes = Object.keys(EVENT_SUMMARY_PHRASES).filter((type) => counts.has(type));
  const unmappedTypes = [...counts.keys()].filter((type) => !Object.hasOwn(EVENT_SUMMARY_PHRASES, type));
  const groups = [...mappedTypes, ...unmappedTypes].map((type) => {
    const count = counts.get(type);
    const phrase = Object.hasOwn(EVENT_SUMMARY_PHRASES, type)
      ? EVENT_SUMMARY_PHRASES[type]
      : { emoji: "🔗", singular: `${type} mention`, plural: `${type} mentions` };
    const label = count === 1 ? phrase.singular : phrase.plural;
    return `${phrase.emoji} ${formatCount(count)} ${escapeHtml(label)}`;
  });
  return `<p class="project-events-summary">${groups.join(" · ")}</p>`;
}

/**
 * Server-rendered chronological timeline of external events (HN, Lobsters,
 * Reddit, Product Hunt, Bluesky, blog/launch posts) for a project page — the "why did
 * this grow" companion to the star-history sparkline above it. `eventsSeries`
 * is `project-events.mjs`'s `sortedEvents` output (oldest-first, mirroring
 * `historySeries`'s convention); rendered newest-first here, like a
 * changelog, and capped to the most recent `EVENTS_TIMELINE_LIMIT` — only
 * the rendered slice is capped, `events` itself is never pruned (see
 * scripts/snapshot-events.mjs). Renders nothing for a project with no
 * recorded events yet, same "nothing to show" convention as
 * `renderProjectStarChart`. GitHub releases were dropped after a first
 * production run (routine version bumps outweighed the signal) — `snapshot-events.mjs`
 * now produces five event types, and the label lookup stays a map rather than
 * a hardcoded string precisely because a new source can add a sixth without
 * structural changes; the fallback (`EVENT_TYPE_LABELS[event.type] ?? event.type`)
 * means an unmapped type still renders acceptably until the map is updated.
 * Above the list, `renderProjectEventsSummary` rolls the same `eventsSeries`
 * up into a one-line "how much coverage, and where" count per type — a
 * reader can get the gist without scanning the whole list.
 */
function renderProjectEventsTimeline(eventsSeries) {
  if (!Array.isArray(eventsSeries) || eventsSeries.length === 0) return "";
  const rows = [...eventsSeries]
    .reverse()
    .slice(0, EVENTS_TIMELINE_LIMIT)
    .map((event) => {
      const label = EVENT_TYPE_LABELS[event.type] ?? event.type;
      const points =
        typeof event.points === "number"
          ? `<span class="project-event-points">${formatCount(event.points)} pts</span>`
          : "";
      return `
      <li class="project-event">
        <span class="project-event-type project-event-type-${escapeHtml(event.type)}">${escapeHtml(label)}</span>
        <a class="project-event-title" href="${escapeHtml(event.url)}" target="_blank" rel="noopener">${escapeHtml(event.title)}</a>
        <span class="project-event-date">${escapeHtml(formatEventDate(event.date))}</span>
        ${points}
      </li>`;
    })
    .join("");
  return `
    <div class="project-events">
      <h2 class="project-events-heading">Timeline</h2>
      ${renderProjectEventsSummary(eventsSeries)}
      <ul class="project-events-list">${rows}</ul>
    </div>`;
}

/**
 * Renders one project's canonical page — the shareable, indexable home for
 * a project that today only exists as ephemeral detail-panel state inside
 * one domain's treemap. `project` is a sized project record (see
 * velocity.mjs's `computeProjectSizing` — `growth`/`hasEnoughHistory` keyed
 * per rising window). `domain` is `{ slug, name, shortName }` — the
 * project's canonical domain (see generate.mjs's last-write-wins dedup).
 * `signal` is an `explainSignal` result (scripts/signal.mjs), already
 * computed by the caller. `historySeries` is `starHistoryFor`'s output for
 * this project.
 */
export function renderProjectPage(
  project,
  { domain, signal = {}, historySeries = [], eventsSeries = [], defaultOgImage, siteUrl = "", basePath = "" }
) {
  const ogUrl = `${siteUrl}${basePath}/projects/${project.id}/`;
  const jsonLd = renderJsonLd(
    buildSoftwareSourceCodeJsonLd({
      name: project.name ?? project.id,
      description: project.desc ?? "",
      url: ogUrl,
      codeRepository: githubRepoUrl(project.id),
    })
  );

  const momentumChips = RISING_WINDOWS_DAYS.map(
    (windowDays) => `
      <div class="project-momentum-chip">
        <span class="project-momentum-chip-window">${windowDays}d</span>
        ${renderMomentumStat(projectGrowthStat(project, windowDays), { windowDays })}
      </div>`
  ).join("");

  // Forks/open-issue counts ride along on the latest history snapshot (see
  // snapshot-history.mjs's buildSnapshotEntry) — same source
  // compare-index.mjs's buildCompareRecord reads its own copy from, so a
  // project with no history yet (and therefore no `latestSnapshot`) simply
  // omits these two repo-stat chips rather than showing "—" placeholders.
  const latestSnapshot = historySeries.length > 0 ? historySeries[historySeries.length - 1] : null;
  const githubUrl = githubRepoUrl(project.id);
  const repoStats = [
    { label: "Stars", value: formatStars(project.weight ?? 0), href: githubUrl },
    typeof latestSnapshot?.forks === "number"
      ? { label: "Forks", value: formatCount(latestSnapshot.forks), href: `${githubUrl}/network/members` }
      : null,
    typeof latestSnapshot?.openIssues === "number"
      ? { label: "Open issues", value: formatCount(latestSnapshot.openIssues), href: `${githubUrl}/issues` }
      : null,
  ].filter(Boolean);
  const repoStatChips = repoStats
    .map(
      (stat) => `
      <a class="project-repo-stat" href="${escapeHtml(stat.href)}" target="_blank" rel="noopener">
        <span class="project-repo-stat-value">${stat.value}</span>
        <span class="project-repo-stat-label">${stat.label}</span>
      </a>`
    )
    .join("");

  const body = `
    ${renderSiteHeader(basePath)}
    ${renderCompareCartBootstrap(basePath)}
    ${jsonLd}
    <header class="project-hero">
      ${renderProjectBreadcrumb(project, domain, basePath)}
      ${project.image ? `<img class="detail-panel-logo" src="${escapeHtml(project.image)}" alt="" loading="lazy" />` : ""}
      <h1>${escapeHtml(project.name ?? project.id)}</h1>
      ${project.desc ? `<p class="project-hero-desc">${escapeHtml(project.desc)}</p>` : ""}
      ${signal.headline ? `<p class="project-signal">${escapeHtml(signal.headline)}</p>` : ""}
    </header>
    <div class="project-body">
      <div class="project-momentum-grid">${momentumChips}</div>
      ${renderProjectStarChart(historySeries, eventsSeries)}
      <div class="project-repo-stats">${repoStatChips}</div>
      ${renderProjectEventsTimeline(eventsSeries)}
      <div class="project-links">
        <a class="detail-panel-link" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener">View on GitHub ↗</a>
        ${project.link ? `<a class="detail-panel-link" href="${escapeHtml(project.link)}" target="_blank" rel="noopener">Visit site ↗</a>` : ""}
        <button type="button" class="detail-panel-link compare-toggle" data-compare-id="${escapeHtml(project.id)}" aria-pressed="false">+ Compare</button>
      </div>
      ${renderProjectTagChips(project.tags, basePath)}
    </div>
    ${renderSiteFooter(basePath)}
  `;

  return renderShell({
    title: `${project.name ?? project.id} — awesomemap`,
    ogTitle: project.name ?? project.id,
    ogDescription: project.desc ?? "",
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}

/**
 * Renders the /compare/ page's static shell. Unlike every other page here,
 * this shell carries no project data of its own — which projects are being
 * compared is only known once the browser parses the URL's `id=` params, so
 * the actual table is built entirely client-side by compare.js against
 * dist/compare-index.json (see generate.mjs). Generic OG copy, since a
 * static build can't know the query string in advance.
 */
export function renderComparePage({ defaultOgImage, siteUrl = "", basePath = "" } = {}) {
  const ogUrl = `${siteUrl}${basePath}/compare/`;
  const compareIndexUrl = `${basePath}/compare-index.json`;
  const body = `
    ${renderSiteHeader(basePath)}
    ${renderCompareCartBootstrap(basePath)}
    <header class="rising-hero">
      <h1>Compare projects</h1>
      <p class="rising-hero-tagline">See stars, growth, and momentum for up to four open-source projects side by side.</p>
    </header>
    <div id="app" class="compare-app"></div>
    <script type="module">
      import { mountCompare } from "${basePath}/shared/compare.js";
      import { parseCompareIds, formatCompareIds } from "${basePath}/shared/compare-url.js";
      function stateUrl(ids) {
        return location.pathname + formatCompareIds(ids);
      }
      const initialIds = parseCompareIds(new URLSearchParams(location.search));
      // Gives the very first back-press a defined entry to return to,
      // mirroring the same pattern renderDomainPage's inline script uses
      // for zoom state.
      history.replaceState(initialIds, "", stateUrl(initialIds));
      const compare = mountCompare(document.getElementById("app"), {
        compareIndexUrl: "${compareIndexUrl}",
        basePath: "${basePath}",
        initialIds,
        onIdsChange: (ids) => {
          history.pushState(ids, "", stateUrl(ids));
        },
      });
      window.addEventListener("popstate", (event) => {
        const ids = event.state ?? parseCompareIds(new URLSearchParams(location.search));
        compare.applyIds(ids);
      });
    </script>
    ${renderSiteFooter(basePath)}
  `;
  return renderShell({
    title: "Compare projects — awesomemap",
    ogTitle: "Compare projects — awesomemap",
    ogDescription: "Compare stars, growth, and momentum across up to four open-source projects side by side.",
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}

/**
 * Renders the /search/ page's static shell. Like /compare/, this shell
 * carries no project data of its own — the actual filtering happens
 * client-side (search.js) against dist/compare-index.json, the same
 * cross-domain index /compare/ already ships, reused here rather than
 * building a second one. Generic OG copy, since a static build can't know
 * the query string in advance.
 */
export function renderSearchPage({ defaultOgImage, siteUrl = "", basePath = "" } = {}) {
  const ogUrl = `${siteUrl}${basePath}/search/`;
  const searchIndexUrl = `${basePath}/compare-index.json`;
  const body = `
    ${renderSiteHeader(basePath)}
    ${renderCompareCartBootstrap(basePath)}
    <header class="rising-hero">
      <h1>Search projects</h1>
      <p class="rising-hero-tagline">Find any project across every awesomemap domain by name, tag, or description.</p>
    </header>
    <div id="app" class="search-app"></div>
    <script type="module">
      import { mountSearch } from "${basePath}/shared/search.js";
      const params = new URLSearchParams(location.search);
      const initialQuery = params.get("q") ?? "";
      mountSearch(document.getElementById("app"), {
        searchIndexUrl: "${searchIndexUrl}",
        basePath: "${basePath}",
        initialQuery,
        onQueryChange: (query) => {
          const url = location.pathname + (query ? "?q=" + encodeURIComponent(query) : "");
          history.replaceState(null, "", url);
        },
      });
    </script>
    ${renderSiteFooter(basePath)}
  `;
  return renderShell({
    title: "Search projects — awesomemap",
    ogTitle: "Search projects — awesomemap",
    ogDescription: "Search every open-source project tracked across awesomemap's domains by name, tag, or description.",
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}

/**
 * Renders the /submit/ page: a "suggest a project" form for a visitor who
 * isn't comfortable opening a PR. There's no write-capable backend on this
 * static site, so the form itself does no network call — on submit it
 * builds a prefilled GitHub "new issue" URL (submit-project.js) and opens
 * it in a new tab, handing the actual write off to GitHub. From there
 * `scripts/process-submission.mjs` auto-processes the opened issue within
 * minutes, no maintainer step (see CONTRIBUTING.md).
 */
export function renderSubmitPage({ domains = [], defaultOgImage, siteUrl = "", basePath = "" } = {}) {
  const ogUrl = `${siteUrl}${basePath}/submit/`;
  const domainOptions = domains.map((d) => `<option value="${escapeHtml(d.shortName ?? d.name ?? d.slug)}">${escapeHtml(d.shortName ?? d.name ?? d.slug)}</option>`).join("");
  const body = `
    ${renderSiteHeader(basePath)}
    <header class="rising-hero">
      <h1>Suggest a project</h1>
      <p class="rising-hero-tagline">Know a project that belongs on one of the maps? Point us at it — no PR, no hunting for the right GitHub issue template.</p>
    </header>
    <form id="submit-form" class="submit-form">
      <label for="submit-project-url">GitHub repo URL</label>
      <input id="submit-project-url" type="text" placeholder="https://github.com/owner/repo" autocomplete="off" required />

      <label for="submit-target-map">Which map should it go in?</label>
      <select id="submit-target-map">
        <option value="Not sure">Not sure</option>
        ${domainOptions}
      </select>

      <label for="submit-why">Why it fits (optional)</label>
      <textarea id="submit-why" rows="3" placeholder="What does it do, and why does it belong here?"></textarea>

      <button type="submit">Submit on GitHub</button>
      <p id="submit-error" class="submit-form-error" role="alert" hidden></p>
      <p class="submit-form-note">Opens a prefilled GitHub issue in a new tab, reviewed automatically within a few minutes — no maintainer step. Already comfortable editing JSON? <a href="${REPO_URL}/blob/master/CONTRIBUTING.md">A PR is faster.</a></p>
    </form>
    <script type="module">
      import { normalizeProjectId, isValidProjectInput, buildSubmissionIssueUrl } from "${basePath}/shared/submit-project.js";
      const form = document.getElementById("submit-form");
      const errorEl = document.getElementById("submit-error");
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        errorEl.hidden = true;
        const raw = document.getElementById("submit-project-url").value;
        if (!isValidProjectInput(raw)) {
          errorEl.textContent = "Enter a GitHub repo URL, e.g. https://github.com/owner/repo.";
          errorEl.hidden = false;
          return;
        }
        const projectId = normalizeProjectId(raw);
        const targetMap = document.getElementById("submit-target-map").value;
        const why = document.getElementById("submit-why").value;
        const url = buildSubmissionIssueUrl({ repoUrl: "${REPO_URL}", projectId, targetMap, why });
        window.open(url, "_blank", "noopener");
      });
    </script>
    ${renderSiteFooter(basePath)}
  `;
  return renderShell({
    title: "Suggest a project — awesomemap",
    ogTitle: "Suggest a project — awesomemap",
    ogDescription: "Nominate an open-source project for one of awesomemap's maps.",
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}

/**
 * Renders the /contact/ page: a way to reach the maintainer that isn't
 * "open a GitHub issue" (that's what /submit/ and "Report an issue" are
 * for). Same "no write-capable backend" constraint as /submit/, so instead
 * of a network call, submitting the form builds a prefilled `mailto:`
 * URL (contact-form.js) and navigates the current tab to it — handing the
 * actual delivery off to whatever mail client the visitor's OS opens.
 */
export function renderContactPage({ defaultOgImage, siteUrl = "", basePath = "" } = {}) {
  const ogUrl = `${siteUrl}${basePath}/contact/`;
  const body = `
    ${renderSiteHeader(basePath)}
    <header class="rising-hero">
      <h1>Contact us</h1>
      <p class="rising-hero-tagline">Question, feedback, or something that doesn't fit a GitHub issue? Send us a note.</p>
    </header>
    <form id="contact-form" class="contact-form">
      <label for="contact-name">Name (optional)</label>
      <input id="contact-name" type="text" autocomplete="name" />

      <label for="contact-email">Your email</label>
      <input id="contact-email" type="email" autocomplete="email" required />

      <label for="contact-message">Message</label>
      <textarea id="contact-message" rows="5" required></textarea>

      <button type="submit">Send</button>
      <p id="contact-error" class="contact-form-error" role="alert" hidden></p>
      <p class="contact-form-note">Opens your email app with a message addressed to awesome@awesomemap.dev, ready to send.</p>
    </form>
    <script type="module">
      import { isValidContactInput, buildContactMailtoUrl } from "${basePath}/shared/contact-form.js";
      const form = document.getElementById("contact-form");
      const errorEl = document.getElementById("contact-error");
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        errorEl.hidden = true;
        const name = document.getElementById("contact-name").value;
        const email = document.getElementById("contact-email").value;
        const message = document.getElementById("contact-message").value;
        if (!isValidContactInput({ name, email, message })) {
          errorEl.textContent = "Enter a valid email address and a message.";
          errorEl.hidden = false;
          return;
        }
        window.location.href = buildContactMailtoUrl({ name, email, message });
      });
    </script>
    ${renderSiteFooter(basePath)}
  `;
  return renderShell({
    title: "Contact us — awesomemap",
    ogTitle: "Contact us — awesomemap",
    ogDescription: "Get in touch with the awesomemap team.",
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}

/**
 * Renders the /methodology/ page: a plain-language explanation of every
 * ranking formula used elsewhere on the site, linked from the site footer
 * (see `renderSiteFooter`) so it's reachable from any page — the point is
 * transparency, not a new computation. The three numeric constants quoted
 * below (the smoothing constant, the small-project star threshold, the
 * minimum meaningful star delta) are imported from the same modules that
 * actually compute the rankings, so at least those can't silently drift
 * from a hand-typed copy the way a re-typed number could — the prose
 * describing each formula's *shape* is still hand-written, and a change to
 * the underlying math in velocity.mjs/group-growth.mjs/signal.mjs won't be
 * caught here automatically.
 */
export function renderMethodologyPage({ defaultOgImage, siteUrl = "", basePath = "" } = {}) {
  const ogUrl = `${siteUrl}${basePath}/methodology/`;
  const windowsList = RISING_WINDOWS_DAYS.join(" / ");
  const smallProjectThreshold = formatStars(SMALL_PROJECT_STAR_THRESHOLD);
  const minStarDelta = MIN_MEANINGFUL_STAR_DELTA;
  const smoothingConstant = formatStars(SCORE_SMOOTHING_CONSTANT);

  const body = `
    ${renderSiteHeader(basePath)}
    <header class="rising-hero">
      <h1>How we rank</h1>
      <p class="rising-hero-tagline">Every number on awesomemap comes straight from daily GitHub star snapshots, run through the same formulas for every project — no manual curation of order. Here's exactly what each one measures.</p>
      <p class="rising-updated">Star-history snapshots taken daily · growth windows: ${windowsList} days</p>
    </header>
    <div class="rising-page">
      <section class="rising-section">
        <h2 class="rising-section-heading">Growth</h2>
        <p>The percent (and absolute) change in stars over a chosen window — ${windowsList} days. It's measured from the snapshot closest to that many days ago to the latest snapshot, so one missed snapshot day doesn't break the number. This is what every growth badge across the site — a domain card, a category row, a tag, a project — is showing.</p>
      </section>
      <section class="rising-section">
        <h2 class="rising-section-heading">Rising score</h2>
        <p><strong>Popular</strong> mode sizes each project by its raw star count — the established players. <strong>Rising</strong> mode sizes and ranks projects by a velocity score instead: star gain ÷ √(current stars + ${smoothingConstant}). The square-root term keeps a tiny project's noisy swing (say, 2 stars → 6) from outranking a large project's genuinely bigger gain — without it, a small denominator would let noise dominate. The <a href="${basePath}/rising/">Rising leaderboard</a> ranks by this same score.</p>
      </section>
      <section class="rising-section">
        <h2 class="rising-section-heading">Category growth</h2>
        <p>Shown as "Where the heat is" on each domain page: the aggregate growth of every tracked project in a category, computed as one summed star delta over one summed baseline — not an average of each project's percentage. Averaging would let a single small project that tripled outweigh fifty established ones and report a category as exploding when it barely moved. Only projects with enough history for the window count toward the figure; coverage (e.g. "12/15 tracked") is shown alongside it.</p>
      </section>
      <section class="rising-section">
        <h2 class="rising-section-heading">This week's signals</h2>
        <p>Four highlights on the homepage, drawn only from projects that gained at least ${minStarDelta} stars this week — below that, a gain is ordinary week-to-week noise, not a signal:</p>
        <ul>
          <li><strong>🔥 Biggest mover</strong> — the largest absolute star gain.</li>
          <li><strong>🚀 Unexpected breakout</strong> — growing fastest relative to its own category's growth this week, i.e. outperforming its neighbors, not just growing in absolute terms.</li>
          <li><strong>📈 Heating up</strong> — the highest percentage growth in the pool.</li>
          <li><strong>👀 One to watch</strong> — the highest percentage growth among projects still under ${smallProjectThreshold} stars — the ones worth catching early.</li>
        </ul>
      </section>
      <section class="rising-section">
        <h2 class="rising-section-heading">Data updated daily</h2>
        <p>Every tracked project's star count is snapshotted once a day. A window needs a snapshot at least that old to report growth — until then, a project shows "Not tracked yet" rather than a fabricated 0%.</p>
      </section>
    </div>
    ${renderSiteFooter(basePath)}
  `;
  return renderShell({
    title: "How we rank — awesomemap",
    ogTitle: "How we rank — awesomemap",
    ogDescription: "How awesomemap ranks projects: growth, the Rising score, category growth, and this week's signals, explained.",
    ogImage: defaultOgImage,
    ogUrl,
    base: basePath,
    body,
  });
}
