# Daily Project Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daily scheduled job that discovers candidate open-source projects, classifies each into an existing domain's category/subcategory, auto-commits the ones it's confident about, and opens a review issue for everything else.

**Architecture:** Four new pure-function-first `scripts/*.mjs` modules (discovery, classification, routing, orchestration) mirroring the existing `enrich-domain.mjs`/`snapshot-history.mjs`/`social-digest.mjs` style — exported pure functions with injected I/O, a thin unexported `main()` for the CLI entry point — wired into a new daily GitHub Actions workflow that commits qualifying additions and opens a GitHub issue for the rest.

**Tech Stack:** Node.js (ESM `.mjs`), `node:test` + `node:assert/strict`, raw `fetch` (no new npm dependency), `gh` CLI (`execFileSync`), GitHub Actions, OpenRouter API (`google/gemini-3.7-flash`).

**Spec:** `docs/superpowers/specs/2026-08-25-daily-project-discovery-design.md`

## Global Constraints

- No new runtime dependency — every network call is raw `fetch`, matching every existing script in `scripts/`.
- Quality bar for auto-commit eligibility: `minStars = 500`, `maxInactiveMonths = 12`, not a fork, not archived, has a license.
- Auto-commit gate: `minConfidence = 0.8`, `dailyCap = 3` per domain per day, highest-confidence candidates first.
- Never auto-creates a new category/subcategory and never proposes a new domain — both always route to the review issue.
- `data/discovery/sources.json` and `data/discovery/seen.json` live in a `data/discovery/` subdirectory, **not** directly in `data/` — `generate.mjs`, `snapshot-history.mjs`, and `social-digest.mjs` all treat every top-level `data/*.json` file as a domain map, so a config file there directly would break the site build.
- `OPENROUTER_API_KEY` repo secret and the `discovery` GitHub label already exist on `haggaishachar/awesomemap` (set up during spec-writing) — no task needs to create them.
- OpenRouter model defaults to the `OPENROUTER_MODEL` env var, falling back to `google/gemini-3.7-flash`.
- Tests never hit the real network or a real LLM — every `getJson`/`fetchImpl`/`callLlm` is injected, same pattern `enrich-domain.test.js` already uses.

---

## Task 1: Seed `data/discovery/sources.json`

**Files:**
- Create: `data/discovery/sources.json`

**Interfaces:**
- Produces: a JSON object keyed by domain slug, each value `{ searchTopics: string[], awesomeLists: string[] }` — this is the config `collectCandidateIds` (Task 2) reads.

- [ ] **Step 1: Write the seed file**

Every `awesomeLists` entry below was verified to exist via `curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/<id>` (all returned `200`) while writing this plan.

```json
{
  "artificial-intelligence": {
    "searchTopics": ["llm", "rag", "vector-database", "ai-agents"],
    "awesomeLists": ["steven2358/awesome-generative-ai"]
  },
  "data-science": {
    "searchTopics": ["machine-learning", "deep-learning", "nlp", "computer-vision"],
    "awesomeLists": ["josephmisiti/awesome-machine-learning"]
  },
  "security": {
    "searchTopics": ["security-tools", "penetration-testing", "siem", "forensics"],
    "awesomeLists": ["sbilly/awesome-security"]
  },
  "web-dev": {
    "searchTopics": ["frontend", "web-framework", "css", "build-tool"],
    "awesomeLists": ["sorrycc/awesome-javascript"]
  },
  "mobile-dev": {
    "searchTopics": ["cross-platform", "react-native", "flutter", "mobile-testing"],
    "awesomeLists": ["jondot/awesome-react-native"]
  },
  "devops-infra": {
    "searchTopics": ["kubernetes", "ci-cd", "infrastructure-as-code", "observability"],
    "awesomeLists": ["AcalephStorage/awesome-devops"]
  },
  "databases": {
    "searchTopics": ["database", "nosql", "caching", "data-streaming"],
    "awesomeLists": ["numetriclabz/awesome-db"]
  },
  "automation": {
    "searchTopics": ["workflow-automation", "no-code", "rpa", "low-code"],
    "awesomeLists": ["dariubs/awesome-workflow-automation"]
  },
  "smart-home": {
    "searchTopics": ["home-automation", "iot", "embedded", "robotics"],
    "awesomeLists": ["frenck/awesome-home-assistant"]
  }
}
```

- [ ] **Step 2: Verify it's valid JSON and keyed by every current domain slug**

Run: `node -e "const s = JSON.parse(require('fs').readFileSync('data/discovery/sources.json')); const domains = require('fs').readdirSync('data').filter(f => f.endsWith('.json')).map(f => require('./data/' + f).slug); console.log(domains.every(d => s[d]) ? 'OK: all domains covered' : 'MISSING: ' + domains.filter(d => !s[d]))"`
Expected: `OK: all domains covered`

- [ ] **Step 3: Commit**

```bash
git add data/discovery/sources.json
git commit -m "feat: seed discovery source config for every domain"
```

---

## Task 2: `scripts/discover-candidates.mjs`

**Files:**
- Create: `scripts/discover-candidates.mjs`
- Test: `test/discover-candidates.test.js`

**Interfaces:**
- Consumes: `parseGhRepo` from `scripts/enrich-domain.mjs` (existing — `parseGhRepo(shorthand) => { owner, repo } | null`).
- Produces:
  - `buildSearchQuery(topic, { minStars? }) => string`
  - `searchGithubByTopic(topic, { getJson, minStars? }) => Promise<object[]>`
  - `parseAwesomeListLinks(readmeMarkdown) => string[]`
  - `fetchAwesomeListCandidates(repoId, { getJson }) => Promise<string[]>`
  - `collectCandidateIds(domainSlug, sourcesConfig, { getJson }) => Promise<string[]>`
  - `excludeKnownIds(candidateIds, knownIds: Set<string>) => string[]`
  - `fetchRepoMetadata(id, { getJson }) => Promise<{ id, stars, isFork, isArchived, pushedAt, hasLicense, description, topics } | null>`
  - `passesQualityBar(meta, { minStars?, maxInactiveMonths?, now? }) => boolean`
  - Used by Task 5 (`discover-projects.mjs`).

