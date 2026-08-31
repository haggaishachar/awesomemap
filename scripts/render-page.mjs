import { readFileSync } from "node:fs";
import { RISING_WINDOWS_DAYS } from "./velocity.mjs";
import { rankGroups } from "./group-growth.mjs";
import { buildWebsiteJsonLd, buildItemListJsonLd, buildSoftwareSourceCodeJsonLd } from "./seo.mjs";
import { githubRepoUrl, buildSparklinePath, starHistoryCaption } from "../app/shared/star-history.js";

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

/** Site-wide nav bar: brand links home, right side links out to the GitHub repo. Omitted from embeds. */
function renderSiteHeader(basePath) {
  return `
    <header class="site-header">
      <a class="site-header-brand" href="${basePath}/">awesomemap</a>
      <div class="site-header-links">
        <a class="site-header-rising" href="${basePath}/rising/">Rising</a>
        <a class="site-header-tags" href="${basePath}/tags/">Tags</a>
        <a class="site-header-compare" href="${basePath}/compare/">Compare</a>
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
  const footer = embed ? "" : renderSiteFooter();
  const teaserSection = embed
    ? ""
    : renderRisingTeaser(teaser, { heading: "Rising this week", href: `${basePath}/rising/#${domain.slug}`, showDomain: false, basePath });
  // Omitted from embeds along with the rest of the chrome — an embedded map is
  // a visualization, not a page.
  const categorySection = embed ? "" : renderCategoryMomentum(categoryGrowth, { windowDays: momentumWindowDays });
  const tagSection = embed ? "" : renderTagWidget(topTags, risingTags, { basePath, windowDays: momentumWindowDays });
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

/**
 * Renders the landing page listing every domain. `domains` is an array of
 * { slug, name, shortName, description, growth } where `growth` is that
 * domain's `computeGroupGrowth` result for the momentum window.
 *
 * Cards are ordered by growth rate rather than by filename, so the page opens
 * on an answer ("AI is moving fastest this week") instead of an alphabetical
 * index. Untracked domains sort last — see `rankGroups`.
 */
export function renderLandingPage(domains, { defaultOgImage, siteUrl = "", basePath = "", signals = {}, momentumWindowDays = RISING_WINDOWS_DAYS[0] }) {
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
  const signalsSection = renderTodaysSignals(signals, { basePath });
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
        <p class="hero-tagline">What's taking off in open source — spotted by growth, not just stars.</p>
        ${renderDomainQuicklinks(domains, basePath)}
      </div>
    </header>
    ${signalsSection}
    <div class="map-index">
      <h2 class="map-index-heading">Explore the maps</h2>
      <p class="map-index-note">Ranked by how fast each ecosystem grew over the last ${momentumWindowDays} days — growth rate, not size.</p>
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

/**
 * Formats one leaderboard entry (as returned by leaderboard.mjs's
 * computeLeaderboard) as a row. `showDomain` controls whether the
 * cross-domain tag is shown — true for the global list, false for a single
 * domain's own list. The name links to the project's own internal page
 * (`/projects/<id>/`, prefixed by `basePath`) rather than straight to
 * `entry.link` (the external homepage) — that page is what shows the
 * description, star-history sparkline, domain rank, and tags before
 * sending visitors onward. `entry.link` is used only as a fallback for the
 * (currently theoretical) case of an entry with no project id.
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
  const projectHref = entry.id ? `${basePath}/projects/${entry.id}/` : (entry.link ?? "#");
  return `
    <li class="rising-row" data-domain="${escapeHtml(entry.domainSlug ?? "")}">
      <span class="rising-row-rank">${entry.rank}</span>
      ${icon}
      <span class="rising-row-title">
        <a class="rising-row-name" href="${escapeHtml(projectHref)}">${escapeHtml(entry.name)}</a>
        ${repoId}
      </span>
      ${domainTag}
      <span class="rising-row-arrow ${arrowClass}">${arrowSymbol}${movedBy > 0 ? movedBy : ""}</span>
      <span class="rising-row-delta">${sign}${entry.starDelta} (${sign}${pct}%)</span>
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

/** One card in the landing page's "Today's signals" module — same shape for every signal type, just a different label/title/stat/meta/href. */
function renderSignalCard({ label, title, stat, meta, href }) {
  const metaLine = meta ? `<span class="signal-card-meta">${escapeHtml(meta)}</span>` : "";
  return `
    <a class="signal-card" href="${escapeHtml(href)}">
      <span class="signal-card-label">${label}</span>
      <span class="signal-card-title">${escapeHtml(title)}</span>
      <span class="signal-card-stat">${stat}</span>
      ${metaLine}
    </a>`;
}

/**
 * Renders the landing page's "Today's signals" module — up to three cards
 * (biggest mover, heating-up project, one-to-watch) built from
 * `pickTodaysSignals`'s output (see todays-signals.mjs). Any signal that's
 * `null` (no qualifying candidate yet) is skipped; the whole section is
 * omitted when none qualify, rather than rendering an empty shell.
 */
function renderTodaysSignals({ mover, heatingUp, watch } = {}, { basePath }) {
  const cards = [
    mover &&
      renderSignalCard({
        label: "🔥 Biggest mover",
        title: mover.name,
        stat: `+${mover.starDelta} stars (+${mover.percentDelta.toFixed(1)}%) this week`,
        meta: mover.domainShort,
        href: `${basePath}/projects/${mover.id}/`,
      }),
    heatingUp &&
      renderSignalCard({
        label: "📈 Heating up",
        title: heatingUp.name,
        stat: `+${heatingUp.percentDelta.toFixed(1)}% this week`,
        meta: heatingUp.domainShort,
        href: `${basePath}/projects/${heatingUp.id}/`,
      }),
    watch &&
      renderSignalCard({
        label: "👀 One to watch",
        title: watch.name,
        stat: `+${watch.percentDelta.toFixed(1)}% this week · ★ ${formatStars(watch.currentStars)}`,
        meta: watch.domainShort,
        href: `${basePath}/projects/${watch.id}/`,
      }),
  ].filter(Boolean);

  if (cards.length === 0) return "";

  return `
    <section class="todays-signals">
      <h2 class="todays-signals-heading">Today's signals</h2>
      <div class="signals-grid">${cards.join("")}</div>
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

/** Formats a plain (non-delta) star count with thousands separators, e.g. `12,400`. */
function formatStars(stars) {
  return Number(stars).toLocaleString("en-US");
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
    ${renderSiteFooter()}
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
  return `
    <li class="rising-row">
      <span class="rising-row-rank">${rank}</span>
      ${icon}
      <span class="rising-row-title">
        <a class="rising-row-name" href="${escapeHtml(project.link ?? "#")}">${escapeHtml(project.name ?? project.id)}</a>
      </span>
      ${domainBadge}
      <span class="rising-row-delta">${stars}</span>
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
    ${renderSiteFooter()}
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
 * Server-rendered star-history sparkline for a project page — reuses the
 * same SVG path math app/shared/star-history.js already provides for the
 * client-side detail panel (a static page has no client fetch to lazily
 * draw it from). `historySeries` is `starHistoryFor`'s output (oldest-first
 * `{date, stars}[]`). Renders nothing when there are fewer than 2 points,
 * matching `buildSparklinePath`'s own "nothing to draw" convention.
 */
function renderProjectStarChart(historySeries) {
  const spark = buildSparklinePath(historySeries);
  if (!spark) return "";
  const caption = starHistoryCaption(historySeries);
  return `
    <div class="detail-panel-star-chart">
      <svg class="detail-panel-star-chart-svg" viewBox="0 0 ${spark.width} ${spark.height}" width="${spark.width}" height="${spark.height}">
        <path d="${spark.path}" />
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
  { domain, signal = {}, historySeries = [], defaultOgImage, siteUrl = "", basePath = "" }
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

  const body = `
    ${renderSiteHeader(basePath)}
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
      ${renderProjectStarChart(historySeries)}
      <div class="project-links">
        <a class="detail-panel-stars" href="${escapeHtml(githubRepoUrl(project.id))}" target="_blank" rel="noopener">★ ${formatStars(project.weight ?? 0)} stars on GitHub</a>
        ${project.link ? `<a class="detail-panel-link" href="${escapeHtml(project.link)}" target="_blank" rel="noopener">Visit site ↗</a>` : ""}
        <a class="detail-panel-link" href="${basePath}/compare/?id=${encodeURIComponent(project.id)}">+ Compare</a>
      </div>
      ${renderProjectTagChips(project.tags, basePath)}
    </div>
    ${renderSiteFooter()}
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
    ${renderSiteFooter()}
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
