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

    // Check if there are additional path segments beyond owner/repo
    const matchEnd = match.index + match[0].length;
    if (matchEnd < readmeMarkdown.length && readmeMarkdown[matchEnd] === '/') {
      continue;
    }

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
