import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSitemap, buildRobots, buildWebsiteJsonLd, buildItemListJsonLd, buildSoftwareSourceCodeJsonLd } from "../scripts/seo.mjs";

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

test("buildSitemap lists the rising leaderboard page", () => {
  const xml = buildSitemap(["data-science"], { siteUrl: "https://example.com", basePath: "" });
  assert.match(xml, /<loc>https:\/\/example\.com\/rising\/<\/loc>/);
});

test("buildWebsiteJsonLd returns a schema.org WebSite object with the given name/description/url", () => {
  const jsonLd = buildWebsiteJsonLd({ name: "awesomemap", description: "desc", url: "https://example.com/" });
  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(jsonLd["@type"], "WebSite");
  assert.equal(jsonLd.name, "awesomemap");
  assert.equal(jsonLd.description, "desc");
  assert.equal(jsonLd.url, "https://example.com/");
});

test("buildItemListJsonLd lists one ListItem per project that has a link, in order, 1-indexed", () => {
  const projects = [
    { id: "a/a", name: "Project A", link: "https://a.example" },
    { id: "b/b", name: "Project B", link: "https://b.example" },
  ];
  const jsonLd = buildItemListJsonLd("Data Science", projects, { url: "https://example.com/data-science/" });
  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(jsonLd["@type"], "ItemList");
  assert.equal(jsonLd.name, "Data Science");
  assert.equal(jsonLd.url, "https://example.com/data-science/");
  assert.deepEqual(jsonLd.itemListElement, [
    { "@type": "ListItem", position: 1, name: "Project A", url: "https://a.example" },
    { "@type": "ListItem", position: 2, name: "Project B", url: "https://b.example" },
  ]);
});

test("buildItemListJsonLd omits projects with no link rather than guessing a URL", () => {
  const projects = [
    { id: "a/a", name: "Project A", link: "https://a.example" },
    { id: "b/b", name: "Project B" },
  ];
  const jsonLd = buildItemListJsonLd("Data Science", projects, { url: "https://example.com/data-science/" });
  assert.equal(jsonLd.itemListElement.length, 1);
  assert.equal(jsonLd.itemListElement[0].name, "Project A");
});

test("buildItemListJsonLd falls back to a project's id when name is omitted", () => {
  const projects = [{ id: "a/a", link: "https://a.example" }];
  const jsonLd = buildItemListJsonLd("Data Science", projects, { url: "https://example.com/data-science/" });
  assert.equal(jsonLd.itemListElement[0].name, "a/a");
});

test("buildSitemap appends extraPaths after the domain pages", () => {
  const xml = buildSitemap(["data-science"], {
    siteUrl: "https://example.com",
    basePath: "",
    extraPaths: ["/tags/", "/tags/python/"],
  });
  assert.match(xml, /<loc>https:\/\/example\.com\/tags\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.com\/tags\/python\/<\/loc>/);
});

test("buildSitemap defaults extraPaths to empty, unchanged output when omitted", () => {
  const xml = buildSitemap(["data-science"], { siteUrl: "https://example.com", basePath: "" });
  assert.doesNotMatch(xml, /\/tags\//);
});

test("buildSoftwareSourceCodeJsonLd returns a schema.org SoftwareSourceCode object", () => {
  const jsonLd = buildSoftwareSourceCodeJsonLd({
    name: "llama.cpp",
    description: "Inference of LLaMA and other large language models in pure C/C++",
    url: "https://example.com/projects/ggerganov/llama.cpp/",
    codeRepository: "https://github.com/ggerganov/llama.cpp",
  });
  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(jsonLd["@type"], "SoftwareSourceCode");
  assert.equal(jsonLd.name, "llama.cpp");
  assert.equal(jsonLd.description, "Inference of LLaMA and other large language models in pure C/C++");
  assert.equal(jsonLd.url, "https://example.com/projects/ggerganov/llama.cpp/");
  assert.equal(jsonLd.codeRepository, "https://github.com/ggerganov/llama.cpp");
});
