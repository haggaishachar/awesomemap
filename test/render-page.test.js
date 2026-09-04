import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderDomainPage,
  renderLandingPage,
  renderRisingPage,
  renderTagsIndexPage,
  renderTagPage,
  renderProjectPage,
  renderComparePage,
  renderSearchPage,
  renderSubmitPage,
  renderMethodologyPage,
  renderContactPage,
  tagSlug,
} from "../scripts/render-page.mjs";
import { buildEmbedSnippet } from "../app/shared/embed-snippet.js";

/**
 * Undoes escapeHtml's 4-entity escaping — simulates what a browser's HTML
 * parser does exactly once when it decodes a `<textarea>`'s (RCDATA) text
 * content into its `.value`. Entities must be decoded `&amp;` last, or an
 * `&amp;lt;` produced by double-escaping `&` would wrongly decode as `<`.
 */
function decodeHtmlEntitiesOnce(text) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

const ROOT_TREE = { id: "data-science", name: "Data Science", children: [] };

test("a domain name containing '$&' round-trips unchanged, not corrupted by String.replace's special pattern", () => {
  const domain = { slug: "data-science", name: "Foo $& Bar", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<title>Foo \$&amp; Bar<\/title>/);
  // Guard against the corrupted form String.replace would produce if the
  // replacement string were passed directly (matched text spliced back in).
  assert.doesNotMatch(html, /\{\{TITLE\}\}/);
});

test("a domain description containing '$`' does not corrupt the page", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "Weird $` desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.match(html, /Weird \$` desc/);
  assert.doesNotMatch(html, /\{\{OG_DESCRIPTION\}\}/);
  assert.doesNotMatch(html, /\{\{TITLE\}\}/);
});

test("a project desc containing a literal '</script>' does not produce a raw '</script>' in the output", () => {
  const tree = {
    id: "data-science",
    name: "Data Science",
    children: [{ id: "evil-project", name: "Evil Project", desc: "</script><script>alert(1)</script>", children: [] }],
  };
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, tree, { defaultOgImage: "/og-default.png" });
  const mapDataMatch = html.match(/<script type="application\/json" id="map-data">([\s\S]*?)<\/script>/);
  assert.ok(mapDataMatch, "map-data script block should exist");
  assert.doesNotMatch(mapDataMatch[1], /<\/script>/);
  // The escaped JSON should still parse back to the original string.
  const parsed = JSON.parse(mapDataMatch[1]);
  assert.equal(parsed.children[0].desc, "</script><script>alert(1)</script>");
});

test("BASE_PATH is prefixed onto every emitted path, and defaults to root-relative when empty", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const rootHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(rootHtml, /href="\/shared\/treemap.css"/);
  assert.match(rootHtml, /"d3-hierarchy": "\/vendor\/d3-hierarchy\/index.js"/);
  assert.match(rootHtml, /class="site-header-brand" href="\/"/);
  assert.match(rootHtml, /import \{ mountTreemap \} from "\/shared\/treemap.js"/);

  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(prefixedHtml, /href="\/techmap\/shared\/treemap.css"/);
  assert.match(prefixedHtml, /"d3-hierarchy": "\/techmap\/vendor\/d3-hierarchy\/index.js"/);
  assert.match(prefixedHtml, /class="site-header-brand" href="\/techmap\/"/);
  assert.match(prefixedHtml, /import \{ mountTreemap \} from "\/techmap\/shared\/treemap.js"/);
});

test("the detail panel is created with a historyUrl pointing at the domain's own history.json, prefixed by BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const rootHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(
    rootHtml,
    /createDetailPanel\(document\.body, \{ historyUrl: "\/data-science\/history\.json", basePath: "", showProjectPageLink: true, showCompareLink: true \}\)/
  );

  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(
    prefixedHtml,
    /createDetailPanel\(document\.body, \{ historyUrl: "\/techmap\/data-science\/history\.json", basePath: "\/techmap", showProjectPageLink: true, showCompareLink: true \}\)/
  );
});

test("the domain page's inline script restores zoom/mode state from the URL on load and replaces the initial history entry with it", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(html, /import \{ parseZoomState, formatZoomState \} from "\/shared\/zoom-url\.js"/);
  assert.match(html, /parseZoomState\(new URLSearchParams\(location\.search\), zoomUrlOptions\)/);
  assert.match(html, /history\.replaceState\(initialState, "", /);
  assert.match(html, /mountTreemap\(\s*document\.getElementById\("app"\),\s*mapData,\s*\(leafData\) => panel\.open\(leafData\),\s*\(\) => panel\.close\(\),\s*\{\s*initialState,/);
});

test("the domain page's inline script mirrors zoom/mode navigation into the URL via history.pushState/replaceState and restores state on popstate", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(html, /onNavigate: \(state, \{ replace \}\) => \{/);
  assert.match(html, /history\.pushState\(state, "", /);
  assert.match(html, /history\.replaceState\(state, "", /);
  assert.match(html, /addEventListener\("popstate", \(event\) => \{/);
  assert.match(html, /treemap\.applyState\(state\)/);
});

test("the embed variant's detail panel has showProjectPageLink set to false", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "", embed: true });
  assert.match(
    html,
    /createDetailPanel\(document\.body, \{ historyUrl: "\/data-science\/history\.json", basePath: "", showProjectPageLink: false, showCompareLink: false \}\)/
  );
});

test("the embed variant's detail panel has showCompareLink set to false", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const embedHtml = renderDomainPage(domain, ROOT_TREE, { embed: true, defaultOgImage: "/og-default.png" });
  assert.match(embedHtml, /showCompareLink: false/);

  const fullHtml = renderDomainPage(domain, ROOT_TREE, { embed: false, defaultOgImage: "/og-default.png" });
  assert.match(fullHtml, /showCompareLink: true/);
});

test("og:image and og:url are absolute when SITE_URL is set (origin only, combined with BASE_PATH)", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, {
    defaultOgImage: "https://haggaishachar.github.io/techmap/og-default.png",
    siteUrl: "https://haggaishachar.github.io",
    basePath: "/techmap",
  });
  assert.match(html, /property="og:image" content="https:\/\/haggaishachar\.github\.io\/techmap\/og-default\.png"/);
  assert.match(html, /property="og:url" content="https:\/\/haggaishachar\.github\.io\/techmap\/data-science\/"/);
});

test("the site header is placed before #app, not after — reachable without scrolling past the map", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.ok(html.indexOf('class="site-header"') < html.indexOf('id="app"'));
});

test("the embed variant has no site header or footer and starts straight at #app", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", embed: true });
  assert.doesNotMatch(html, /site-header/);
  assert.doesNotMatch(html, /site-footer/);
});

test("the domain page renders a hero header with the domain's name and description", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "Notebooks, ML frameworks, and more." };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<header class="rising-hero">\s*<h1>Data Science<\/h1>\s*<p class="rising-hero-tagline">Notebooks, ML frameworks, and more\.<\/p>\s*<\/header>/);
});

test("the domain hero is placed after the site header and before #app, escaping HTML in name and description", () => {
  const domain = { slug: "data-science", name: "Data <Science>", description: "Uses & loves ML" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<h1>Data &lt;Science&gt;<\/h1>/);
  assert.match(html, /<p class="rising-hero-tagline">Uses &amp; loves ML<\/p>/);
  const headerIndex = html.indexOf('class="site-header"');
  const heroIndex = html.indexOf('class="rising-hero"');
  const appIndex = html.indexOf('id="app"');
  assert.ok(headerIndex < heroIndex, "hero should come after the site header");
  assert.ok(heroIndex < appIndex, "hero should come before the map");
});

test("the embed variant has no hero header", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", embed: true });
  assert.doesNotMatch(html, /rising-hero/);
});

test("the domain page header links to the GitHub repo", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.match(html, /class="site-header-github" href="https:\/\/github\.com\/haggaishachar\/awesomemap"/);
});

test("the domain page footer links to license, contributing, and issues", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.match(html, /class="site-footer"/);
  assert.match(html, /href="https:\/\/github\.com\/haggaishachar\/awesomemap\/blob\/master\/LICENSE"/);
  assert.match(html, /href="https:\/\/github\.com\/haggaishachar\/awesomemap\/blob\/master\/CONTRIBUTING\.md"/);
  assert.match(html, /href="https:\/\/github\.com\/haggaishachar\/awesomemap\/issues"/);
});

test("every page's <head> declares og:site_name and the og:image's dimensions", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<meta property="og:site_name" content="awesomemap" \/>/);
  assert.match(html, /<meta property="og:image:width" content="1200" \/>/);
  assert.match(html, /<meta property="og:image:height" content="630" \/>/);
});