- [ ] **Step 1: Write the failing test file**

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/discover-candidates.test.js`
Expected: FAIL — `Cannot find module '../scripts/discover-candidates.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
import { parseGhRepo } from "./enrich-domain.mjs";

const GITHUB_LINK_PATTERN = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_STARS = 500;
const DEFAULT_MAX_INACTIVE_MONTHS = 12;

/**
 * Builds a GitHub Search Repositories API query string scoping a topic
 * search to repos likely worth considering: a minimum star count, not
 * archived, not a fork. Pure string construction; `searchGithubByTopic`
 * does the actual HTTP call.
 */
export function buildSearchQuery(topic, { minStars = DEFAULT_MIN_STARS } = {}) {
  return `topic:${topic} stars:>${minStars} archived:false fork:false`;
}

/**
 * Calls the GitHub Search Repositories API for one topic and returns the
 * raw result items (each has at least `full_name`). `getJson` is injected
 * (same pattern as enrich-domain.mjs) so tests never hit the real network.
 */
export async function searchGithubByTopic(topic, { getJson, minStars = DEFAULT_MIN_STARS }) {
  const query = encodeURIComponent(buildSearchQuery(topic, { minStars }));
  const result = await getJson(`https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc`);
  return result.items ?? [];
}

/**
 * Extracts `owner/repo` ids from every `github.com/<owner>/<repo>` link in
 * a Markdown string (an awesome-list README), deduped and in first-seen
 * order. A trailing sentence-ending period is stripped before validation;
 * `parseGhRepo` rejects anything else malformed (extra path segments,
 * etc.) so it's the single source of truth for what counts as a valid id.
 */
export function parseAwesomeListLinks(readmeMarkdown) {
  const seen = new Set();
  const ids = [];
  for (const match of readmeMarkdown.matchAll(GITHUB_LINK_PATTERN)) {
    const owner = match[1];
    const repo = match[2].replace(/\.$/, "");
    const parsed = parseGhRepo(`${owner}/${repo}`);
    if (!parsed) continue;
    const normalized = `${parsed.owner}/${parsed.repo}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

/**
 * Fetches an awesome-list repo's README (GitHub contents API, base64
 * response) and extracts every GitHub repo link from it via
 * `parseAwesomeListLinks`. Returns an empty array (no network call) for
 * an unparseable `repoId`, matching `enrichProject`'s convention in
 * enrich-domain.mjs of leaving non-GitHub-shorthand ids alone.
 */
export async function fetchAwesomeListCandidates(repoId, { getJson }) {
  const repo = parseGhRepo(repoId);
  if (!repo) return [];
  const entry = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/readme`);
  const markdown = Buffer.from(entry.content, entry.encoding ?? "base64").toString("utf8");
  return parseAwesomeListLinks(markdown);
}

/**
 * Gathers and dedups candidate ids for one domain from both configured
 * sources (GitHub topic search + awesome-list README parsing), per
 * `sourcesConfig[domainSlug]`. A domain with no config entry yields no
 * candidates. A single source failing (network error, a since-deleted
 * awesome-list repo) is logged and skipped, not fatal to the whole
 * domain — matches the per-item try/catch convention `enrich-domain.mjs`
 * already uses.
 */
export async function collectCandidateIds(domainSlug, sourcesConfig, { getJson }) {
  const config = sourcesConfig[domainSlug];
  if (!config) return [];

  const ids = new Set();

  for (const topic of config.searchTopics ?? []) {
    try {
      const items = await searchGithubByTopic(topic, { getJson });
      for (const item of items) ids.add(item.full_name);
    } catch (err) {
      console.error(`Warning: search for topic "${topic}" (${domainSlug}) failed: ${err.message}`);
    }
  }

  for (const awesomeListId of config.awesomeLists ?? []) {
    try {
      const candidates = await fetchAwesomeListCandidates(awesomeListId, { getJson });
      for (const id of candidates) ids.add(id);
    } catch (err) {
      console.error(`Warning: awesome-list "${awesomeListId}" (${domainSlug}) failed: ${err.message}`);
    }
  }

  return [...ids];
}

/**
 * Pure filter: drops any candidate id already in `knownIds` (the union of
 * every id already listed in any domain, plus every id already evaluated
 * by a previous discovery run — computed once by the caller).
 */
export function excludeKnownIds(candidateIds, knownIds) {
  return candidateIds.filter((id) => !knownIds.has(id));
}

/**
 * Fetches GitHub repo metadata needed for quality-bar filtering and
 * classification. Returns null (not thrown) when `id` isn't a parseable
 * owner/repo shorthand — a defensive guard, not an expected path, since
 * every discovered id already comes from a real GitHub API response.
 */
export async function fetchRepoMetadata(id, { getJson }) {
  const repo = parseGhRepo(id);
  if (!repo) return null;
  const data = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
  return {
    id,
    stars: data.stargazers_count,
    isFork: data.fork,
    isArchived: data.archived,
    pushedAt: data.pushed_at,
    hasLicense: data.license != null,
    description: data.description ?? "",
    topics: data.topics ?? [],
  };
}

/**
 * Pure quality gate: a candidate must clear a minimum star count, not be a
 * fork or archived, carry a license, and have pushed within the last
 * `maxInactiveMonths` months. Runs *before* any LLM classification call,
 * so tokens are never spent on repos that wouldn't qualify anyway.
 */
