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
 * Given a tool and injected I/O functions, returns a new tool object with
 * `weight` set to its GitHub repo's live star count, and (as a side
 * effect) downloads the first matching logo candidate — if any — to
 * `<imagesDir>/<tool.id>.<ext>`. Tools without a parseable `gh` URL are
 * returned unchanged; no network calls are made for them.
 */
export async function enrichTool(tool, { getJson, downloadFile }, imagesDir) {
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
      const ext = path.slice(path.lastIndexOf("."));
      await downloadFile(entry.download_url, `${imagesDir}/${tool.id}${ext}`);
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
 * `delayMs` between attempts. Rethrows the last error once attempts are
 * exhausted, or immediately if an error is not retryable.
 */
export async function withRetry(
  fn,
  { attempts = 3, delayMs = 200, isRetryable = defaultIsRetryable, sleep = realSleep } = {},
) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isRetryable(err)) throw err;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

// CLI entry point: node scripts/enrich-domain.mjs data/<slug>.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

async function main() {
  const domainPath = process.argv[2];
  if (!domainPath) {
    console.error("Usage: node scripts/enrich-domain.mjs data/<slug>.json");
    process.exit(1);
  }

  const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const imagesDir = domainPath.replace(/\.json$/, "/images");
  mkdirSync(imagesDir, { recursive: true });

  const getJson = (url) =>
    withRetry(async () => {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        const err = new Error(`${res.status} ${res.statusText} for ${url}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    });

  const downloadFile = async (url, dest) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
  };

  const domain = JSON.parse(readFileSync(domainPath, "utf8"));
  let starsFetched = 0;
  let logosFound = 0;
  let failed = 0;
  const enrichedTools = [];

  for (const tool of domain.tools) {
    const before = new Set(readdirSync(imagesDir));
    try {
      const enriched = await enrichTool(tool, { getJson, downloadFile }, imagesDir);
      if (enriched.weight !== undefined) starsFetched += 1;
      enrichedTools.push(enriched);
    } catch (err) {
      failed += 1;
      console.error(`Warning: failed to enrich tool "${tool.id}": ${err.message}`);
      enrichedTools.push(tool);
    }
    const after = new Set(readdirSync(imagesDir));
    if (after.size > before.size) logosFound += 1;
  }

  writeFileSync(domainPath, JSON.stringify({ ...domain, tools: enrichedTools }, null, 2) + "\n");
  console.log(
    `${domainPath}: ${starsFetched}/${domain.tools.length} weights fetched, ${failed} failed, ${logosFound} logos downloaded`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
