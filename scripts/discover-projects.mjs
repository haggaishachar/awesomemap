import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { enrichProject, createGetJson, withRetry } from "./enrich-domain.mjs";
import { collectCandidateIds, excludeKnownIds, fetchRepoMetadata, passesQualityBar } from "./discover-candidates.mjs";
import { classifyCandidates, callOpenRouterApi } from "./classify-candidates.mjs";
import { selectAutoCommit, updateSeenIds } from "./apply-discoveries.mjs";
import { loadAllDomains, saveDomain, saveProjectEntity, SCHEMA_VERSION } from "./data-store.mjs";

const SOURCES_PATH = "data/discovery/sources.json";
const SEEN_PATH = "data/discovery/seen.json";
// Caps per-domain unseen ids fetched in a single run. An early run (empty or
// near-empty seen.json) can otherwise return hundreds of unseen ids from a
// single awesome-list, and every one costs one fetchRepoMetadata call,
// sequentially, across every configured domain — enough to exhaust the
// GitHub token's rate limit partway through a run. Ids beyond the cap are
// simply never marked seen, so they're picked up on a subsequent run; the
// backlog clears gradually over several days instead of one run trying (and
// often failing) to process it all at once.
const MAX_NEW_CANDIDATES_PER_DOMAIN_PER_RUN = 50;

// CLI entry point: node scripts/discover-projects.mjs [--dry-run]
// Discovers, classifies, and (unless --dry-run) auto-commits new candidate
// projects across every domain configured in data/discovery/sources.json.
// Nothing here waits on a human: a candidate the classifier affirms fits
// is committed straight away (selectAutoCommit, uncapped), a candidate it
// rejects is dropped and marked seen, and a candidate the pipeline itself
// failed on (unparseable classification, a bad enrichment) is simply left
// out of seen.json so a later run retries it fresh — see
// CONTRIBUTING.md's "Automated project discovery" section. Thin I/O
// orchestration, not unit tested (same convention as enrich-domain.mjs/
// snapshot-history.mjs's main()) — verified manually via --dry-run.
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
  const domains = loadAllDomains();

  const existingIds = new Set(domains.flatMap((domain) => domain.projects.map((p) => p.id)));
  const previouslySeenIds = existsSync(SEEN_PATH) ? JSON.parse(readFileSync(SEEN_PATH, "utf8")) : [];
  const knownIds = new Set([...existingIds, ...previouslySeenIds]);

  const allEvaluatedIds = [];
  let totalAutoCommitted = 0;

  for (const domain of domains) {
    if (!sourcesConfig[domain.slug]) continue;

    const rawIds = await collectCandidateIds(domain.slug, sourcesConfig, { getJson });
    const newIds = excludeKnownIds(rawIds, knownIds).slice(0, MAX_NEW_CANDIDATES_PER_DOMAIN_PER_RUN);

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
    // Every id whose metadata fetch succeeded is permanently marked seen,
    // *except* ones a content judgment was never reached for (below) — a
    // quality-bar reject is a real, objective rejection, safe to never
    // reconsider.
    const seenIds = new Set(evaluatedIds);

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

    // A classification the pipeline itself couldn't parse (fits: null) never
    // got a real content judgment — unmark it seen so a later run, not a
    // human, gives it another try, instead of it silently vanishing forever.
    for (const c of classified) {
      if (c.fits === null) seenIds.delete(c.id);
    }

    const autoCommit = selectAutoCommit(classified);

    let committed = 0;
    if (autoCommit.length > 0 && !dryRun) {
      const newMembers = [];
      for (const candidate of autoCommit) {
        const meta = metaById.get(candidate.id);
        try {
          const [, repoName] = candidate.id.split("/");
          const enriched = await enrichProject(
            {
              schemaVersion: SCHEMA_VERSION,
              id: candidate.id,
              link: `https://github.com/${candidate.id}`,
              name: repoName,
              desc: meta.description,
              // GitHub's own name/description are left null here rather than
              // guessed — the next daily snapshot-history.mjs run upserts
              // both from a fresh fetch, same as every other project.
              githubName: null,
              githubDescription: null,
              tags: meta.topics,
              history: [],
            },
            { getJson },
          );
          if (typeof enriched.weight !== "number" || !Number.isInteger(enriched.weight) || enriched.weight <= 0) {
            console.error(`Warning: enrichment for "${candidate.id}" did not produce a valid weight, will retry on a later run`);
            seenIds.delete(candidate.id); // pipeline failure, not a content rejection — retry, don't drop
            continue;
          }
          saveProjectEntity(enriched);
          newMembers.push({ id: candidate.id, path: candidate.path });
          committed++;
        } catch (err) {
          console.error(`Warning: failed to enrich candidate "${candidate.id}" for auto-commit, will retry on a later run: ${err.message}`);
          seenIds.delete(candidate.id);
        }
      }
      domain.projects.push(...newMembers);
      saveDomain(domain);
    }

    console.log(`${domain.slug}: ${evaluatedIds.length} evaluated, ${qualifying.length} passed quality bar, ${autoCommit.length} qualified, ${dryRun ? autoCommit.length : committed} committed`);
    totalAutoCommitted += committed;
    allEvaluatedIds.push(...seenIds);
  }

  if (dryRun) {
    console.log("Dry run: no files written, no commit.");
    return;
  }

  mkdirSync("data/discovery", { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(updateSeenIds(previouslySeenIds, allEvaluatedIds), null, 2) + "\n");

  console.log(`Done: ${totalAutoCommitted} project(s) auto-committed across ${domains.length} domain(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
