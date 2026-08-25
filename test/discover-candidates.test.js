import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchQuery,
  searchGithubByTopic,
  parseAwesomeListLinks,
  fetchAwesomeListCandidates,
  collectCandidateIds,
  excludeKnownIds,
  fetchRepoMetadata,
  passesQualityBar,
} from "../scripts/discover-candidates.mjs";

test("buildSearchQuery builds a GitHub search query scoped to a topic, min stars, not archived/fork", () => {
  assert.equal(buildSearchQuery("llm", { minStars: 500 }), "topic:llm stars:>500 archived:false fork:false");
});

test("buildSearchQuery defaults minStars to 500 when not given", () => {
  assert.equal(buildSearchQuery("rag"), "topic:rag stars:>500 archived:false fork:false");
});

test("searchGithubByTopic returns the raw result items from the search API", async () => {
  const calls = [];
  const getJson = async (url) => {
    calls.push(url);
    return { items: [{ full_name: "foo/bar" }, { full_name: "baz/qux" }] };
  };

  const items = await searchGithubByTopic("llm", { getJson, minStars: 500 });

  assert.deepEqual(items, [{ full_name: "foo/bar" }, { full_name: "baz/qux" }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/api\.github\.com\/search\/repositories\?q=/);
});

test("searchGithubByTopic returns an empty array when the search API returns no items field", async () => {
  const items = await searchGithubByTopic("llm", { getJson: async () => ({}) });
  assert.deepEqual(items, []);
});

test("parseAwesomeListLinks extracts owner/repo ids from github.com links", () => {
  const markdown = "- [React](https://github.com/facebook/react) - a UI library\n- [Vue](https://github.com/vuejs/vue)";
  assert.deepEqual(parseAwesomeListLinks(markdown), ["facebook/react", "vuejs/vue"]);
});

test("parseAwesomeListLinks dedupes repeated links", () => {
  const markdown = "https://github.com/facebook/react and again https://github.com/facebook/react";
  assert.deepEqual(parseAwesomeListLinks(markdown), ["facebook/react"]);
});

test("parseAwesomeListLinks strips a trailing sentence-ending period", () => {
  assert.deepEqual(parseAwesomeListLinks("See https://github.com/facebook/react."), ["facebook/react"]);
});

test("parseAwesomeListLinks ignores non-GitHub links", () => {
  const markdown = "https://gitlab.com/facebook/react and https://example.com/facebook/react";
  assert.deepEqual(parseAwesomeListLinks(markdown), []);
});

test("parseAwesomeListLinks ignores a relative link with no host", () => {
  assert.deepEqual(parseAwesomeListLinks("[React](/facebook/react)"), []);
});

test("parseAwesomeListLinks drops a link with extra path segments beyond owner/repo", () => {
  assert.deepEqual(parseAwesomeListLinks("https://github.com/facebook/react/tree/main/packages"), []);
});

test("fetchAwesomeListCandidates decodes the base64 README and extracts links", async () => {
  const markdown = "- https://github.com/facebook/react";
  const getJson = async (url) => {
    assert.equal(url, "https://api.github.com/repos/steven2358/awesome-generative-ai/readme");
    return { content: Buffer.from(markdown, "utf8").toString("base64"), encoding: "base64" };
  };

  assert.deepEqual(await fetchAwesomeListCandidates("steven2358/awesome-generative-ai", { getJson }), ["facebook/react"]);
});

test("fetchAwesomeListCandidates returns an empty array for an unparseable repo id, without calling getJson", async () => {
  const getJson = async () => {
    throw new Error("should not be called");
  };
  assert.deepEqual(await fetchAwesomeListCandidates("not-a-valid-id/with/extra/segments", { getJson }), []);
});

test("collectCandidateIds merges and dedups ids from search topics and awesome lists", async () => {
  const sourcesConfig = {
    "artificial-intelligence": { searchTopics: ["llm"], awesomeLists: ["steven2358/awesome-generative-ai"] },
  };
  const getJson = async (url) => {
    if (url.includes("/search/repositories")) return { items: [{ full_name: "foo/bar" }, { full_name: "shared/repo" }] };
    if (url.includes("/readme")) {
      const markdown = "https://github.com/shared/repo and https://github.com/baz/qux";
      return { content: Buffer.from(markdown, "utf8").toString("base64"), encoding: "base64" };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const ids = await collectCandidateIds("artificial-intelligence", sourcesConfig, { getJson });

  assert.deepEqual(new Set(ids), new Set(["foo/bar", "shared/repo", "baz/qux"]));
});

test("collectCandidateIds returns an empty array for a domain with no sources entry", async () => {
  const getJson = async () => {
    throw new Error("should not be called");
  };
  assert.deepEqual(await collectCandidateIds("no-such-domain", {}, { getJson }), []);
});

test("collectCandidateIds skips a failing source and keeps results from the rest", async () => {
  const sourcesConfig = { security: { searchTopics: ["security-tools"], awesomeLists: ["broken/awesome-list"] } };
  const getJson = async (url) => {
    if (url.includes("/search/repositories")) return { items: [{ full_name: "good/repo" }] };
    throw Object.assign(new Error("Not Found"), { status: 404 });
  };

  assert.deepEqual(await collectCandidateIds("security", sourcesConfig, { getJson }), ["good/repo"]);
});

test("excludeKnownIds drops ids already in the known set", () => {
  const known = new Set(["facebook/react", "vuejs/vue"]);
  assert.deepEqual(excludeKnownIds(["facebook/react", "new/repo", "vuejs/vue"], known), ["new/repo"]);
});

test("fetchRepoMetadata returns null for an unparseable id without calling getJson", async () => {
  const getJson = async () => {
    throw new Error("should not be called");
  };
  assert.equal(await fetchRepoMetadata("not/a/valid/id", { getJson }), null);
});

test("fetchRepoMetadata maps the GitHub repo response to the metadata shape", async () => {
  const getJson = async () => ({
    stargazers_count: 1200,
    fork: false,
    archived: false,
    pushed_at: "2026-08-01T00:00:00Z",
    license: { key: "mit" },
    description: "A test repo",
    topics: ["llm", "rag"],
  });

  assert.deepEqual(await fetchRepoMetadata("foo/bar", { getJson }), {
    id: "foo/bar",
    stars: 1200,
    isFork: false,
    isArchived: false,
    pushedAt: "2026-08-01T00:00:00Z",
    hasLicense: true,
    description: "A test repo",
    topics: ["llm", "rag"],
  });
});

test("fetchRepoMetadata sets hasLicense false and description \"\" when GitHub reports neither", async () => {
  const getJson = async () => ({ stargazers_count: 10, fork: false, archived: false, pushed_at: "2026-01-01T00:00:00Z", license: null, description: null, topics: [] });
  const meta = await fetchRepoMetadata("foo/bar", { getJson });
  assert.equal(meta.hasLicense, false);
  assert.equal(meta.description, "");
});

test("passesQualityBar accepts a repo clearing every threshold", () => {
  const meta = { stars: 1000, isFork: false, isArchived: false, hasLicense: true, pushedAt: "2026-08-01T00:00:00Z" };
  assert.equal(passesQualityBar(meta, { now: new Date("2026-08-25T00:00:00Z") }), true);
});

test("passesQualityBar rejects below the minimum star count", () => {
  const meta = { stars: 100, isFork: false, isArchived: false, hasLicense: true, pushedAt: "2026-08-01T00:00:00Z" };
  assert.equal(passesQualityBar(meta, { minStars: 500, now: new Date("2026-08-25T00:00:00Z") }), false);
});

test("passesQualityBar rejects a fork", () => {
  const meta = { stars: 1000, isFork: true, isArchived: false, hasLicense: true, pushedAt: "2026-08-01T00:00:00Z" };
  assert.equal(passesQualityBar(meta, { now: new Date("2026-08-25T00:00:00Z") }), false);
});

test("passesQualityBar rejects an archived repo", () => {
  const meta = { stars: 1000, isFork: false, isArchived: true, hasLicense: true, pushedAt: "2026-08-01T00:00:00Z" };
  assert.equal(passesQualityBar(meta, { now: new Date("2026-08-25T00:00:00Z") }), false);
});

test("passesQualityBar rejects a repo with no license", () => {
  const meta = { stars: 1000, isFork: false, isArchived: false, hasLicense: false, pushedAt: "2026-08-01T00:00:00Z" };
  assert.equal(passesQualityBar(meta, { now: new Date("2026-08-25T00:00:00Z") }), false);
});

test("passesQualityBar rejects a repo inactive for longer than maxInactiveMonths", () => {
  const meta = { stars: 1000, isFork: false, isArchived: false, hasLicense: true, pushedAt: "2024-01-01T00:00:00Z" };
  assert.equal(passesQualityBar(meta, { maxInactiveMonths: 12, now: new Date("2026-08-25T00:00:00Z") }), false);
});
