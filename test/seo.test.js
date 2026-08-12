import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSitemap, buildRobots } from "../scripts/seo.mjs";

test("buildSitemap lists the landing page and every domain page", () => {
  const xml = buildSitemap(["data-science", "security"], {
    siteUrl: "https://haggaishachar.github.io",
    basePath: "/awesomemap",
  });
  assert.match(xml, /<loc>https:\/\/haggaishachar\.github\.io\/awesomemap\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/haggaishachar\.github\.io\/awesomemap\/data-science\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/haggaishachar\.github\.io\/awesomemap\/security\/<\/loc>/);
});

test("buildSitemap excludes embed pages", () => {
  const xml = buildSitemap(["data-science"], { siteUrl: "https://example.com", basePath: "" });
  assert.doesNotMatch(xml, /\/embed\//);
});

test("buildSitemap returns null when siteUrl is empty", () => {
  assert.equal(buildSitemap(["data-science"], { siteUrl: "", basePath: "" }), null);
});

test("buildRobots points at the sitemap when siteUrl is set", () => {
  const robots = buildRobots({ siteUrl: "https://haggaishachar.github.io", basePath: "/awesomemap" });
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Sitemap: https:\/\/haggaishachar\.github\.io\/awesomemap\/sitemap\.xml/);
});

test("buildRobots omits the Sitemap directive when siteUrl is empty", () => {
  const robots = buildRobots({ siteUrl: "", basePath: "" });
  assert.match(robots, /Allow: \//);
  assert.doesNotMatch(robots, /Sitemap:/);
});