export function passesQualityBar(meta, { minStars = DEFAULT_MIN_STARS, maxInactiveMonths = DEFAULT_MAX_INACTIVE_MONTHS, now = new Date() } = {}) {
  if (meta.stars < minStars) return false;
  if (meta.isFork) return false;
  if (meta.isArchived) return false;
  if (!meta.hasLicense) return false;
  const cutoff = new Date(now).getTime() - maxInactiveMonths * 30 * MS_PER_DAY;
  return new Date(meta.pushedAt).getTime() >= cutoff;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/discover-candidates.test.js`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add scripts/discover-candidates.mjs test/discover-candidates.test.js
git commit -m "feat: add discovery candidate gathering + quality bar"
```

---

## Task 3: `scripts/classify-candidates.mjs`

**Files:**
- Create: `scripts/classify-candidates.mjs`
- Test: `test/classify-candidates.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (standalone module).
- Produces:
  - `buildCategoryTree(domain) => string[]`
  - `buildClassificationPrompt(domain, categoryTree, candidates) => { system: string, candidatesText: string }`
  - `callOpenRouterApi(prompt, { apiKey, model?, fetchImpl? }) => Promise<Array<{ id, fits, path?, confidence, suggestedNewCategory?, reason }>>`
  - `classifyCandidates(domain, candidates, { callLlm }) => Promise<Array<{ id, fits: boolean|null, path: string[]|null, confidence: number, suggestedNewCategory: string|null, reason: string }>>` — used by Task 5. `candidates` items need at least `{ id, description, topics }` (the shape `fetchRepoMetadata` from Task 2 produces).

- [ ] **Step 1: Write the failing test file**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCategoryTree, buildClassificationPrompt, callOpenRouterApi, classifyCandidates } from "../scripts/classify-candidates.mjs";

const domain = {
  slug: "artificial-intelligence",
  name: "Best Artificial Intelligence Open Source Projects",
  description: "LLM frameworks, AI agents, RAG, vector databases, coding assistants, and more.",
  projects: [
    { id: "a/a", path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"] },
    { id: "b/b", path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"] },
    { id: "c/c", path: ["Agents & Coding", "Orchestration Frameworks"] },
  ],
};

test("buildCategoryTree dedups project paths into sorted breadcrumb strings", () => {
  assert.deepEqual(buildCategoryTree(domain), ["Agents & Coding / Orchestration Frameworks", "LLM Infrastructure / LLM Frameworks & Runtimes"]);
});

test("buildClassificationPrompt includes the domain description, category tree, and every candidate", () => {
  const categoryTree = ["LLM Infrastructure / LLM Frameworks & Runtimes"];
  const candidates = [{ id: "foo/bar", description: "A test LLM tool", topics: ["llm"] }];

  const { system, candidatesText } = buildClassificationPrompt(domain, categoryTree, candidates);

  assert.match(system, /LLM frameworks, AI agents, RAG/);
  assert.match(system, /LLM Infrastructure \/ LLM Frameworks & Runtimes/);
  assert.match(candidatesText, /foo\/bar/);
  assert.match(candidatesText, /A test LLM tool/);
});

test("callOpenRouterApi posts to the chat completions endpoint with a forced classify_candidates tool call and parses its arguments", async () => {
  let capturedBody;
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "classify_candidates", arguments: JSON.stringify({ classifications: [{ id: "foo/bar", fits: true, confidence: 0.9, reason: "fits" }] }) } },
              ],
            },
          },
        ],
      }),
    };
  };

  const result = await callOpenRouterApi({ system: "sys", candidatesText: "candidates" }, { apiKey: "test-key", fetchImpl });

  assert.deepEqual(result, [{ id: "foo/bar", fits: true, confidence: 0.9, reason: "fits" }]);
  assert.equal(capturedBody.tool_choice.function.name, "classify_candidates");
  assert.equal(capturedBody.messages[0].content, "sys");
});

test("callOpenRouterApi defaults to the google/gemini-3.7-flash model when OPENROUTER_MODEL is unset", async () => {
  const previous = process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MODEL;
  let capturedBody;
  const fetchImpl = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "classify_candidates", arguments: '{"classifications":[]}' } }] } }] }) };
  };

  await callOpenRouterApi({ system: "sys", candidatesText: "c" }, { apiKey: "k", fetchImpl });

  assert.equal(capturedBody.model, "google/gemini-3.7-flash");
  if (previous !== undefined) process.env.OPENROUTER_MODEL = previous;
});

test("callOpenRouterApi throws on a non-ok response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, statusText: "Server Error" });
  await assert.rejects(() => callOpenRouterApi({ system: "s", candidatesText: "c" }, { apiKey: "k", fetchImpl }), /500/);
});

test("classifyCandidates passes through a well-formed response", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => [{ id: "foo/bar", fits: true, path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"], confidence: 0.9, reason: "great fit" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.deepEqual(result, [
    { id: "foo/bar", fits: true, path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"], confidence: 0.9, suggestedNewCategory: null, reason: "great fit" },
  ]);
});

test("classifyCandidates accepts a suggestedNewCategory with no existing-path match", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => [{ id: "foo/bar", fits: true, confidence: 0.7, suggestedNewCategory: "Fine-Tuning Tools", reason: "no existing category fits" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.equal(result[0].suggestedNewCategory, "Fine-Tuning Tools");
});

test("classifyCandidates falls back to fits:null for a candidate missing from the response", async () => {
  const candidates = [
    { id: "foo/bar", description: "d", topics: [] },
    { id: "missing/one", description: "d", topics: [] },
  ];
  const callLlm = async () => [{ id: "foo/bar", fits: true, path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"], confidence: 0.9, reason: "fits" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.deepEqual(result[1], { id: "missing/one", fits: null, path: null, confidence: 0, suggestedNewCategory: null, reason: "unparseable classification" });
});

test("classifyCandidates falls back to fits:null for an out-of-range confidence", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => [{ id: "foo/bar", fits: true, path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"], confidence: 1.5, reason: "fits" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.equal(result[0].fits, null);
  assert.equal(result[0].reason, "unparseable classification");
});

test("classifyCandidates falls back to fits:null for a path that neither matches an existing category nor carries suggestedNewCategory", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => [{ id: "foo/bar", fits: true, path: ["Made Up Category"], confidence: 0.9, reason: "fits" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.equal(result[0].fits, null);
});

test("classifyCandidates falls back to fits:null for fits:true with neither path nor suggestedNewCategory (would otherwise auto-commit with path: null)", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => [{ id: "foo/bar", fits: true, confidence: 0.9, reason: "fits, somehow" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.equal(result[0].fits, null);
  assert.equal(result[0].reason, "unparseable classification");
});

test("classifyCandidates propagates a whole-call failure (caller retries/skips the domain, not a per-candidate fallback)", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => {
    throw new Error("network down");
  };

  await assert.rejects(() => classifyCandidates(domain, candidates, { callLlm }), /network down/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/classify-candidates.test.js`
Expected: FAIL — `Cannot find module '../scripts/classify-candidates.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
const DEFAULT_MODEL = "google/gemini-3.7-flash";

const CLASSIFY_TOOL = {
  type: "function",
  function: {
    name: "classify_candidates",
    description: "Classify each candidate project into the domain's existing category tree, or flag that it needs a new category.",
    parameters: {
      type: "object",
      properties: {
        classifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              fits: { type: "boolean" },
              path: { type: "array", items: { type: "string" } },
              confidence: { type: "number" },
              suggestedNewCategory: { type: "string" },
              reason: { type: "string" },
            },
            required: ["id", "fits", "confidence", "reason"],
          },
        },
      },
      required: ["classifications"],
    },
  },
};

/**
 * Dedups every `path` array already present in a domain's projects into a
 * sorted, "/"-joined breadcrumb list (e.g. "LLM Infrastructure / LLM
 * Frameworks & Runtimes"), for embedding in the classification prompt and
 * for validating the LLM's response against real categories.
 */
export function buildCategoryTree(domain) {
  const seen = new Set(domain.projects.map((project) => project.path.join(" / ")));
  return [...seen].sort();
}

/**
 * Builds the { system, candidatesText } content for one domain's
 * classification request: the domain's name/description, its existing
 * category tree, and every candidate's id/description/topics. Kept as
 * plain strings rather than a provider-specific message shape, so
 * `callOpenRouterApi` is the only place that knows the request format.
 */
export function buildClassificationPrompt(domain, categoryTree, candidates) {
  const system = [
    `You are classifying candidate GitHub projects for the "${domain.name}" map on awesomemap.dev.`,
    `Domain description: ${domain.description}`,
    "",
    "Existing categories (breadcrumb paths from root to leaf):",
    ...categoryTree.map((path) => `- ${path}`),
    "",
    "For each candidate, decide whether it genuinely fits this domain. If it does, pick the existing category path that fits best, reusing one exactly as listed above whenever possible. If none fits well, omit path and set suggestedNewCategory to a short new category name instead. Always include a confidence score from 0 to 1 and a one-sentence reason.",
  ].join("\n");

  const candidatesText = candidates.map((c) => `id: ${c.id}\ndescription: ${c.description}\ntopics: ${(c.topics ?? []).join(", ")}`).join("\n\n");

  return { system, candidatesText };
}

/**
 * Calls OpenRouter's OpenAI-compatible chat-completions endpoint, forcing
 * a `classify_candidates` tool call so the response is always structured
 * JSON, never free-text to regex against. `fetchImpl` is injected for
 * testability (same pattern as enrich-domain.mjs's createGetJson).
 * `model` defaults to the OPENROUTER_MODEL env var, falling back to a
 * current, cheap Gemini Flash model — this call's input (a category tree
 * plus a handful of short candidate descriptions) and output (a small
 * JSON array) don't need a frontier model.
 */
export async function callOpenRouterApi(prompt, { apiKey, model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL, fetchImpl = fetch } = {}) {
  const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.candidatesText },
      ],
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "function", function: { name: "classify_candidates" } },
    }),
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText ?? ""} from OpenRouter`.trim());
  }

  const body = await res.json();
  const call = body.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("OpenRouter response had no classify_candidates tool call");
  return JSON.parse(call.function.arguments).classifications;
}