test("og:image:alt and twitter:image:alt reuse the page's og description, escaped the same way as the other og:* tags", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "Weird $` desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<meta property="og:image:alt" content="Weird \$` desc" \/>/);
  assert.match(html, /<meta name="twitter:image:alt" content="Weird \$` desc" \/>/);
});

test("the domain page renders an awesomemap.dev badge after the map, on both the full page and the embed variant", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const fullHtml = renderDomainPage(domain, ROOT_TREE, {
    defaultOgImage: "/og-default.png",
    siteUrl: "https://awesomemap.dev",
    basePath: "",
  });
  assert.match(fullHtml, /<a class="map-badge" href="https:\/\/awesomemap\.dev\/"[^>]*>[\s\S]*?awesomemap\.dev[\s\S]*?<\/a>/);
  assert.ok(fullHtml.indexOf('id="app"') < fullHtml.indexOf('class="map-badge"'), "badge should come after the map");

  const embedHtml = renderDomainPage(domain, ROOT_TREE, {
    defaultOgImage: "/og-default.png",
    siteUrl: "https://awesomemap.dev",
    basePath: "",
    embed: true,
  });
  assert.match(embedHtml, /class="map-badge" href="https:\/\/awesomemap\.dev\/"/);
});

test("the map badge falls back to a root-relative link, prefixed by BASE_PATH, when SITE_URL is unset", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /class="map-badge" href="\/techmap\/"/);
});

test("the domain page renders X/LinkedIn/Reddit share links and a copy-link button for the domain's own canonical URL", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, {
    defaultOgImage: "/og-default.png",
    siteUrl: "https://awesomemap.dev",
    basePath: "",
  });
  assert.match(
    html,
    /class="map-share-x" href="https:\/\/twitter\.com\/intent\/tweet\?url=https%3A%2F%2Fawesomemap\.dev%2Fdata-science%2F&amp;text=Data\+Science"/
  );
  assert.match(
    html,
    /class="map-share-linkedin" href="https:\/\/www\.linkedin\.com\/sharing\/share-offsite\/\?url=https%3A%2F%2Fawesomemap\.dev%2Fdata-science%2F"/
  );
  assert.match(
    html,
    /class="map-share-reddit" href="https:\/\/www\.reddit\.com\/submit\?url=https%3A%2F%2Fawesomemap\.dev%2Fdata-science%2F&amp;title=Data\+Science"/
  );
  assert.match(html, /class="map-share-copy" data-copy-text="https:\/\/awesomemap\.dev\/data-science\/"/);
});

test("the domain page renders a copyable iframe embed snippet pointing at the domain's /embed/ URL", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, {
    defaultOgImage: "/og-default.png",
    siteUrl: "https://awesomemap.dev",
    basePath: "",
  });
  assert.match(
    html,
    /<textarea class="map-embed-code" readonly>&lt;iframe src=&quot;https:\/\/awesomemap\.dev\/embed\/data-science\/&quot; width=&quot;100%&quot; height=&quot;600&quot; style=&quot;border:0&quot; title=&quot;Data Science on awesomemap&quot;&gt;&lt;\/iframe&gt;<\/textarea>/
  );
});

test("a domain name containing HTML metacharacters round-trips through the embed textarea's double escaping to the exact snippet buildEmbedSnippet produces", () => {
  const domain = { slug: "evil", name: 'R&D "Labs" <script>', description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", siteUrl: "https://awesomemap.dev", basePath: "" });
  const match = html.match(/<textarea class="map-embed-code" readonly>([\s\S]*?)<\/textarea>/);
  assert.ok(match, "embed textarea should exist");
  // One entity-decode pass is what a browser does when reading a <textarea>'s
  // (RCDATA) content into its .value — the same decode a user's browser
  // performs the instant they open the Embed panel to copy it.
  const copiedValue = decodeHtmlEntitiesOnce(match[1]);
  // What buildEmbedSnippet itself produces directly — the copied value must
  // match this exactly (not the further-unescaped "R&D" domain name), or
  // the pasted snippet wouldn't be the valid HTML embed-snippet.js built.
  assert.equal(copiedValue, buildEmbedSnippet("https://awesomemap.dev/embed/evil/", 'R&D "Labs" <script>'));
  // The raw page source itself — not just the copied-and-decoded value —
  // must never contain the domain name's `<script>` unescaped (the page
  // legitimately carries a few of its own `<script>` tags elsewhere, so
  // this checks for the specific injected substring, not any script tag).
  assert.doesNotMatch(html, /Labs" <script>/);
});

test("the domain page's share/embed row wires up copy-to-clipboard and the embed panel toggle", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.match(html, /import \{ copyToClipboard \} from "\/shared\/clipboard\.js"/);
  assert.match(html, /embedToggle\.addEventListener\("click", \(\) => \{/);
});

test("the embed variant has no share buttons or embed panel — it's already what would be embedded", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", embed: true });
  assert.doesNotMatch(html, /map-share/);
  assert.doesNotMatch(html, /map-embed/);
});

test("landing page card links escape the slug and use a trailing slash", () => {
  const html = renderLandingPage(
    [{ slug: "data-science", name: "Data Science", description: "desc" }],
    { defaultOgImage: "/og-default.png", basePath: "" }
  );
  assert.match(html, /href="\/data-science\/"/);
});

test("landing page card links respect BASE_PATH", () => {
  const html = renderLandingPage(
    [{ slug: "data-science", name: "Data Science", description: "desc" }],
    { defaultOgImage: "/og-default.png", basePath: "/techmap" }
  );
  assert.match(html, /href="\/techmap\/data-science\/"/);
});

test("landing page renders a hero with title and tagline above the map grid", () => {
  const html = renderLandingPage(
    [{ slug: "data-science", name: "Data Science", description: "desc" }],
    { defaultOgImage: "/og-default.png", basePath: "" }
  );
  assert.match(html, /<header class="hero">/);
  assert.match(html, /<h1>awesomemap<\/h1>/);
  assert.match(html, /class="hero-tagline"/);
  // Hero must come before the map grid in document order.
  assert.ok(html.indexOf('class="hero"') < html.indexOf('class="map-grid"'));
});

test("landing page renders a site header, with GitHub link, above the hero", () => {
  const html = renderLandingPage(
    [{ slug: "data-science", name: "Data Science", description: "desc" }],
    { defaultOgImage: "/og-default.png", basePath: "" }
  );
  assert.match(html, /class="site-header-github" href="https:\/\/github\.com\/haggaishachar\/awesomemap"/);
  assert.ok(html.indexOf('class="site-header"') < html.indexOf('class="hero"'));
});

test("landing page site header brand link respects BASE_PATH", () => {
  const html = renderLandingPage(
    [{ slug: "data-science", name: "Data Science", description: "desc" }],
    { defaultOgImage: "/og-default.png", basePath: "/techmap" }
  );
  assert.match(html, /class="site-header-brand" href="\/techmap\/"/);
});

test("landing page renders a site footer, with license/contributing/issues links, below the map grid", () => {
  const html = renderLandingPage(
    [{ slug: "data-science", name: "Data Science", description: "desc" }],
    { defaultOgImage: "/og-default.png", basePath: "" }
  );
  assert.match(html, /href="https:\/\/github\.com\/haggaishachar\/awesomemap\/blob\/master\/LICENSE"/);
  assert.match(html, /href="https:\/\/github\.com\/haggaishachar\/awesomemap\/blob\/master\/CONTRIBUTING\.md"/);
  assert.match(html, /href="https:\/\/github\.com\/haggaishachar\/awesomemap\/issues"/);
  assert.ok(html.indexOf('class="map-grid"') < html.indexOf('class="site-footer"'));
});

test("the site header includes a Rising nav link, prefixed by BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const rootHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(rootHtml, /class="site-header-rising" href="\/rising\/"/);

  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(prefixedHtml, /class="site-header-rising" href="\/techmap\/rising\/"/);
});

test("the site header includes a Compare nav link with a stable id, prefixed by BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const rootHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(rootHtml, /class="site-header-compare" id="site-header-compare" href="\/compare\/"/);

  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(prefixedHtml, /class="site-header-compare" id="site-header-compare" href="\/techmap\/compare\/"/);
});

test("every full (non-embed) page wires up the compare-cart bootstrap script, prefixed by BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const fullHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(fullHtml, /import \{ initCompareCartUI \} from "\/techmap\/shared\/compare-cart.js"/);
  assert.match(fullHtml, /initCompareCartUI\("\/techmap"\)/);

  const embedHtml = renderDomainPage(domain, ROOT_TREE, { embed: true, defaultOgImage: "/og-default.png" });
  assert.doesNotMatch(embedHtml, /compare-cart.js/);
});

