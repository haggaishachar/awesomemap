import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDomainPage, renderLandingPage } from "../scripts/render-page.mjs";

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
  assert.match(rootHtml, /href="\/">&larr; All maps<\/a>/);
  assert.match(rootHtml, /import \{ mountTreemap \} from "\/shared\/treemap.js"/);

  const prefixedHtml = renderDomainPage(domain, ROOT_TREE, { defaultOgImage: "/og-default.png", basePath: "/techmap" });
  assert.match(prefixedHtml, /href="\/techmap\/shared\/treemap.css"/);
  assert.match(prefixedHtml, /"d3-hierarchy": "\/techmap\/vendor\/d3-hierarchy\/index.js"/);
  assert.match(prefixedHtml, /href="\/techmap\/">&larr; All maps<\/a>/);
  assert.match(prefixedHtml, /import \{ mountTreemap \} from "\/techmap\/shared\/treemap.js"/);
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