/**
 * True when a classification entry has the required shape: boolean
 * `fits`, a numeric `confidence` in [0, 1], a string `reason`, and — if
 * `fits` is true — either a `path` breadcrumb that exactly matches or
 * extends an existing `categoryTree` entry, or a `suggestedNewCategory`.
 * A `fits: true` entry with neither `path` nor `suggestedNewCategory` is
 * invalid too, not just an entry with a bad `path` — otherwise it would
 * sail through `routeCandidate` as `"qualifies"` and get auto-committed
 * with `path: null`, which breaks every consumer expecting `path` to be
 * an array (see CONTRIBUTING.md's schema).
 */
function isValidClassification(entry, categoryTree) {
  if (!entry || typeof entry.fits !== "boolean") return false;
  if (typeof entry.confidence !== "number" || entry.confidence < 0 || entry.confidence > 1) return false;
  if (typeof entry.reason !== "string") return false;
  if (entry.fits && !entry.path && !entry.suggestedNewCategory) return false;
  if (entry.path != null) {
    if (!Array.isArray(entry.path) || entry.path.length === 0) return false;
    const breadcrumb = entry.path.join(" / ");
    const matchesExisting = categoryTree.some(
      (existing) => existing === breadcrumb || existing.startsWith(`${breadcrumb} / `) || breadcrumb.startsWith(`${existing} / `),
    );
    if (!matchesExisting && !entry.suggestedNewCategory) return false;
  }
  return true;
}

/**
 * Classifies one domain's quality-passing candidates via `callLlm`
 * (propagates a whole-call failure straight through — the caller wraps
 * this in retry logic and decides whether to skip the domain for the
 * day, per discover-projects.mjs). Validates the response per candidate:
 * a candidate missing from the response, or whose entry fails
 * `isValidClassification`, is never dropped — it comes back with
 * `{ fits: null, reason: "unparseable classification" }` so it still
 * reaches the review queue rather than being silently discarded or
 * auto-committed on bad data.
 */