test("renderRisingPage renders a row per leaderboard entry, with rank, arrow, and star delta", () => {
  const domains = [{ slug: "data-science", name: "Data Science" }];
  const leaderboardsByWindow = {
    7: {
      global: [
        { rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 1 },
      ],
      "data-science": [],
    },
    30: { global: [], "data-science": [] },
    90: { global: [], "data-science": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<span class="rising-row-rank">1<\/span>/);
  assert.match(html, /<a class="rising-row-name" href="\/projects\/a\/a\/">Project A<\/a>/);
  assert.match(html, /rising-row-up">▲1<\/span>/);
  assert.match(html, /\+40 \(\+40\.0%\)/);
});

test("renderRisingPage's rows include a + Compare toggle button carrying the project's id", () => {
  const domains = [{ slug: "data-science", name: "Data Science" }];
  const leaderboardsByWindow = {
    7: {
      global: [
        { rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 1 },
      ],
      "data-science": [],
    },
    30: { global: [], "data-science": [] },
    90: { global: [], "data-science": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<button type="button" class="rising-row-compare compare-toggle" data-compare-id="a\/a" aria-pressed="false">\+ Compare<\/button>/);
});

test("renderRisingPage's row links point at the project's own internal page (prefixed by BASE_PATH), not its external homepage — so visitors see the description, sparkline, and tags before leaving the site", () => {
  const domains = [{ slug: "data-science", name: "Data Science" }];
  const leaderboardsByWindow = {
    7: {
      global: [
        { rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 1 },
      ],
      "data-science": [],
    },
    30: { global: [], "data-science": [] },
    90: { global: [], "data-science": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /<a class="rising-row-name" href="\/techmap\/projects\/a\/a\/">Project A<\/a>/);
  assert.doesNotMatch(html, /href="https:\/\/a\.example"/);
});

test("renderRisingPage's rows show the repo id and the domain's short name, and carry the domain's slug for filtering", () => {
  const domains = [{ slug: "artificial-intelligence", name: "Best Artificial Intelligence Open Source Projects", shortName: "AI" }];
  const leaderboardsByWindow = {
    7: {
      global: [
        {
          rank: 1,
          id: "vllm-project/vllm",
          name: "vLLM",
          link: "https://vllm.ai/",
          domain: "Best Artificial Intelligence Open Source Projects",
          domainShort: "AI",
          domainSlug: "artificial-intelligence",
          starDelta: 40,
          percentDelta: 40,
          rankDelta: 1,
        },
      ],
      "artificial-intelligence": [],
    },
    30: { global: [], "artificial-intelligence": [] },
    90: { global: [], "artificial-intelligence": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<span class="rising-row-repo">vllm-project\/vllm<\/span>/);
  assert.match(html, /<span class="rising-row-domain" title="Best Artificial Intelligence Open Source Projects">AI<\/span>/);
  assert.match(html, /<li class="rising-row" data-domain="artificial-intelligence">/);
});

test("renderRisingPage renders a domain filter chip per domain, plus an All chip", () => {
  const domains = [
    { slug: "artificial-intelligence", name: "Best Artificial Intelligence Open Source Projects", shortName: "AI" },
    { slug: "security", name: "Best Security Open Source Projects", shortName: "Security" },
  ];
  const leaderboardsByWindow = {
    7: { global: [], "artificial-intelligence": [], security: [] },
    30: { global: [], "artificial-intelligence": [], security: [] },
    90: { global: [], "artificial-intelligence": [], security: [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<button type="button" class="rising-domain-button rising-domain-button-active" data-domain="all">All<\/button>/);
  assert.match(html, /<button type="button" class="rising-domain-button" data-domain="artificial-intelligence">AI<\/button>/);
  assert.match(html, /<button type="button" class="rising-domain-button" data-domain="security">Security<\/button>/);
});

test("renderRisingPage's inline script applies the domain filter matching the URL hash on load, so a quick-filter link (from the landing page or a domain page) arrives pre-filtered", () => {
  const domains = [{ slug: "artificial-intelligence", name: "Best Artificial Intelligence Open Source Projects", shortName: "AI" }];
  const leaderboardsByWindow = {
    7: { global: [], "artificial-intelligence": [] },
    30: { global: [], "artificial-intelligence": [] },
    90: { global: [], "artificial-intelligence": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  assert.match(html, /const initialDomain = decodeURIComponent\(location\.hash\.slice\(1\)\);/);
  assert.match(html, /applyDomainFilter\(initialDomain\);/);
});

test("renderRisingPage's domain filter swaps to that domain's own top-20 section, hiding the others, rather than filtering global rows", () => {
  const domains = [{ slug: "artificial-intelligence", name: "Best Artificial Intelligence Open Source Projects", shortName: "AI" }];
  const leaderboardsByWindow = {
    7: {
      global: [],
      "artificial-intelligence": [
        { rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "AI", starDelta: 40, percentDelta: 40, rankDelta: 1 },
      ],
    },
    30: { global: [], "artificial-intelligence": [] },
    90: { global: [], "artificial-intelligence": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  // The domain section is rendered (using the domain-scoped leaderboard, not a slice of global) but starts hidden.
  assert.match(html, /<section class="rising-section" id="artificial-intelligence" hidden>/);
  assert.match(html, /<h2 class="rising-section-heading">Hottest in AI<\/h2>/);
  assert.match(html, /Project A/);
  // The filter script swaps `.rising-section` visibility by id instead of hiding individual rows.
  assert.match(
    html,
    /const targetSectionId = selected === "all" \? "global" : selected;/
  );
  assert.match(
    html,
    /document\.querySelectorAll\("\.rising-section"\)\.forEach\(\(section\) => \{\s*section\.hidden = section\.id !== targetSectionId;/
  );
});

test("renderRisingPage shows a not-ready placeholder for a leaderboard with no eligible entries", () => {
  const domains = [{ slug: "data-science", name: "Data Science" }];
  const leaderboardsByWindow = {
    7: { global: [], "data-science": [] },
    30: { global: [], "data-science": [] },
    90: { global: [], "data-science": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  assert.match(html, /Not enough star-history yet for this window\./);
});

test("renderRisingPage renders all three window variants, only the 7-day one visible initially", () => {
  const leaderboardsByWindow = { 7: { global: [] }, 30: { global: [] }, 90: { global: [] } };
  const html = renderRisingPage([], leaderboardsByWindow, { defaultOgImage: "/og-default.png" });
  assert.match(html, /<div class="rising-rows" data-window="7">/);
  assert.match(html, /<div class="rising-rows" data-window="30" hidden>/);
  assert.match(html, /<div class="rising-rows" data-window="90" hidden>/);
});

test("renderRisingPage renders the Hottest overall section plus one section per domain — no Hottest ecosystems table", () => {
  const domains = [{ slug: "data-science", name: "Data Science" }];
  const leaderboardsByWindow = {
    7: { global: [], "data-science": [] },
    30: { global: [], "data-science": [] },
    90: { global: [], "data-science": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /<section class="rising-section" id="global">/);
  assert.match(html, /<section class="rising-section" id="data-science" hidden>/);
  assert.doesNotMatch(html, /Hottest ecosystems/);
  const sectionCount = [...html.matchAll(/class="rising-section"/g)].length;
  assert.equal(sectionCount, 2, "the Hottest overall section plus one per-domain section should render");
});

test("renderDomainPage renders a teaser section below the map, linking to that domain's rising anchor", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const teaser = [{ rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", teaser });
  assert.match(html, /class="rising-teaser-link" href="\/rising\/#data-science"/);
  assert.ok(html.indexOf('id="app"') < html.indexOf('class="rising-teaser"'));
});

test("renderDomainPage's teaser row links at the project's internal page, prefixed by BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const teaser = [{ rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap", teaser });
  assert.match(html, /<a class="rising-row-name" href="\/techmap\/projects\/a\/a\/">Project A<\/a>/);
});

test("renderDomainPage's embed variant has no teaser section", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const teaser = [{ rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", embed: true, teaser });
  assert.doesNotMatch(html, /rising-teaser/);
});

test("renderLandingPage no longer renders the old global rising-teaser section", () => {
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], { defaultOgImage: "/og-default.png" });
  assert.doesNotMatch(html, /rising-teaser/);
});

test("renderLandingPage renders a this-week's-signals section between the hero and the map grid", () => {
  const signals = {
    mover: { id: "a/a", name: "Project A", domainShort: "Data Science", starDelta: 400, percentDelta: 40 },
    heatingUp: { id: "c/c", name: "Project C", domainShort: "Data Science", percentDelta: 12 },
    watch: { id: "b/b", name: "Project B", domainShort: "Security", percentDelta: 80, currentStars: 900 },
  };
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], { defaultOgImage: "/og-default.png", signals });
  assert.match(html, /<section class="this-weeks-signals">/);
  assert.ok(html.indexOf('class="hero"') < html.indexOf('class="this-weeks-signals"'));
  assert.ok(html.indexOf('class="this-weeks-signals"') < html.indexOf('class="map-grid"'));
});

test("renderLandingPage's mover and watch signal cards link at the project's internal page, prefixed by BASE_PATH", () => {
  const signals = {
    mover: { id: "a/a", name: "Project A", domainShort: "Data Science", starDelta: 400, percentDelta: 40 },
    heatingUp: null,
    watch: { id: "b/b", name: "Project B", domainShort: "Security", percentDelta: 80, currentStars: 900 },
  };
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], {
    defaultOgImage: "/og-default.png",
    basePath: "/techmap",
    signals,
  });
  assert.match(html, /<a class="signal-card-link" href="\/techmap\/projects\/a\/a\/">[\s\S]*?Project A[\s\S]*?<\/a>/);
  assert.match(html, /<a class="signal-card-link" href="\/techmap\/projects\/b\/b\/">[\s\S]*?Project B[\s\S]*?<\/a>/);
});

test("renderLandingPage's signal cards each carry a compare-toggle button for their project id", () => {
  const signals = {
    mover: { id: "a/a", name: "Project A", domainShort: "Data Science", starDelta: 400, percentDelta: 40 },
    heatingUp: { id: "c/c", name: "Project C", domainShort: "Data Science", percentDelta: 12 },
    watch: { id: "b/b", name: "Project B", domainShort: "Security", percentDelta: 80, currentStars: 900 },
  };
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], { defaultOgImage: "/og-default.png", signals });
  assert.match(html, /<button type="button" class="signal-card-compare compare-toggle" data-compare-id="a\/a" aria-pressed="false">\+ Compare<\/button>/);
  assert.match(html, /<button type="button" class="signal-card-compare compare-toggle" data-compare-id="c\/c" aria-pressed="false">\+ Compare<\/button>/);
  assert.match(html, /<button type="button" class="signal-card-compare compare-toggle" data-compare-id="b\/b" aria-pressed="false">\+ Compare<\/button>/);
});

test("renderLandingPage's signal cards show each project's own desc, escaped, and omit the desc line when a project has none", () => {
  const signals = {
    mover: { id: "a/a", name: "Project A", domainShort: "Data Science", starDelta: 400, percentDelta: 40, desc: "Does <stuff> & things." },
    heatingUp: { id: "c/c", name: "Project C", domainShort: "Data Science", percentDelta: 12 }, // no desc
    watch: { id: "b/b", name: "Project B", domainShort: "Security", percentDelta: 80, currentStars: 900, desc: "" }, // empty desc
  };
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], { defaultOgImage: "/og-default.png", signals });
  assert.match(html, /<span class="signal-card-desc">Does &lt;stuff&gt; &amp; things\.<\/span>/);
  assert.equal((html.match(/signal-card-desc/g) ?? []).length, 1);
});

test("renderLandingPage's breakout signal card names the category and multiple, and is omitted entirely when null", () => {
  const withBreakout = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], {
    defaultOgImage: "/og-default.png",
    signals: {
      mover: null,
      heatingUp: null,
      watch: null,
      breakout: { id: "d/d", name: "Project D", domainShort: "Data Science", relativeMultiple: 3.8, categoryName: "Databases" },
    },
  });
  assert.match(withBreakout, /🚀 Unexpected breakout/);
  assert.match(withBreakout, /3\.8× faster than Databases this week/);

  const withoutBreakout = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], {
    defaultOgImage: "/og-default.png",
    signals: { mover: { id: "a/a", name: "Project A", domainShort: "Data Science", starDelta: 400, percentDelta: 40 }, heatingUp: null, watch: null, breakout: null },
  });
  assert.doesNotMatch(withoutBreakout, /🚀 Unexpected breakout/);
});

test("renderLandingPage's heatingUp signal card links at that project's own internal page, prefixed by BASE_PATH", () => {
  const signals = { mover: null, heatingUp: { id: "c/c", name: "Project C", domainShort: "Data Science", percentDelta: 12 }, watch: null };
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], {
    defaultOgImage: "/og-default.png",
    basePath: "/techmap",
    signals,
  });
  assert.match(html, /<a class="signal-card-link" href="\/techmap\/projects\/c\/c\/">[\s\S]*?Project C[\s\S]*?<\/a>/);
});

