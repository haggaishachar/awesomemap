import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDomainPage, renderLandingPage, renderRisingPage } from "../scripts/render-page.mjs";

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
  assert.match(rootHtml, /createDetailPanel\(document\.body, \{ historyUrl: "\/data-science\/history\.json" \}\)/);

  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(
    prefixedHtml,
    /createDetailPanel\(document\.body, \{ historyUrl: "\/techmap\/data-science\/history\.json" \}\)/
  );
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
  assert.match(html, /<a class="rising-row-name" href="https:\/\/a\.example">Project A<\/a>/);
  assert.match(html, /rising-row-up">▲1<\/span>/);
  assert.match(html, /\+40 \(\+40\.0%\)/);
});

test("renderRisingPage's rows show the repo id and the domain's short name", () => {
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

test("renderRisingPage's domain sections are anchorable by slug and link to that domain's page", () => {
  const domains = [{ slug: "data-science", name: "Data Science" }];
  const leaderboardsByWindow = {
    7: { global: [], "data-science": [] },
    30: { global: [], "data-science": [] },
    90: { global: [], "data-science": [] },
  };
  const html = renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(html, /<section class="rising-section" id="data-science">/);
  assert.match(html, /<a href="\/techmap\/data-science\/">Data Science<\/a>/);
});

test("renderDomainPage renders a teaser section below the map, linking to that domain's rising anchor", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const teaser = [{ rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", teaser });
  assert.match(html, /class="rising-teaser-link" href="\/rising\/#data-science"/);
  assert.ok(html.indexOf('id="app"') < html.indexOf('class="rising-teaser"'));
});

test("renderDomainPage's embed variant has no teaser section", () => {
  const domain = { slug: "data-science", name: "Data Science", description: "desc" };
  const teaser = [{ rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0 }];
  const html = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", embed: true, teaser });
  assert.doesNotMatch(html, /rising-teaser/);
});

test("renderLandingPage renders a global teaser section between the hero and the map grid", () => {
  const teaser = [{ rank: 1, id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 40, percentDelta: 40, rankDelta: 0 }];
  const html = renderLandingPage([{ slug: "data-science", name: "Data Science", description: "desc" }], { defaultOgImage: "/og-default.png", teaser });
  assert.match(html, /class="rising-teaser-link" href="\/rising\/"/);
  assert.ok(html.indexOf('class="hero"') < html.indexOf('class="rising-teaser"'));
  assert.ok(html.indexOf('class="rising-teaser"') < html.indexOf('class="map-grid"'));
});

test("renderLandingPage's hero includes a quick-jump link per domain, using its short name", () => {
  const domains = [
    { slug: "artificial-intelligence", name: "Best Artificial Intelligence Open Source Projects", shortName: "AI", description: "desc" },
    { slug: "security", name: "Best Security Open Source Projects", shortName: "Security", description: "desc" },
  ];
  const html = renderLandingPage(domains, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(
    html,
    /<a class="domain-quicklink" href="\/techmap\/rising\/#artificial-intelligence" title="Best Artificial Intelligence Open Source Projects">AI<\/a>/
  );
  assert.match(html, /<a class="domain-quicklink" href="\/techmap\/rising\/#security" title="Best Security Open Source Projects">Security<\/a>/);
  assert.ok(html.indexOf('class="domain-quicklinks"') < html.indexOf('class="map-grid"'));
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
