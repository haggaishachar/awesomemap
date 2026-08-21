import { readFileSync } from "node:fs";
import { RISING_WINDOWS_DAYS } from "./velocity.mjs";
import { buildWebsiteJsonLd, buildItemListJsonLd } from "./seo.mjs";

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

/** Site-wide nav bar: brand links home, right side links out to the GitHub repo. Omitted from embeds. */
function renderSiteHeader(basePath) {
  return `
    <header class="site-header">
      <a class="site-header-brand" href="${basePath}/">awesomemap</a>
      <div class="site-header-links">
        <a class="site-header-rising" href="${basePath}/rising/">Rising</a>
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
export function renderDomainPage(domain, tree, { embed = false, defaultOgImage, siteUrl = "", basePath = "", teaser = [] }) {
  const header = embed ? "" : renderSiteHeader(basePath);
  const footer = embed ? "" : renderSiteFooter();
  const teaserSection = embed
    ? ""
    : renderRisingTeaser(teaser, { heading: "Rising this week", href: `${basePath}/rising/#${domain.slug}`, showDomain: false });
  const ogUrl = `${siteUrl}${basePath}/${domain.slug}/`;
  // Omitted from the embed variant along with the header/footer/teaser —
  // it's structured data for search engines, and embed pages are already
  // excluded from the sitemap as duplicate content (see seo.mjs).
  const itemListJsonLd = embed
    ? ""
    : renderJsonLd(buildItemListJsonLd(domain.name, domain.projects ?? [], { url: ogUrl }));
  // The domain's own `history.json` (copied from `data/history/<slug>.json`
  // by generate.mjs, when it exists) — fetched lazily by the detail panel
  // to draw its star-history sparkline. Always emitted, even for domains
  // with no history file yet; the panel's fetch fails gracefully (no
  // chart) rather than needing generate.mjs's fs state here.
  const historyUrl = `${basePath}/${domain.slug}/history.json`;
  const body = `
    ${header}
    ${itemListJsonLd}
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
    ${teaserSection}
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

/** Renders a compact nav strip of short domain names, each jumping straight to that domain's filtered Rising leaderboard — a fast path for visitors who already know where they're headed, complementing the fuller `.map-grid` cards below. `domains` is `[{ slug, name, shortName }]`. */
function renderDomainQuicklinks(domains, basePath) {
  const links = domains
    .map(
      (domain) => `
        <a class="domain-quicklink" href="${basePath}/rising/#${escapeHtml(domain.slug)}" title="${escapeHtml(domain.name)}">${escapeHtml(domain.shortName ?? domain.name)}</a>`
    )
    .join("");
  return `<nav class="domain-quicklinks" aria-label="Jump to a domain">${links}</nav>`;
}

/** Renders the landing page listing every domain. `domains` is an array of { slug, name, shortName, description }. */
export function renderLandingPage(domains, { defaultOgImage, siteUrl = "", basePath = "", teaser = [] }) {
  const cards = domains
    .map(
      (domain) => `
        <a class="map-card" href="${basePath}/${escapeHtml(domain.slug)}/">
          <h3>${escapeHtml(domain.name)}</h3>
          <p>${escapeHtml(domain.description ?? "")}</p>
        </a>`
    )
    .join("");
  const teaserSection = renderRisingTeaser(teaser, { heading: "Rising this week", href: `${basePath}/rising/`, showDomain: true });
  const websiteJsonLd = renderJsonLd(
    buildWebsiteJsonLd({
      name: "awesomemap",
      description: "A community-curated map of open-source technology.",
      url: `${siteUrl}${basePath}/`,
    })
  );
  const body = `
    ${renderSiteHeader(basePath)}
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
        <p class="hero-tagline">Interactive maps of open-source ecosystems — see which projects are rising fast, not just which are already huge.</p>
        ${renderDomainQuicklinks(domains, basePath)}
      </div>
    </header>
    ${teaserSection}
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

/** Formats one leaderboard entry (as returned by leaderboard.mjs's computeLeaderboard) as a row. `showDomain` controls whether the cross-domain tag is shown — true for the global list, false for a single domain's own list. */
function renderRisingRow(entry, { showDomain }) {
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
  return `
    <li class="rising-row">
      <span class="rising-row-rank">${entry.rank}</span>
      ${icon}
      <span class="rising-row-title">
        <a class="rising-row-name" href="${escapeHtml(entry.link ?? "#")}">${escapeHtml(entry.name)}</a>
        ${repoId}
      </span>
      ${domainTag}
      <span class="rising-row-arrow ${arrowClass}">${arrowSymbol}${movedBy > 0 ? movedBy : ""}</span>
      <span class="rising-row-delta">${sign}${entry.starDelta} (${sign}${pct}%)</span>
    </li>`;
}

/** Renders a leaderboard's rows, or a not-ready placeholder when `entries` is empty (e.g. a domain too new for this window). Shared with the teaser sections added in Task 4. */
function renderRisingRows(entries, { showDomain }) {
  if (entries.length === 0) {
    return `<p class="rising-empty">Not enough star-history yet for this window.</p>`;
  }
  return `<ol class="rising-rows-list">${entries.map((entry) => renderRisingRow(entry, { showDomain })).join("")}</ol>`;
}

/**
 * Renders a short teaser (already-sliced entries, typically top 5, 7-day
 * window) linking to the full leaderboard — used on the landing page
 * (global) and each domain page (that domain's own list).
 */
function renderRisingTeaser(entries, { heading, href, showDomain }) {
  return `
    <section class="rising-teaser">
      <h2 class="rising-teaser-heading">${escapeHtml(heading)}</h2>
      ${renderRisingRows(entries, { showDomain })}
      <a class="rising-teaser-link" href="${escapeHtml(href)}">See full leaderboard →</a>
    </section>`;
}

/**
 * Renders one leaderboard section's three window variants (7/30/90 days),
 * only the first shown initially — the rest sit `hidden` until the page's
 * window-toggle script flips them, so switching windows never re-fetches
 * or recomputes anything client-side. `leaderboardsByWindow` is
 * `{ [windowDays]: { [scopeKey]: entries[] } }`; `scopeKey` selects which
 * leaderboard within each window this section shows.
 */
function renderRisingWindowVariants(leaderboardsByWindow, scopeKey, { showDomain }) {
  return RISING_WINDOWS_DAYS.map((windowDays, index) => {
    const entries = leaderboardsByWindow[windowDays]?.[scopeKey] ?? [];
    const hiddenAttr = index === 0 ? "" : " hidden";
    return `<div class="rising-rows" data-window="${windowDays}"${hiddenAttr}>${renderRisingRows(entries, { showDomain })}</div>`;
  }).join("");
}

/** One full leaderboard section (heading + all three window variants), anchorable by `id`. */
function renderRisingSection({ id, heading, headingHref, leaderboardsByWindow, scopeKey, showDomain }) {
  const headingHtml = headingHref ? `<a href="${escapeHtml(headingHref)}">${escapeHtml(heading)}</a>` : escapeHtml(heading);
  return `
    <section class="rising-section" id="${escapeHtml(id)}">
      <h2 class="rising-section-heading">${headingHtml}</h2>
      ${renderRisingWindowVariants(leaderboardsByWindow, scopeKey, { showDomain })}
    </section>`;
}

/**
 * Renders the dedicated Rising page: a global leaderboard plus one per
 * domain, sharing a single 7/30/90-day window toggle and a domain filter.
 * `domains` is `[{ slug, name, shortName }]`; `leaderboardsByWindow` is
 * `{ [windowDays]: { global: entries[], [slug]: entries[] } }` — the shape
 * `generate.mjs` builds from `leaderboard.mjs`'s `computeLeaderboard`.
 */
export function renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage, siteUrl = "", basePath = "", generatedAt = new Date() }) {
  const globalSection = renderRisingSection({
    id: "global",
    heading: "Hottest overall",
    leaderboardsByWindow,
    scopeKey: "global",
    showDomain: true,
  });

  const domainSections = domains
    .map((domain) =>
      renderRisingSection({
        id: domain.slug,
        heading: domain.name,
        headingHref: `${basePath}/${domain.slug}/`,
        leaderboardsByWindow,
        scopeKey: domain.slug,
        showDomain: false,
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

  // Lets a visitor jump straight to one domain's leaderboard instead of
  // scrolling past every other domain's section — "All" (the default)
  // shows every section including the cross-domain "Hottest overall" one;
  // picking a domain hides everything but that domain's own section.
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
        document.querySelectorAll(".rising-section").forEach((section) => {
          section.hidden = selected !== "all" && section.id !== selected;
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
    ${renderSiteFooter()}
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