test("renderLandingPage omits the this-week's-signals section entirely when no signal qualifies", () => {
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], {
    defaultOgImage: "/og-default.png",
    signals: { mover: null, heatingUp: null, watch: null },
  });
  assert.doesNotMatch(html, /this-weeks-signals/);
});

test("renderLandingPage defaults to no this-week's-signals section when the option is omitted entirely", () => {
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], { defaultOgImage: "/og-default.png" });
  assert.doesNotMatch(html, /this-weeks-signals/);
});

test("renderLandingPage's this-week's-signals section links to the full /rising/ leaderboard, prefixed by BASE_PATH", () => {
  const signals = { mover: { id: "a/a", name: "Project A", domainShort: "Data Science", starDelta: 400, percentDelta: 40 }, heatingUp: null, watch: null };
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], {
    defaultOgImage: "/og-default.png",
    basePath: "/techmap",
    signals,
  });
  assert.match(html, /<a class="this-weeks-signals-link" href="\/techmap\/rising\/">See full leaderboard →<\/a>/);
});

test("renderLandingPage's this-week's-signals section renders a domain filter bar, defaulting to \"All\" active and every domain's cards hidden", () => {
  const signals = { mover: { id: "a/a", name: "Project A", domainShort: "Data Science", starDelta: 400, percentDelta: 40 }, heatingUp: null, watch: null };
  const domains = [
    { slug: "data-science", name: "Data Science", shortName: "Data Science", description: "desc" },
    { slug: "security", name: "Security", shortName: "Security", description: "desc" },
  ];
  const html = renderLandingPage(domains, { defaultOgImage: "/og-default.png", signals });
  assert.match(html, /<button type="button" class="signals-domain-button signals-domain-button-active" data-domain="all">All<\/button>/);
  assert.match(html, /<button type="button" class="signals-domain-button" data-domain="data-science">Data Science<\/button>/);
  assert.match(html, /<button type="button" class="signals-domain-button" data-domain="security">Security<\/button>/);
  assert.match(html, /<div class="signals-scope" data-signals-scope="all">/);
  assert.match(html, /<div class="signals-scope" data-signals-scope="data-science" hidden>/);
  assert.match(html, /<div class="signals-scope" data-signals-scope="security" hidden>/);
});

test("renderLandingPage renders a domain's own this-week's-signals cards from signalsByDomain, inside that domain's hidden scope", () => {
  const signals = { mover: null, heatingUp: null, watch: null };
  const signalsByDomain = {
    security: { mover: { id: "s/s", name: "Project S", domainShort: "Security", starDelta: 100, percentDelta: 10 }, heatingUp: null, watch: null },
  };
  const domains = [{ slug: "security", name: "Security", shortName: "Security", description: "desc" }];
  const html = renderLandingPage(domains, { defaultOgImage: "/og-default.png", signals, signalsByDomain });
  assert.match(html, /<div class="signals-scope" data-signals-scope="security" hidden>[\s\S]*?Project S[\s\S]*?<\/div>/);
});

test("renderLandingPage's this-week's-signals section falls back to a not-enough-history message for a domain scope with no qualifying signal", () => {
  const signals = { mover: { id: "a/a", name: "Project A", domainShort: "Data Science", starDelta: 400, percentDelta: 40 }, heatingUp: null, watch: null };
  const domains = [{ slug: "security", name: "Security", shortName: "Security", description: "desc" }];
  const html = renderLandingPage(domains, { defaultOgImage: "/og-default.png", signals });
  assert.match(html, /<div class="signals-scope" data-signals-scope="security" hidden><p class="signals-empty">Not enough star-history yet for this window\.<\/p><\/div>/);
});

test("renderLandingPage omits the domain filter bar and per-domain scopes when no domains are passed", () => {
  const signals = { mover: { id: "a/a", name: "Project A", domainShort: "Data Science", starDelta: 400, percentDelta: 40 }, heatingUp: null, watch: null };
  const html = renderLandingPage([], { defaultOgImage: "/og-default.png", signals });
  assert.doesNotMatch(html, /signals-domain-filter/);
  assert.match(html, /<a class="this-weeks-signals-link" href="\/rising\/">See full leaderboard →<\/a>/);
});

