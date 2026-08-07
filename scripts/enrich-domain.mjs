export const LOGO_CANDIDATE_PATHS = [
  "logo.svg",
  "logo.png",
  "assets/logo.svg",
  "assets/logo.png",
  "docs/logo.svg",
  "docs/logo.png",
  "docs/assets/logo.svg",
  "docs/assets/logo.png",
  ".github/logo.svg",
  ".github/logo.png",
  "brand/logo.svg",
  "brand/logo.png",
];

/**
 * Extracts { owner, repo } from a github.com repo URL. Tolerates a
 * trailing slash, a trailing .git, and subpaths beyond owner/repo
 * (e.g. /tree/main/packages). Returns null for anything else.
 */
export function parseGhRepo(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com") return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const [owner, repoRaw] = segments;
  const repo = repoRaw.endsWith(".git") ? repoRaw.slice(0, -4) : repoRaw;
  if (!owner || !repo) return null;
  return { owner, repo };
}

/**
 * Given a tool and an injected `getJson`, returns a new tool object with
 * `weight` set to its GitHub repo's live star count and, if a logo
 * candidate is found, `image` set to that file's direct raw.githubusercontent.com
 * URL (served straight from the source repo — never downloaded or stored
 * in this repo). Tools without a parseable `gh` URL are returned
 * unchanged; no network calls are made for them.
 */
export async function enrichTool(tool, { getJson }) {
  const repo = parseGhRepo(tool.gh);
  if (!repo) return tool;

  const repoData = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
  const enriched = { ...tool, weight: repoData.stargazers_count };

  for (const path of LOGO_CANDIDATE_PATHS) {
    let entry;
    try {
      entry = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${path}`);
    } catch (err) {
      if (err.status === 404) continue;
      throw err;
    }
    if (entry && entry.type === "file" && entry.download_url) {
      enriched.image = entry.download_url;
      break;
    }
  }

  return enriched;
}

/**
 * Default retry predicate: retries network-level exceptions (no `.status`,
 * e.g. `fetch` throwing on a connection failure) and 5xx server responses.
 * Does NOT retry 4xx responses (a 404 or 401 won't succeed on retry).
 */
export function defaultIsRetryable(err) {
  if (typeof err.status === "number") return err.status >= 500;
  return true;
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls `fn` and retries on failure up to `attempts` total tries, using
 * `isRetryable` to decide whether a given error is worth retrying and
 * `sleep` (injectable, defaults to a real setTimeout-based delay) to wait
 * `delayMs * attempt` (linear backoff) between attempts. Rethrows the
 * triggering error once attempts are exhausted, or immediately if an
 * error is not retryable. Requires `attempts >= 1`; given that precondition,
 * the loop always returns or throws internally, so there is no reachable
 * code after it.
 */
export async function withRetry(
  fn,
  { attempts = 3, delayMs = 200, isRetryable = defaultIsRetryable, sleep = realSleep } = {},
) {
  if (attempts < 1) throw new Error(`withRetry: attempts must be >= 1, got ${attempts}`);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === attempts || !isRetryable(err)) throw err;
      await sleep(delayMs * attempt);
    }
  }
}

/**
 * Given the post-enrichment tool list, returns the ids of tools that should
 * have received a real star-count `weight` from `enrichTool` (i.e. those
 * with a parseable `gh` URL) but didn't: `weight` is missing, not a number,
 * not an integer, or not strictly positive. Tools without a parseable `gh`
 * URL are never enriched and are intentionally excluded — that's expected
 * behavior, not a failure. Pure and side-effect free so it can be unit
 * tested directly; `main()` calls this after the enrichment loop and fails
 * loudly if it returns anything.
 */
export function findInvalidWeights(tools) {
  const bad = [];
  for (const tool of tools) {
    if (!parseGhRepo(tool.gh)) continue;
    const { weight } = tool;
    if (typeof weight !== "number" || !Number.isInteger(weight) || weight <= 0) {
      bad.push(tool.id);
    }
  }
  return bad;
}

/**
 * Builds the real, network-backed `getJson` used by `main()`: a GitHub API
 * GET wrapped in `withRetry`. `fetchImpl` and `sleep` are injectable so
 * tests can exercise this exact composition (fetch -> `!res.ok` check ->
 * `err.status` -> `withRetry`) without touching the real network or real
 * timers; both default to the real global `fetch` / a real setTimeout
 * delay for production use.
 */
export function createGetJson(token, { fetchImpl = fetch, sleep } = {}) {
  return (url) =>
    withRetry(async () => {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        const err = new Error(`${res.status} ${res.statusText} for ${url}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }, { sleep });
}

// CLI entry point: node scripts/enrich-domain.mjs data/<slug>.json
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

async function main() {
  const domainPath = process.argv[2];
  if (!domainPath) {
    console.error("Usage: node scripts/enrich-domain.mjs data/<slug>.json");
    process.exit(1);
  }

  const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const getJson = createGetJson(token);

  const domain = JSON.parse(readFileSync(domainPath, "utf8"));
  let starsFetched = 0;
  let logosFound = 0;
  let failed = 0;
  const enrichedTools = [];

  for (const tool of domain.tools) {
    try {
      const enriched = await enrichTool(tool, { getJson });
      if (enriched.weight !== undefined) starsFetched += 1;
      if (enriched.image !== undefined && enriched.image !== tool.image) logosFound += 1;
      enrichedTools.push(enriched);
    } catch (err) {
      failed += 1;
      console.error(`Warning: failed to enrich tool "${tool.id}": ${err.message}`);
      enrichedTools.push(tool);
    }
  }

  const invalidWeightIds = findInvalidWeights(enrichedTools);
  if (invalidWeightIds.length > 0) {
    console.error(
      `Error: ${invalidWeightIds.length} tool(s) with a gh URL did not end up with a real positive integer weight: ${invalidWeightIds.join(", ")}`,
    );
    process.exit(1);
  }

  writeFileSync(domainPath, JSON.stringify({ ...domain, tools: enrichedTools }, null, 2) + "\n");
  console.log(
    `${domainPath}: ${starsFetched}/${domain.tools.length} weights fetched, ${failed} failed, ${logosFound} logo URLs resolved`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