export async function classifyCandidates(domain, candidates, { callLlm }) {
  const categoryTree = buildCategoryTree(domain);
  const prompt = buildClassificationPrompt(domain, categoryTree, candidates);
  const raw = await callLlm(prompt);

  const byId = new Map((Array.isArray(raw) ? raw : []).map((entry) => [entry?.id, entry]));

  return candidates.map((candidate) => {
    const entry = byId.get(candidate.id);
    if (isValidClassification(entry, categoryTree)) {
      return {
        id: candidate.id,
        fits: entry.fits,
        path: entry.path ?? null,
        confidence: entry.confidence,
        suggestedNewCategory: entry.suggestedNewCategory ?? null,
        reason: entry.reason,
      };
    }
    return { id: candidate.id, fits: null, path: null, confidence: 0, suggestedNewCategory: null, reason: "unparseable classification" };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/classify-candidates.test.js`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add scripts/classify-candidates.mjs test/classify-candidates.test.js
git commit -m "feat: add OpenRouter-based candidate classification"
```

---

## Task 4: `scripts/apply-discoveries.mjs`

**Files:**
- Create: `scripts/apply-discoveries.mjs`
- Test: `test/apply-discoveries.test.js`

**Interfaces:**
- Consumes: the classified-candidate shape produced by Task 3's `classifyCandidates` (`{ id, fits, path, confidence, suggestedNewCategory, reason }`).
- Produces:
  - `routeCandidate(classified, { minConfidence? }) => "drop" | "needsReview" | "qualifies"`
  - `selectAutoCommit(classified, { minConfidence?, dailyCap? }) => { autoCommit: object[], pending: object[] }`
  - `formatReviewIssueBody(pendingByDomain: Record<string, object[]>, date: string) => string` — each `pendingByDomain[slug]` item must additionally carry `stars` (merged in by the caller, Task 5, from repo metadata).
  - `updateSeenIds(existingSeenIds: string[], todaysEvaluatedIds: string[]) => string[]`
  - All four used by Task 5 (`discover-projects.mjs`).

- [ ] **Step 1: Write the failing test file**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeCandidate, selectAutoCommit, formatReviewIssueBody, updateSeenIds } from "../scripts/apply-discoveries.mjs";

test("routeCandidate returns drop for a confirmed non-fit", () => {
  assert.equal(routeCandidate({ fits: false, confidence: 0.9 }), "drop");
});

test("routeCandidate returns qualifies for a confident fit into an existing category", () => {
  assert.equal(routeCandidate({ fits: true, confidence: 0.9, suggestedNewCategory: null }), "qualifies");
});

test("routeCandidate returns needsReview for a low-confidence fit", () => {
  assert.equal(routeCandidate({ fits: true, confidence: 0.5, suggestedNewCategory: null }, { minConfidence: 0.8 }), "needsReview");
});

test("routeCandidate returns needsReview when a new category is suggested, even at high confidence", () => {
  assert.equal(routeCandidate({ fits: true, confidence: 0.95, suggestedNewCategory: "Fine-Tuning Tools" }), "needsReview");
});

test("routeCandidate returns needsReview for an unparseable classification (fits: null)", () => {
  assert.equal(routeCandidate({ fits: null, confidence: 0 }), "needsReview");
});

test("selectAutoCommit auto-commits qualifying candidates up to dailyCap, sorted by confidence descending", () => {
  const classified = [
    { id: "a/a", fits: true, confidence: 0.85, suggestedNewCategory: null },
    { id: "b/b", fits: true, confidence: 0.95, suggestedNewCategory: null },
    { id: "c/c", fits: true, confidence: 0.9, suggestedNewCategory: null },
  ];

  const { autoCommit, pending } = selectAutoCommit(classified, { minConfidence: 0.8, dailyCap: 2 });

  assert.deepEqual(autoCommit.map((c) => c.id), ["b/b", "c/c"]);
  assert.deepEqual(pending.map((c) => c.id), ["a/a"]);
});

test("selectAutoCommit routes needsReview candidates to pending alongside cap overflow", () => {
  const classified = [
    { id: "a/a", fits: true, confidence: 0.95, suggestedNewCategory: null },
    { id: "b/b", fits: true, confidence: 0.5, suggestedNewCategory: null },
    { id: "c/c", fits: true, confidence: 0.9, suggestedNewCategory: "New Category" },
  ];

  const { autoCommit, pending } = selectAutoCommit(classified, { minConfidence: 0.8, dailyCap: 5 });

  assert.deepEqual(autoCommit.map((c) => c.id), ["a/a"]);
  assert.deepEqual(new Set(pending.map((c) => c.id)), new Set(["b/b", "c/c"]));
});

test("selectAutoCommit excludes drop candidates from both lists", () => {
  const classified = [{ id: "a/a", fits: false, confidence: 0.9, suggestedNewCategory: null }];
  const { autoCommit, pending } = selectAutoCommit(classified);
  assert.deepEqual(autoCommit, []);
  assert.deepEqual(pending, []);
});

test("formatReviewIssueBody lists each domain's pending candidates with placement, confidence, and reason", () => {
  const pendingByDomain = {
    "artificial-intelligence": [
      { id: "foo/bar", stars: 1200, path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"], suggestedNewCategory: null, confidence: 0.6, reason: "uncertain fit" },
    ],
  };

  const body = formatReviewIssueBody(pendingByDomain, "2026-08-25");

  assert.match(body, /artificial-intelligence/);
  assert.match(body, /foo\/bar/);
  assert.match(body, /1200 stars/);
  assert.match(body, /LLM Infrastructure \/ LLM Frameworks & Runtimes/);
  assert.match(body, /60%/);
  assert.match(body, /uncertain fit/);
});

test("formatReviewIssueBody shows a suggested new category when path is absent", () => {
  const pendingByDomain = {
    "artificial-intelligence": [{ id: "foo/bar", stars: 800, path: null, suggestedNewCategory: "Fine-Tuning Tools", confidence: 0.7, reason: "no category fits" }],
  };

  assert.match(formatReviewIssueBody(pendingByDomain, "2026-08-25"), /suggests new category: "Fine-Tuning Tools"/);
});

test("formatReviewIssueBody returns a placeholder message when nothing is pending", () => {
  assert.equal(formatReviewIssueBody({}, "2026-08-25"), "No discovery candidates need review for 2026-08-25.");
});

test("formatReviewIssueBody skips a domain whose pending list is empty", () => {
  assert.equal(formatReviewIssueBody({ "web-dev": [] }, "2026-08-25"), "No discovery candidates need review for 2026-08-25.");
});

test("updateSeenIds returns the deduped union of existing and today's ids, preserving first-seen order", () => {
  assert.deepEqual(updateSeenIds(["a/a", "b/b"], ["b/b", "c/c"]), ["a/a", "b/b", "c/c"]);
});

test("updateSeenIds returns existing ids unchanged when today's list is empty", () => {
  assert.deepEqual(updateSeenIds(["a/a"], []), ["a/a"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/apply-discoveries.test.js`
Expected: FAIL — `Cannot find module '../scripts/apply-discoveries.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
const DEFAULT_MIN_CONFIDENCE = 0.8;
const DEFAULT_DAILY_CAP = 3;

/**
 * Pure routing decision for one classified candidate (see
 * classifyCandidates's output shape in classify-candidates.mjs): "drop"
 * for a confirmed non-fit (`fits === false`), "needsReview" for anything
 * uncertain, requiring a new category, or unparseable (`fits === null`),
 * "qualifies" for a confident fit into an existing category.
 */
export function routeCandidate(classified, { minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  if (classified.fits === false) return "drop";
  if (classified.fits === true && !classified.suggestedNewCategory && classified.confidence >= minConfidence) {
    return "qualifies";
  }
  return "needsReview";
}

/**
 * Splits one domain's classified candidates into `autoCommit` (up to
 * `dailyCap`, highest confidence first) and `pending` (every
 * "needsReview" candidate, plus any "qualifies" candidate that didn't
 * make the cap). "drop" candidates appear in neither list — the caller
 * (discover-projects.mjs) still records them in data/discovery/seen.json
 * via `updateSeenIds` so they aren't re-evaluated tomorrow.
 */
export function selectAutoCommit(classified, { minConfidence = DEFAULT_MIN_CONFIDENCE, dailyCap = DEFAULT_DAILY_CAP } = {}) {
  const qualifies = [];
  const pending = [];

  for (const candidate of classified) {
    const route = routeCandidate(candidate, { minConfidence });
    if (route === "qualifies") qualifies.push(candidate);
    else if (route === "needsReview") pending.push(candidate);
  }

  qualifies.sort((a, b) => b.confidence - a.confidence);
  const autoCommit = qualifies.slice(0, dailyCap);
  const overflow = qualifies.slice(dailyCap);

  return { autoCommit, pending: [...pending, ...overflow] };
}

/**
 * Formats the day's review queue as GitHub-flavored Markdown: one
 * "### <domain>" section per domain with at least one pending candidate,
 * each listed with its GitHub link, star count, suggested placement
 * (existing path or a suggested new category), confidence, and the
 * classifier's stated reason. `pendingByDomain` values must carry `stars`
 * (merged in by the caller from repo metadata — classifyCandidates's
 * output alone doesn't include it). Mirrors formatDigest/
 * renderReadmeRisers in social-digest.mjs, including its "nothing to
 * report" placeholder convention for an empty queue.
 */
export function formatReviewIssueBody(pendingByDomain, date) {
  const domainSlugs = Object.keys(pendingByDomain).filter((slug) => pendingByDomain[slug].length > 0);
  if (domainSlugs.length === 0) {
    return `No discovery candidates need review for ${date}.`;
  }

  const sections = domainSlugs.map((slug) => {
    const lines = pendingByDomain[slug].map((c) => {
      const placement = c.suggestedNewCategory ? `suggests new category: "${c.suggestedNewCategory}"` : c.path ? c.path.join(" / ") : "no placement suggested";
      const confidencePct = Math.round(c.confidence * 100);
      return `- [**${c.id}**](https://github.com/${c.id}) — ${c.stars} stars, ${placement}, confidence ${confidencePct}% — ${c.reason}`;
    });
    return [`### ${slug}`, "", ...lines].join("\n");
  });

  return [`Discovery candidates awaiting review for ${date}:`, "", ...sections].join("\n\n");
}

/**
 * Returns the deduped union of ids the job has ever evaluated (whether
 * auto-committed, sent to review, or rejected outright), so none of them
 * are re-fetched or re-classified on a future run.
 */
export function updateSeenIds(existingSeenIds, todaysEvaluatedIds) {
  return [...new Set([...existingSeenIds, ...todaysEvaluatedIds])];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/apply-discoveries.test.js`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add scripts/apply-discoveries.mjs test/apply-discoveries.test.js
git commit -m "feat: add discovery routing (auto-commit vs review) and issue formatting"
```

---

## Task 5: `scripts/discover-projects.mjs` (CLI orchestrator)

**Files:**
- Create: `scripts/discover-projects.mjs`

**Interfaces:**
- Consumes:
  - `enrichProject`, `createGetJson`, `withRetry` from `scripts/enrich-domain.mjs` (existing).
  - `collectCandidateIds`, `excludeKnownIds`, `fetchRepoMetadata`, `passesQualityBar` from Task 2.
  - `classifyCandidates`, `callOpenRouterApi` from Task 3.
  - `selectAutoCommit`, `formatReviewIssueBody`, `updateSeenIds` from Task 4.
- Produces: nothing importable — this is the CLI entry point (`node scripts/discover-projects.mjs [--dry-run]`), not unit tested, same convention as `enrich-domain.mjs`/`snapshot-history.mjs`/`social-digest.mjs`'s `main()`. Verified manually in Task 8.

- [ ] **Step 1: Write the implementation**

```javascript
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { enrichProject, createGetJson, withRetry } from "./enrich-domain.mjs";
import { collectCandidateIds, excludeKnownIds, fetchRepoMetadata, passesQualityBar } from "./discover-candidates.mjs";
import { classifyCandidates, callOpenRouterApi } from "./classify-candidates.mjs";
import { selectAutoCommit, formatReviewIssueBody, updateSeenIds } from "./apply-discoveries.mjs";

const DATA_DIR = "data";
const SOURCES_PATH = "data/discovery/sources.json";
const SEEN_PATH = "data/discovery/seen.json";

// CLI entry point: node scripts/discover-projects.mjs [--dry-run]
// Discovers, classifies, and (unless --dry-run) auto-commits or queues for
// review new candidate projects across every domain configured in
// data/discovery/sources.json. Thin I/O orchestration, not unit tested
// (same convention as enrich-domain.mjs/snapshot-history.mjs's main()) —
// verified manually via --dry-run in Task 8.
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    console.error("Error: OPENROUTER_API_KEY is not set.");
    process.exit(1);
  }

  const ghToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const getJson = createGetJson(ghToken);

  const sourcesConfig = existsSync(SOURCES_PATH) ? JSON.parse(readFileSync(SOURCES_PATH, "utf8")) : {};
  const domainFiles = readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"));
  const domainEntries = domainFiles.map((file) => ({ file, domain: JSON.parse(readFileSync(`${DATA_DIR}/${file}`, "utf8")) }));

  const existingIds = new Set(domainEntries.flatMap(({ domain }) => domain.projects.map((p) => p.id)));
  const previouslySeenIds = existsSync(SEEN_PATH) ? JSON.parse(readFileSync(SEEN_PATH, "utf8")) : [];
  const knownIds = new Set([...existingIds, ...previouslySeenIds]);

  const allEvaluatedIds = [];
  const pendingByDomain = {};

  for (const { file, domain } of domainEntries) {
    if (!sourcesConfig[domain.slug]) continue;

    const rawIds = await collectCandidateIds(domain.slug, sourcesConfig, { getJson });
    const newIds = excludeKnownIds(rawIds, knownIds);

    const metaById = new Map();
    for (const id of newIds) {
      try {
        const meta = await fetchRepoMetadata(id, { getJson });
        if (meta) metaById.set(id, meta);
      } catch (err) {
        console.error(`Warning: failed to fetch metadata for "${id}": ${err.message}`);
      }
    }

    const evaluatedIds = [...metaById.keys()];
    const qualifying = [...metaById.values()].filter((meta) => passesQualityBar(meta));

    let classified = [];
    if (qualifying.length > 0) {
      try {
        classified = await withRetry(() =>
          classifyCandidates(domain, qualifying, {
            callLlm: (prompt) => callOpenRouterApi(prompt, { apiKey: openRouterKey }),
          }),
        );
      } catch (err) {
        console.error(`Warning: classification failed for domain "${domain.slug}", skipping today: ${err.message}`);
        continue; // evaluatedIds (including this domain's quality-bar rejects) are NOT recorded, so the whole domain retries tomorrow
      }
    }

    allEvaluatedIds.push(...evaluatedIds);

    const { autoCommit, pending } = selectAutoCommit(classified);
    if (pending.length > 0) {
      pendingByDomain[domain.slug] = pending.map((c) => ({ ...c, stars: metaById.get(c.id).stars }));
    }

    console.log(`${domain.slug}: ${evaluatedIds.length} evaluated, ${qualifying.length} passed quality bar, ${autoCommit.length} auto-commit, ${pending.length} pending`);

    if (autoCommit.length === 0 || dryRun) continue;

    const enrichedProjects = [];
    for (const candidate of autoCommit) {
      const meta = metaById.get(candidate.id);
      enrichedProjects.push(await enrichProject({ id: candidate.id, path: candidate.path, desc: meta.description }, { getJson }));
    }
    domain.projects.push(...enrichedProjects);
    writeFileSync(`${DATA_DIR}/${file}`, JSON.stringify(domain, null, 2) + "\n");
  }

  if (dryRun) {
    console.log("Dry run: no files written, no commit, no issue created.");
    return;
  }

  mkdirSync("data/discovery", { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(updateSeenIds(previouslySeenIds, allEvaluatedIds), null, 2) + "\n");

  // All writeFileSync calls above (domain files + seen.json) have already
  // landed on disk by this point. `gh issue create` failing must not
  // crash main() before the workflow's separate git-commit step runs, or
  // that step would be skipped (GitHub Actions skips remaining steps
  // after a failed one by default) and today's auto-committed additions
  // would never reach git — see the Deployment step's `if: always()` on
  // that step for the other half of this guarantee. Marking the run
  // failed via `process.exitCode` (not `process.exit`) still surfaces
  // the failure in Actions without stopping here.
  if (Object.keys(pendingByDomain).length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const body = formatReviewIssueBody(pendingByDomain, today);
    try {
      execFileSync("gh", ["issue", "create", "--title", `🔍 Discovery review — ${today}`, "--body", body, "--label", "discovery"], { stdio: "inherit" });
    } catch (err) {
      console.error(`Warning: failed to open the discovery review issue: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 2: Confirm the module loads without syntax errors**

Run: `node --check scripts/discover-projects.mjs`
Expected: no output (exit code 0)

- [ ] **Step 3: Confirm the full test suite still passes**

Run: `npm test`
Expected: PASS — every existing test plus Tasks 2–4's new tests, all green

- [ ] **Step 4: Commit**

```bash
git add scripts/discover-projects.mjs
git commit -m "feat: add discover-projects.mjs CLI orchestrator"
```

---

## Task 6: `.github/workflows/discovery.yml`

**Files:**
- Create: `.github/workflows/discovery.yml`

**Interfaces:**
- Consumes: `scripts/discover-projects.mjs` (Task 5) as its `run` step; `OPENROUTER_API_KEY` repo secret (already set).
- Produces: nothing importable — a scheduled workflow.

- [ ] **Step 1: Write the workflow file**

```yaml
name: Discovery

on:
  schedule:
    - cron: "0 7 * * *"
  workflow_dispatch:

permissions:
  contents: write
  issues: write

concurrency:
  group: discovery
  cancel-in-progress: false

jobs:
  discover:
    runs-on: ubuntu-latest
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: node scripts/discover-projects.mjs
      # if: always() — must still run and commit whatever was already
      # written to disk (domain files + seen.json) even if the previous
      # step exited non-zero (e.g. gh issue create failed after all
      # writes succeeded, per the process.exitCode handling in
      # discover-projects.mjs). Without this, a review-issue failure
      # would silently drop that day's auto-committed additions instead
      # of just failing loudly.
      - if: always()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/*.json data/discovery/seen.json
          if git diff --cached --quiet; then
            echo "No discovery changes to commit."
          else
            git commit -m "chore: daily project discovery"
            git push
          fi
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `node -e "require('node:fs').readFileSync('.github/workflows/discovery.yml', 'utf8')" && python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/discovery.yml'))" 2>/dev/null || node -e "const yaml = require('node:fs').readFileSync('.github/workflows/discovery.yml', 'utf8'); if (!yaml.includes('cron:')) throw new Error('missing cron')"`
Expected: no error (if `python3`/`pyyaml` isn't available, the `node -e` fallback after `||` just confirms the file is readable and contains a `cron:` line — full schema validation happens for real on the next push, same as any other workflow file in this repo)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/discovery.yml
git commit -m "feat: add daily discovery workflow"
```

---

## Task 7: Document the job in `CONTRIBUTING.md`

**Files:**
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing importable.

- [ ] **Step 1: Add a new section at the end of `CONTRIBUTING.md`**

Append after the existing "Rising stars leaderboard" section:

```markdown

## Automated project discovery

A daily scheduled job (`.github/workflows/discovery.yml`, running
`scripts/discover-projects.mjs`) looks for new candidate projects on its
own, using the search topics and awesome-lists configured per domain in
`data/discovery/sources.json`. Every candidate is checked against a
quality bar (500+ stars, not a fork/archived, has a license, pushed
within the last 12 months) before an LLM (OpenRouter, currently
`google/gemini-3.7-flash`) classifies it into that domain's existing
category tree.

- A candidate the classifier is confident about (an existing category
  fit, ≥80% confidence) is auto-committed directly, up to 3 per domain
  per day — no PR, no human review, unlike every other addition described
  above. This is a deliberate, bounded exception to this doc's normal
  "every addition gets a human-reviewed PR" rule.
- Everything else that passed the quality bar — low confidence, a
  suggested new category, or capped-out overflow — lands in a daily
  "🔍 Discovery review" GitHub issue instead. Nothing is silently
  discarded and no category is ever auto-created; a maintainer turns a
  wanted candidate into a normal contribution PR.
- A candidate is only ever evaluated once (tracked in
  `data/discovery/seen.json`); an ignored review-issue candidate won't
  reappear the next day, so the issue itself is the durable record if you
  want to revisit it later.
```

- [ ] **Step 2: Verify the file still renders as valid Markdown (no broken structure)**

Run: `tail -30 CONTRIBUTING.md`
Expected: the new "## Automated project discovery" section prints cleanly, no stray unclosed code fences

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: document the automated discovery job in CONTRIBUTING.md"
```

---

## Task 8: End-to-end dry-run verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing — this task's output is a pass/fail confirmation, not code.

- [ ] **Step 1: Run the full test suite one more time**

Run: `npm test`
Expected: PASS — every test file green, including `discover-candidates.test.js`, `classify-candidates.test.js`, `apply-discoveries.test.js`

- [ ] **Step 2: Run the generator to confirm nothing in `data/` broke the site build**

Run: `npm run generate`
Expected: completes without error (confirms `data/discovery/sources.json` and `data/discovery/seen.json` are correctly ignored by `generate.mjs`'s domain-file scan, per the Global Constraints note)

- [ ] **Step 3: Run a real dry-run against live data**

Requires `gh auth token` to already work (it does — confirmed earlier in this session) and `OPENROUTER_API_KEY` to be set in the shell for this one local run only (the real value already lives in the repo secret; do not commit it anywhere):

Run: `OPENROUTER_API_KEY=<paste the same key set as the repo secret> node scripts/discover-projects.mjs --dry-run`
Expected: one summary line per domain configured in `data/discovery/sources.json` (e.g. `artificial-intelligence: 12 evaluated, 4 passed quality bar, 2 auto-commit, 2 pending`), ending with `Dry run: no files written, no commit, no issue created.` — confirm `git status` shows no changes afterward.

- [ ] **Step 4: Spot-check the counts look sane**

For at least one domain in the dry-run output: the "evaluated" count should be small (tens, not hundreds — GitHub Search returns ~30 results per topic query and awesome-lists rarely link more than a few hundred repos, most of which are already-known ids filtered out by `excludeKnownIds`), and "auto-commit" should never exceed 3 (the `dailyCap`). If any domain's counts look wildly off (e.g. 0 evaluated for every domain), re-check that `data/discovery/sources.json`'s topics/awesome-list ids are still valid before enabling the schedule.

- [ ] **Step 5: Confirm the workflow is picked up by GitHub Actions**

Run: `gh workflow list --repo haggaishachar/awesomemap | grep -i discovery`
Expected: `Discovery` appears in the list (confirms `discovery.yml` parsed correctly once pushed — the schedule will fire on its own at the next `0 7 * * *` UTC; no need to wait for it here, `workflow_dispatch` is available for an on-demand test run afterward if wanted)