test("renderLandingPage still renders the this-week's-signals section when only a domain (not the global scope) has a qualifying signal", () => {
  const signalsByDomain = {
    security: { mover: { id: "s/s", name: "Project S", domainShort: "Security", starDelta: 100, percentDelta: 10 }, heatingUp: null, watch: null },
  };
  const domains = [{ slug: "security", name: "Security", shortName: "Security", description: "desc" }];
  const html = renderLandingPage(domains, {
    defaultOgImage: "/og-default.png",
    signals: { mover: null, heatingUp: null, watch: null },
    signalsByDomain,
  });
  assert.match(html, /<section class="this-weeks-signals">/);
});

test("renderLandingPage's hero no longer duplicates a per-domain quick-jump strip now that this-week's-signals has its own domain filter", () => {
  const domains = [
    { slug: "artificial-intelligence", name: "Best Artificial Intelligence Open Source Projects", shortName: "AI", description: "desc" },
    { slug: "security", name: "Best Security Open Source Projects", shortName: "Security", description: "desc" },
  ];
  const html = renderLandingPage(domains, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.doesNotMatch(html, /domain-quicklink/);
});

test("every page type emits a plain meta description matching its og:description", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "Weird $` desc" };
  const domainHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png" });
  assert.match(domainHtml, /<meta name="description" content="Weird \$` desc" \/>/);

  const landingHtml = renderLandingPage([], { defaultOgImage: "/og-default.png" });
  assert.match(landingHtml, /<meta name="description" content="A community-curated map of open-source technology\." \/>/);

  const risingHtml = renderRisingPage([], { 7: { global: [] }, 30: { global: [] }, 90: { global: [] } }, { defaultOgImage: "/og-default.png" });
  assert.match(risingHtml, /<meta name="description" content="Star-growth leaders across every awesomemap domain, updated daily\." \/>/);
});

test("every page type emits a canonical link matching its own og:url", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, {
    defaultOgImage: "/og-default.png",
    siteUrl: "https://awesomemap.dev",
    basePath: "",
  });
  assert.match(html, /<link rel="canonical" href="https:\/\/awesomemap\.dev\/data-science\/" \/>/);
});

test("the embed variant's canonical link points at the non-embed domain page, not itself", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, {
    defaultOgImage: "/og-default.png",
    siteUrl: "https://awesomemap.dev",
    basePath: "",
    embed: true,
  });
  assert.match(html, /<link rel="canonical" href="https:\/\/awesomemap\.dev\/data-science\/" \/>/);
});

test("every page links a favicon under BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/techmap\/favicon\.svg" \/>/);
});

test("renderDomainPage emits an ItemList JSON-LD block with a ListItem per linked project", () => {
  const domain = {
    slug: "data-science",
    name: "Data Science",
    description: "desc",
    projects: [
      { id: "a/a", name: "Project A", link: "https://a.example" },
      { id: "b/b", name: "Project B" },
    ],
  };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", siteUrl: "https://awesomemap.dev", basePath: "" });
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, "ld+json script block should exist");
  const jsonLd = JSON.parse(match[1]);
  assert.equal(jsonLd["@type"], "ItemList");
  assert.equal(jsonLd.itemListElement.length, 1);
  assert.equal(jsonLd.itemListElement[0].name, "Project A");
});

test("the embed variant has no ItemList JSON-LD block", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc", projects: [{ id: "a/a", name: "Project A", link: "https://a.example" }] };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", embed: true });
  assert.doesNotMatch(html, /application\/ld\+json/);
});

test("renderLandingPage emits a WebSite JSON-LD block", () => {
  const html = renderLandingPage([], { defaultOgImage: "/og-default.png", siteUrl: "https://awesomemap.dev", basePath: "" });
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, "ld+json script block should exist");
  const jsonLd = JSON.parse(match[1]);
  assert.equal(jsonLd["@type"], "WebSite");
  assert.equal(jsonLd.url, "https://awesomemap.dev/");
});

/** A `computeGroupGrowth`-shaped result, for exercising the momentum surfaces. */
function growth({ percentDelta, starDelta = 100, projectCount = 10, trackedCount = 10, hasEnoughHistory = true, oldestDate = "2026-08-08" }) {
  return { projectCount, trackedCount, totalStars: 1000, baselineStars: 900, starDelta, percentDelta, hasEnoughHistory, oldestDate };
}

test("renderLandingPage orders domain cards by growth rate, not by input order", () => {
  const domains = [
    { slug: "slow", name: "Slow Domain", shortName: "Slow", description: "d", growth: growth({ percentDelta: 0.06 }) },
    { slug: "fast", name: "Fast Domain", shortName: "Fast", description: "d", growth: growth({ percentDelta: 2.4 }) },
    { slug: "mid", name: "Mid Domain", shortName: "Mid", description: "d", growth: growth({ percentDelta: 0.5 }) },
  ];
  const html = renderLandingPage(domains, { defaultOgImage: "/og.png" });
  const order = [...html.matchAll(/<a class="map-card" href="\/(\w+)\//g)].map((m) => m[1]);
  assert.deepEqual(order, ["fast", "mid", "slow"]);
});

test("renderLandingPage distinguishes domains whose weekly growth differs only below one decimal place", () => {
  // Real domain momentum over a week sits under 1%. At one decimal these two
  // would both render "+0.1%" while still being ranked in an order the reader
  // has no way to verify.
  const domains = [
    { slug: "a", name: "A", shortName: "A", description: "d", growth: growth({ percentDelta: 0.1208 }) },
    { slug: "b", name: "B", shortName: "B", description: "d", growth: growth({ percentDelta: 0.0646 }) },
  ];
  const html = renderLandingPage(domains, { defaultOgImage: "/og.png" });
  assert.match(html, /\+0\.12%/);
  assert.match(html, /\+0\.06%/);
});

test("renderLandingPage reports an untracked domain as untracked rather than as 0% growth", () => {
  const domains = [
    { slug: "new", name: "New Domain", shortName: "New", description: "d", growth: growth({ percentDelta: 0, starDelta: 0, trackedCount: 0, hasEnoughHistory: false, oldestDate: null }) },
  ];
  const html = renderLandingPage(domains, { defaultOgImage: "/og.png" });
  assert.match(html, /Not tracked yet/);
  assert.doesNotMatch(html, /0\.00%/, "a domain with no snapshots must not claim a measured 0%");
});

test("renderLandingPage sorts an untracked domain below one that genuinely shrank", () => {
  const domains = [
    { slug: "untracked", name: "U", shortName: "U", description: "d", growth: growth({ percentDelta: 0, trackedCount: 0, hasEnoughHistory: false, oldestDate: null }) },
    { slug: "declining", name: "D", shortName: "D", description: "d", growth: growth({ percentDelta: -3, starDelta: -50 }) },
  ];
  const html = renderLandingPage(domains, { defaultOgImage: "/og.png" });
  const order = [...html.matchAll(/<a class="map-card" href="\/(\w+)\//g)].map((m) => m[1]);
  assert.deepEqual(order, ["declining", "untracked"]);
});

test("renderLandingPage headings use the short name, keeping the long SEO title as the link title", () => {
  const domains = [{ slug: "web-dev", name: "Best Web Development Open Source Projects", shortName: "Web Dev", description: "d", growth: growth({ percentDelta: 1 }) }];
  const html = renderLandingPage(domains, { defaultOgImage: "/og.png" });
  assert.match(html, /<h3>Web Dev<\/h3>/);
  assert.match(html, /title="Best Web Development Open Source Projects"/);
});

test("renderDomainPage lists its categories by growth rate and omits them from the embed", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const categoryGrowth = [
    { key: "Deep Learning", rank: 1, growth: growth({ percentDelta: 1.2 }) },
    { key: "Notebooks", rank: 2, growth: growth({ percentDelta: 0.3 }) },
  ];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", categoryGrowth });
  assert.match(html, /Where the heat is/);
  assert.match(html, /Deep Learning/);

  const embedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", categoryGrowth, embed: true });
  assert.doesNotMatch(embedHtml, /Where the heat is/);
});

test("renderDomainPage omits the category section entirely when no category has history", () => {
  const domain = { slug: "smart-home", name: "Smart Home", description: "desc" };
  const categoryGrowth = [{ key: "Hubs", rank: 1, growth: growth({ percentDelta: 0, trackedCount: 0, hasEnoughHistory: false, oldestDate: null }) }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", categoryGrowth });
  assert.doesNotMatch(html, /Where the heat is/);
});

test("tagSlug URL-encodes a tag for use as a route segment", () => {
  assert.equal(tagSlug("machine-learning"), "machine-learning");
  assert.equal(tagSlug("c++"), "c%2B%2B");
});

test("renderDomainPage renders a Top tags widget with rank, name link, and project count", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const topTags = [
    { tag: "machine-learning", projectCount: 12, totalStars: 500000, rank: 1 },
    { tag: "python", projectCount: 30, totalStars: 900000, rank: 2 },
  ];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", topTags });
  assert.match(html, /Top tags in this domain/);
  assert.match(html, /href="\/tags\/machine-learning\/"/);
  assert.match(html, />machine-learning</);
  assert.match(html, /12 projects/);
});

test("renderDomainPage's tag widget shows a growth badge only for a tag that also appears in risingTags", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const topTags = [
    { tag: "machine-learning", projectCount: 12, totalStars: 500000, rank: 1 },
    { tag: "python", projectCount: 30, totalStars: 900000, rank: 2 },
  ];
  const risingTags = [{ tag: "python", projectCount: 30, totalStars: 900000, rank: 1, growth: growth({ percentDelta: 4 }) }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", topTags, risingTags });
  // Split on each row's opening tag so each row's content is bounded by the
  // next row's opening tag (or end of string for the last) — a fixed-size
  // character slice would risk bleeding into the next row and asserting on
  // the wrong row's content.
  const rows = html.split('<li class="momentum-row">').slice(1);
  const mlRow = rows.find((row) => row.includes(">machine-learning<"));
  const pyRow = rows.find((row) => row.includes(">python<"));
  assert.ok(mlRow && !mlRow.includes("momentum-stat"), "no badge for a tag that isn't rising");
  assert.ok(pyRow && pyRow.includes("momentum-stat"), "badge shown for the rising tag");
});

test("renderDomainPage omits the tag widget when there are no qualifying tags", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", topTags: [] });
  assert.doesNotMatch(html, /Top tags in this domain/);
});

test("renderDomainPage's embed variant has no tag widget", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const topTags = [{ tag: "python", projectCount: 30, totalStars: 900000, rank: 1 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", embed: true, topTags });
  assert.doesNotMatch(html, /Top tags in this domain/);
});

test("renderDomainPage's tag widget links respect BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const topTags = [{ tag: "python", projectCount: 30, totalStars: 900000, rank: 1 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", basePath: "/techmap", topTags });
  assert.match(html, /href="\/techmap\/tags\/python\/"/);
});

