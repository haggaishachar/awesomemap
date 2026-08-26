import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { enrichProject, createGetJson, withRetry } from "./enrich-domain.mjs";
import { collectCandidateIds, excludeKnownIds, fetchRepoMetadata, passesQualityBar } from "./discover-candidates.mjs";
import { classifyCandidates, callOpenRouterApi } from "./classify-candidates.mjs";
import { selectAutoCommit, formatReviewIssueBody, updateSeenIds } from "./apply-discoveries.mjs";

const DATA_DIR = "data";
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

    console.log(`${domain.slug}: ${evaluatedIds.length} evaluated, ${qualifying.length} passed quality bar, ${autoCommit.length} auto-commit, ${pending.length} pending`);

    // Candidates that made autoCommit but then failed enrichment (or came back
    // with an invalid weight) are routed into the review queue below, not
    // silently dropped — their ids are already permanently in allEvaluatedIds
    // (added above, before enrichment even runs) so they'd otherwise vanish
    // without a trace: never committed, never reviewed, never retried.
    const enrichmentFailures = [];

    if (autoCommit.length > 0 && !dryRun) {
      const enrichedProjects = [];
      for (const candidate of autoCommit) {
        const meta = metaById.get(candidate.id);
        try {
          const [, repoName] = candidate.id.split("/");
          const enriched = await enrichProject(
            { id: candidate.id, path: candidate.path, name: repoName, link: `https://github.com/${candidate.id}`, desc: meta.description, tags: meta.topics },
            { getJson },
          );
          if (typeof enriched.weight !== "number" || !Number.isInteger(enriched.weight) || enriched.weight <= 0) {
            console.error(`Warning: enrichment for "${candidate.id}" did not produce a valid weight, adding to review queue instead`);
            enrichmentFailures.push(candidate);
            continue;
          }
          enrichedProjects.push(enriched);
        } catch (err) {
          console.error(`Warning: failed to enrich candidate "${candidate.id}" for auto-commit, adding to review queue instead: ${err.message}`);
          enrichmentFailures.push(candidate);
        }
      }
      domain.projects.push(...enrichedProjects);
      writeFileSync(`${DATA_DIR}/${file}`, JSON.stringify(domain, null, 2) + "\n");
    }

    // In --dry-run mode enrichmentFailures is always empty (enrichment is
    // never attempted), so this reflects exactly selectAutoCommit's original
    // `pending` list, as before.
    const allPending = [...pending, ...enrichmentFailures];
    if (allPending.length > 0) {
      pendingByDomain[domain.slug] = allPending.map((c) => ({ ...c, stars: metaById.get(c.id).stars }));
    }
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