test("the site header includes a Tags nav link, prefixed by BASE_PATH", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const rootHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", basePath: "" });
  assert.match(rootHtml, /href="\/tags\/">Tags<\/a>/);
  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og.png", basePath: "/techmap" });
  assert.match(prefixedHtml, /href="\/techmap\/tags\/">Tags<\/a>/);
});

test("renderTagsIndexPage lists top tags ranked by stars, with project count and star total", () => {
  const topTags = [
    { tag: "python", projectCount: 30, totalStars: 900000, rank: 1 },
    { tag: "machine-learning", projectCount: 12, totalStars: 500000, rank: 2 },
  ];
  const html = renderTagsIndexPage(topTags, {}, { defaultOgImage: "/og.png" });
  assert.match(html, /Top tags/);
  assert.match(html, /href="\/tags\/python\/"/);
  assert.match(html, /30 projects/);
  assert.match(html, /900,000/);
});

test("renderTagsIndexPage renders all three rising windows, only the 7-day one visible initially", () => {
  const risingTagsByWindow = {
    7: [{ tag: "rust", projectCount: 4, totalStars: 1000, rank: 1, growth: growth({ percentDelta: 5 }) }],
    30: [{ tag: "zig", projectCount: 4, totalStars: 1000, rank: 1, growth: growth({ percentDelta: 12 }) }],
    90: [{ tag: "go", projectCount: 4, totalStars: 1000, rank: 1, growth: growth({ percentDelta: 8 }) }],
  };
  const html = renderTagsIndexPage([], risingTagsByWindow, { defaultOgImage: "/og.png" });
  const day7 = html.match(/<div class="rising-rows" data-window="7">([\s\S]*?)<\/div>/)[1];
  const day30 = html.match(/<div class="rising-rows" data-window="30" hidden>([\s\S]*?)<\/div>/)[1];
  assert.match(day7, /rust/);
  assert.match(day30, /zig/);
});

test("renderTagsIndexPage shows a not-ready placeholder for a window with no eligible rising tags", () => {
  const html = renderTagsIndexPage([], { 7: [] }, { defaultOgImage: "/og.png" });
  assert.match(html, /Not enough star-history yet for this window\./);
});

test("renderTagsIndexPage shows a placeholder when there are no top tags at all", () => {
  const html = renderTagsIndexPage([], {}, { defaultOgImage: "/og.png" });
  assert.match(html, /No tags yet\./);
});

test("renderTagsIndexPage's canonical/og:url point at /tags/, respecting BASE_PATH", () => {
  const html = renderTagsIndexPage([], {}, { defaultOgImage: "/og.png", siteUrl: "https://awesomemap.dev", basePath: "/techmap" });
  assert.match(html, /rel="canonical" href="https:\/\/awesomemap\.dev\/techmap\/tags\/"/);
});

test("renderTagPage lists projects in the caller's order, with domain badges and star counts", () => {
  const projects = [
    { id: "a/a", name: "A", link: "https://a.example", weight: 500, image: "https://img/a.png", domainShort: "AI" },
    { id: "b/b", name: "B", link: "https://b.example", weight: 200, domainShort: "Web" },
  ];
  const html = renderTagPage("machine-learning", projects, { hasEnoughHistory: false, oldestDate: null }, { defaultOgImage: "/og.png" });
  assert.match(html, /<h1>machine-learning<\/h1>/);
  assert.match(html, /2 projects tagged/);
  assert.match(html, /★ 700 combined/);
  assert.match(html, /href="https:\/\/a\.example"/);
  assert.match(html, />AI</);
  assert.match(html, />Web</);
});

test("renderTagPage's rows include a + Compare toggle button carrying each project's id", () => {
  const projects = [{ id: "a/a", name: "A", link: "https://a.example", weight: 500, domainShort: "AI" }];
  const html = renderTagPage("machine-learning", projects, { hasEnoughHistory: false, oldestDate: null }, { defaultOgImage: "/og.png" });
  assert.match(html, /<button type="button" class="rising-row-compare compare-toggle" data-compare-id="a\/a" aria-pressed="false">\+ Compare<\/button>/);
});

test("renderTagPage shows the default-window growth stat when the tag group is tracked", () => {
  const projects = [{ id: "a/a", name: "A", link: "https://a.example", weight: 500 }];
  const html = renderTagPage("rust", projects, growth({ percentDelta: 3.2 }), { defaultOgImage: "/og.png" });
  assert.match(html, /\+3\.2%/);
});

test("renderTagPage reports 'Not tracked yet' rather than a fabricated 0% when the tag group has no history", () => {
  const projects = [{ id: "a/a", name: "A", link: "https://a.example", weight: 500 }];
  const html = renderTagPage("rust", projects, { hasEnoughHistory: false, oldestDate: null }, { defaultOgImage: "/og.png" });
  assert.match(html, /Not tracked yet/);
});

test("renderTagPage emits an ItemList JSON-LD block with a ListItem per linked project", () => {
  const projects = [{ id: "a/a", name: "A", link: "https://a.example", weight: 500 }];
  const html = renderTagPage("rust", projects, { hasEnoughHistory: false, oldestDate: null }, {
    defaultOgImage: "/og.png",
    siteUrl: "https://awesomemap.dev",
  });
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const jsonLd = JSON.parse(jsonLdMatch[1]);
  assert.equal(jsonLd["@type"], "ItemList");
  assert.equal(jsonLd.itemListElement[0].name, "A");
});

test("renderTagPage's canonical/og:url use tagSlug and respect BASE_PATH", () => {
  const html = renderTagPage("c++", [], { hasEnoughHistory: false, oldestDate: null }, {
    defaultOgImage: "/og.png",
    siteUrl: "https://awesomemap.dev",
    basePath: "/techmap",
  });
  assert.match(html, /rel="canonical" href="https:\/\/awesomemap\.dev\/techmap\/tags\/c%2B%2B\/"/);
});

test("renderTagPage handles a project with no link by falling back to '#' rather than throwing", () => {
  const projects = [{ id: "a/a", name: "A", weight: 500 }];
  assert.doesNotThrow(() => renderTagPage("rust", projects, { hasEnoughHistory: false, oldestDate: null }, { defaultOgImage: "/og.png" }));
});

const PROJECT = {
  id: "ggerganov/llama.cpp",
  name: "llama.cpp",
  desc: "Inference of LLaMA and other large language models in pure C/C++",
  weight: 125701,
  image: "https://avatars.githubusercontent.com/u/1?v=4",
  link: "https://github.com/ggerganov/llama.cpp",
  tags: ["ggml"],
  path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"],
  growth: {
    rising7: { starDelta: 500, percentDelta: 0.4, oldestDate: "2026-08-01" },
    rising30: { starDelta: 2000, percentDelta: 1.6, oldestDate: "2026-07-01" },
    rising90: { starDelta: 6000, percentDelta: 5.0, oldestDate: "2026-05-01" },
  },
  hasEnoughHistory: { rising7: true, rising30: true, rising90: true },
};

const PROJECT_DOMAIN = { slug: "artificial-intelligence", name: "Artificial Intelligence", shortName: "AI" };

const NO_SIGNAL = { sustained: null, relativeMultiple: null, headline: null };

test("renderProjectPage renders a momentum chip for each rising window", () => {
  const html = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png" });
  assert.match(html, /project-momentum-chip-window">7d</);
  assert.match(html, /project-momentum-chip-window">30d</);
  assert.match(html, /project-momentum-chip-window">90d</);
  assert.match(html, /\+500/);
  assert.match(html, /\+6,000/);
});

test("renderProjectPage renders the signal headline when present, and omits the element when null", () => {
  const withSignal = renderProjectPage(PROJECT, {
    domain: PROJECT_DOMAIN,
    signal: { sustained: true, relativeMultiple: 3.2, headline: "Growing steadily, 3.2× faster than LLM Infrastructure this week" },
    defaultOgImage: "/og-default.png",
  });
  assert.match(withSignal, /class="project-signal">Growing steadily, 3\.2× faster than LLM Infrastructure this week</);

  const withoutSignal = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png" });
  assert.doesNotMatch(withoutSignal, /class="project-signal"/);
});

test("renderProjectPage includes SoftwareSourceCode JSON-LD with the project's name, description, and GitHub URL", () => {
  const html = renderProjectPage(PROJECT, {
    domain: PROJECT_DOMAIN,
    signal: NO_SIGNAL,
    defaultOgImage: "/og-default.png",
    siteUrl: "https://example.com",
    basePath: "",
  });
  assert.match(html, /"@type":"SoftwareSourceCode"/);
  assert.match(html, /"name":"llama\.cpp"/);
  assert.match(html, /"codeRepository":"https:\/\/github\.com\/ggerganov\/llama\.cpp"/);
  assert.match(html, /"url":"https:\/\/example\.com\/projects\/ggerganov\/llama\.cpp\/"/);
});

test("renderProjectPage's breadcrumb links to the domain page and lists every level of the project's category path", () => {
  const html = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(html, /<a href="\/artificial-intelligence\/">AI<\/a>/);
  assert.match(html, />LLM Infrastructure<\/span>/);
  assert.match(html, />LLM Frameworks &amp; Runtimes<\/span>/);
});

test("renderProjectPage renders tag chips linking to /tags/<slug>/", () => {
  const html = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png", basePath: "" });
  assert.match(html, /class="detail-panel-tag" href="\/tags\/ggml\/">ggml</);
});

test("renderProjectPage renders a star-history sparkline when given at least two history points, and omits it otherwise", () => {
  const withHistory = renderProjectPage(PROJECT, {
    domain: PROJECT_DOMAIN,
    signal: NO_SIGNAL,
    defaultOgImage: "/og-default.png",
    historySeries: [
      { date: "2026-08-01", stars: 120000 },
      { date: "2026-08-08", stars: 125701 },
    ],
  });
  assert.match(withHistory, /class="detail-panel-star-chart"/);
  assert.match(withHistory, /125,701 stars since/);

  const withoutHistory = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png" });
  assert.doesNotMatch(withoutHistory, /class="detail-panel-star-chart"/);
});

test("renderProjectPage renders forks/open-issues chips from the latest history snapshot, and omits them when it lacks that data", () => {
  const withSnapshot = renderProjectPage(PROJECT, {
    domain: PROJECT_DOMAIN,
    signal: NO_SIGNAL,
    defaultOgImage: "/og-default.png",
    historySeries: [
      { date: "2026-08-01", stars: 120000, forks: 17000, openIssues: 340 },
      { date: "2026-08-08", stars: 125701, forks: 17420, openIssues: 356 },
    ],
  });
  assert.match(withSnapshot, /class="project-repo-stat-value">17,420<\/span>\s*<span class="project-repo-stat-label">Forks/);
  assert.match(withSnapshot, /class="project-repo-stat-value">356<\/span>\s*<span class="project-repo-stat-label">Open issues/);
  assert.match(withSnapshot, /href="https:\/\/github\.com\/ggerganov\/llama\.cpp\/network\/members"/);
  assert.match(withSnapshot, /href="https:\/\/github\.com\/ggerganov\/llama\.cpp\/issues"/);

  const withoutSnapshot = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png" });
  assert.doesNotMatch(withoutSnapshot, /Forks/);
  assert.doesNotMatch(withoutSnapshot, /Open issues/);
});

test("renderProjectPage renders an events timeline newest-first, and omits the section entirely when there are no events", () => {
  const withEvents = renderProjectPage(PROJECT, {
    domain: PROJECT_DOMAIN,
    signal: NO_SIGNAL,
    defaultOgImage: "/og-default.png",
    eventsSeries: [
      { date: "2026-07-01", type: "hn", title: "Show HN: llama.cpp", url: "https://hn/1", points: 312 },
      { date: "2026-08-07", type: "hn", title: "llama.cpp adds speculative decoding", url: "https://hn/2", points: 245 },
    ],
  });
  // Newest-first: the Aug post appears before the Jul post.
  const augIndex = withEvents.indexOf("llama.cpp adds speculative decoding");
  const julIndex = withEvents.indexOf("Show HN: llama.cpp");
  assert.ok(augIndex >= 0 && julIndex >= 0 && augIndex < julIndex);
  assert.match(withEvents, /href="https:\/\/hn\/1"/);
  assert.match(withEvents, /312 pts/);
  assert.match(withEvents, /Aug 7, 2026/);

  const withoutEvents = renderProjectPage(PROJECT, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png" });
  assert.doesNotMatch(withoutEvents, /class="project-events"/);
});

test("renderProjectPage degrades gracefully for a minimal project record with only an id", () => {
  const minimal = { id: "a/b" };
  const html = renderProjectPage(minimal, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png", basePath: "" });

  // Title falls back to id.
  assert.match(html, /<h1>a\/b<\/h1>/);
  // No tag-chip block.
  assert.doesNotMatch(html, /class="detail-panel-tags"/);
  // Has "+ Compare" link but no "Visit site" link.
  assert.match(html, />\+ Compare</);
  assert.doesNotMatch(html, /Visit site ↗/);
  // No hero image.
  assert.doesNotMatch(html, /class="detail-panel-logo"/);
  // Breadcrumb shows just Home + domain, no category crumbs.
  assert.match(html, /<nav class="project-breadcrumb"[^>]*><a href="\/">Home<\/a><span aria-hidden="true"> › <\/span><a href="\/artificial-intelligence\/">AI<\/a><\/nav>/);
});

test("renderProjectPage's canonical URL is shaped /projects/<id>/, and gets the BASE_PATH prefix", () => {
  const html = renderProjectPage(PROJECT, {
    domain: PROJECT_DOMAIN,
    signal: NO_SIGNAL,
    defaultOgImage: "/og-default.png",
    siteUrl: "https://example.com",
    basePath: "/techmap",
  });
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/techmap\/projects\/ggerganov\/llama\.cpp\/"/);
});

test("renderProjectPage's momentum chip reports 'not tracked yet' for a window with insufficient history", () => {
  const project = { ...PROJECT, hasEnoughHistory: { rising7: true, rising30: true, rising90: false } };
  const html = renderProjectPage(project, { domain: PROJECT_DOMAIN, signal: NO_SIGNAL, defaultOgImage: "/og-default.png" });
  assert.match(html, /Not tracked yet — first tracked 2026-05-01/);
});

test("renderProjectPage includes a + Compare toggle button carrying the project's own id", () => {
  const project = {
    id: "facebook/react",
    name: "React",
    path: ["Frontend Frameworks"],
    weight: 1000,
    growth: {},
    hasEnoughHistory: {},
  };
  const html = renderProjectPage(project, {
    domain: { slug: "web-dev", shortName: "Web Dev" },
    defaultOgImage: "/og-default.png",
    basePath: "/techmap",
  });
  assert.match(html, /data-compare-id="facebook\/react"/);
  assert.match(html, />\+ Compare</);
});

test("renderComparePage mounts compare.js against the compare index, prefixed by BASE_PATH", () => {
  const html = renderComparePage({ defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /import \{ mountCompare \} from "\/techmap\/shared\/compare.js"/);
  assert.match(html, /import \{ parseCompareIds, formatCompareIds \} from "\/techmap\/shared\/compare-url.js"/);
  assert.match(html, /compareIndexUrl: "\/techmap\/compare-index.json"/);
  assert.match(html, /<div id="app" class="compare-app"><\/div>/);
});

test("renderComparePage has a site header and footer and a canonical /compare/ URL", () => {
  const html = renderComparePage({ defaultOgImage: "/og-default.png", siteUrl: "https://awesomemap.dev", basePath: "" });
  assert.match(html, /class="site-header"/);
  assert.match(html, /class="site-footer"/);
  assert.match(html, /href="https:\/\/awesomemap.dev\/compare\/"/);
});

test("renderComparePage defaults to root-relative paths when basePath is empty", () => {
  const html = renderComparePage({ defaultOgImage: "/og-default.png" });
  assert.match(html, /from "\/shared\/compare.js"/);
  assert.match(html, /compareIndexUrl: "\/compare-index.json"/);
});

test("renderComparePage renders a static heading and description before the mount point", () => {
  const html = renderComparePage({ defaultOgImage: "/og-default.png" });
  assert.match(html, /<h1>Compare[^<]*<\/h1>/);
  assert.match(html, /<div id="app" class="compare-app">/);
  assert(html.indexOf("<h1>Compare") < html.indexOf('<div id="app" class="compare-app">'));
});

test("renderSearchPage mounts search.js against the compare index, prefixed by BASE_PATH", () => {
  const html = renderSearchPage({ defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /import \{ mountSearch \} from "\/techmap\/shared\/search.js"/);
  assert.match(html, /searchIndexUrl: "\/techmap\/compare-index.json"/);
  assert.match(html, /<div id="app" class="search-app"><\/div>/);
});

test("renderSearchPage has a site header and footer and a canonical /search/ URL", () => {
  const html = renderSearchPage({ defaultOgImage: "/og-default.png", siteUrl: "https://awesomemap.dev", basePath: "" });
  assert.match(html, /class="site-header"/);
  assert.match(html, /class="site-footer"/);
  assert.match(html, /href="https:\/\/awesomemap.dev\/search\/"/);
});

test("renderSearchPage defaults to root-relative paths when basePath is empty", () => {
  const html = renderSearchPage({ defaultOgImage: "/og-default.png" });
  assert.match(html, /from "\/shared\/search.js"/);
  assert.match(html, /searchIndexUrl: "\/compare-index.json"/);
});

test("renderSearchPage renders a static heading before the mount point", () => {
  const html = renderSearchPage({ defaultOgImage: "/og-default.png" });
  assert.match(html, /<h1>Search projects<\/h1>/);
  assert.match(html, /<div id="app" class="search-app">/);
  assert(html.indexOf("<h1>Search projects") < html.indexOf('<div id="app" class="search-app">'));
});

test("renderSiteHeader (via renderSearchPage) links to /search/", () => {
  const rootHtml = renderSearchPage({ defaultOgImage: "/og-default.png" });
  assert.match(rootHtml, /class="site-header-search" href="\/search\/"/);
  const prefixedHtml = renderSearchPage({ defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(prefixedHtml, /class="site-header-search" href="\/techmap\/search\/"/);
});

test("renderSubmitPage lists every domain's short name as a target-map option", () => {
  const html = renderSubmitPage({
    domains: [
      { slug: "web-dev", shortName: "Web Dev" },
      { slug: "data-science", shortName: "Data Science" },
    ],
    defaultOgImage: "/og-default.png",
  });
  assert.match(html, /<option value="Web Dev">Web Dev<\/option>/);
  assert.match(html, /<option value="Data Science">Data Science<\/option>/);
});

test("renderSubmitPage imports submit-project.js prefixed by BASE_PATH and has a site header/footer", () => {
  const html = renderSubmitPage({ domains: [], defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /import \{ normalizeProjectId, isValidProjectInput, buildSubmissionIssueUrl \} from "\/techmap\/shared\/submit-project\.js"/);
  assert.match(html, /class="site-header"/);
  assert.match(html, /class="site-footer"/);
});

test("renderSubmitPage's canonical URL and OG copy don't depend on any query string, matching renderComparePage's convention for a client-rendered page", () => {
  const html = renderSubmitPage({ domains: [], defaultOgImage: "/og-default.png", siteUrl: "https://awesomemap.dev", basePath: "" });
  assert.match(html, /href="https:\/\/awesomemap\.dev\/submit\/"/);
  assert.match(html, /<title>Suggest a project — awesomemap<\/title>/);
});

test("renderSiteHeader (via renderComparePage) links to /submit/", () => {
  const html = renderComparePage({ defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /href="\/techmap\/submit\/">Suggest a project</);
});

test("renderMethodologyPage has a site header and footer and a canonical /methodology/ URL", () => {
  const html = renderMethodologyPage({ defaultOgImage: "/og-default.png", siteUrl: "https://awesomemap.dev", basePath: "" });
  assert.match(html, /class="site-header"/);
  assert.match(html, /class="site-footer"/);
  assert.match(html, /href="https:\/\/awesomemap\.dev\/methodology\/"/);
  assert.match(html, /<title>How we rank — awesomemap<\/title>/);
});

test("renderMethodologyPage renders a static heading and every ranking section", () => {
  const html = renderMethodologyPage({ defaultOgImage: "/og-default.png" });
  assert.match(html, /<h1>How we rank<\/h1>/);
  assert.match(html, /Rising score/);
  assert.match(html, /Category growth/);
  assert.match(html, /This week's signals/);
  assert.match(html, /Biggest mover/);
  assert.match(html, /Unexpected breakout/);
  assert.match(html, /Heating up/);
  assert.match(html, /One to watch/);
});

test("renderMethodologyPage quotes the real ranking constants (7 / 30 / 90 windows, 5,000-star threshold), not hand-typed copies that could drift", () => {
  const html = renderMethodologyPage({ defaultOgImage: "/og-default.png" });
  assert.match(html, /7 \/ 30 \/ 90 days/);
  assert.match(html, /5,000 stars/);
});

test("renderSiteFooter (via renderMethodologyPage) links to /methodology/, prefixed by basePath", () => {
  const rootHtml = renderMethodologyPage({ defaultOgImage: "/og-default.png" });
  assert.match(rootHtml, /<footer class="site-footer">\s*<a href="\/methodology\/">How we rank<\/a>/);
  const prefixedHtml = renderSubmitPage({ domains: [], defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(prefixedHtml, /<a href="\/techmap\/methodology\/">How we rank<\/a>/);
});

test("renderSiteFooter links to /contact/, prefixed by basePath", () => {
  const rootHtml = renderMethodologyPage({ defaultOgImage: "/og-default.png" });
  assert.match(rootHtml, /<a href="\/contact\/">Contact us<\/a>/);
  const prefixedHtml = renderSubmitPage({ domains: [], defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(prefixedHtml, /<a href="\/techmap\/contact\/">Contact us<\/a>/);
});

test("renderSiteHeader shows the brand mark's svg inline, not just the wordmark", () => {
  const html = renderMethodologyPage({ defaultOgImage: "/og-default.png" });
  assert.match(html, /<a class="site-header-brand" href="\/">[\s\S]*?<svg class="site-header-logo"[\s\S]*?<\/svg>[\s\S]*?awesomemap[\s\S]*?<\/a>/);
});

test("renderSiteHeader includes a mobile menu toggle wired to the links panel via aria-controls", () => {
  const html = renderMethodologyPage({ defaultOgImage: "/og-default.png" });
  assert.match(html, /<button type="button" class="site-header-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="site-header-links"[^>]*>/);
  assert.match(html, /<div class="site-header-links" id="site-header-links">/);
});

test("renderContactPage has a site header/footer, a mailto-building form, and a canonical /contact/ URL", () => {
  const html = renderContactPage({ defaultOgImage: "/og-default.png", siteUrl: "https://awesomemap.dev", basePath: "" });
  assert.match(html, /class="site-header"/);
  assert.match(html, /class="site-footer"/);
  assert.match(html, /href="https:\/\/awesomemap\.dev\/contact\/"/);
  assert.match(html, /<title>Contact us — awesomemap<\/title>/);
  assert.match(html, /<form id="contact-form" class="contact-form">/);
  assert.match(html, /import \{ isValidContactInput, buildContactMailtoUrl \} from "\/shared\/contact-form\.js"/);
});

test("renderContactPage imports contact-form.js prefixed by BASE_PATH", () => {
  const html = renderContactPage({ defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /import \{ isValidContactInput, buildContactMailtoUrl \} from "\/techmap\/shared\/contact-form\.js"/);
});

