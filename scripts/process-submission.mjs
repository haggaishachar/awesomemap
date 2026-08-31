import { execFileSync } from "node:child_process";
import { enrichProject, createGetJson, withRetry, parseGhRepo } from "./enrich-domain.mjs";
import { fetchRepoMetadata } from "./discover-candidates.mjs";
import { classifyCandidates, callOpenRouterApi } from "./classify-candidates.mjs";
import { selectAutoCommit } from "./apply-discoveries.mjs";
import { loadAllDomains, saveDomain, saveProjectEntity, SCHEMA_VERSION } from "./data-store.mjs";
import { normalizeProjectId } from "../app/shared/submit-project.js";

// Must match discover-candidates.mjs's passesQualityBar defaults exactly —
// duplicated here (rather than imported) only because that module exposes
// the boolean gate, not per-reason detail; qualityBarFailureReasons below
// needs to explain *why* to a human in an issue comment, which
// passesQualityBar was never meant to do.
const MIN_STARS = 500;
const MAX_INACTIVE_MONTHS = 12;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pulls the raw text under one of suggest-a-project.md's `**Header**`
 * fields: the first non-blank line following a line that's exactly
 * `header` (after trimming) that isn't part of an HTML comment, stopping
 * at the next `**`-prefixed line. An unfilled field is left as the
 * template's own placeholder `<!-- ... -->` comment — some of which span
 * multiple lines and may themselves contain an example URL (e.g. "GitHub
 * repo URL, e.g. https://github.com/owner/repo") — so every line from a
 * `<!--` open to its closing `-->` (possibly the same line) is skipped
 * entirely, never mistaken for real content. Returns null when the
 * header isn't present at all.
 */
function extractField(body, header) {
  const lines = body.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === header);
  if (headerIndex === -1) return null;
  let inComment = false;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (inComment) {
      if (line.endsWith("-->")) inComment = false;
      continue;
    }
    if (line === "") continue;
    if (line.startsWith("<!--")) {
      if (!line.endsWith("-->")) inComment = true;
      continue;
    }
    if (line.startsWith("**")) break;
    return line;
  }
  return null;
}

/**
 * Parses a "Suggest a project" issue body (suggest-a-project.md's shape,
 * whether filled in by the /submit/ page or by hand) into
 * `{ projectId, targetMapHint, why }`. Returns null when no valid GitHub
 * repo can be found under "**Project**" — the issue isn't in a shape this
 * pipeline can act on at all, regardless of who or what created it.
 */
export function parseSubmissionIssueBody(body) {
  const projectRaw = extractField(body ?? "", "**Project**");
  if (!projectRaw) return null;

  // A raw URL/id, or a Markdown link `[text](url)` — take the URL if so.
  const linkMatch = projectRaw.match(/\((https?:\/\/[^\s)]+)\)/) ?? projectRaw.match(/(https?:\/\/\S+)/);
  const repo = parseGhRepo(normalizeProjectId(linkMatch ? linkMatch[1] : projectRaw));
  if (!repo) return null;

  const targetMapRaw = extractField(body, "**Which map should it go in?**");
  const whyRaw = extractField(body, "**Why it fits**");

  return {
    projectId: `${repo.owner}/${repo.repo}`,
    targetMapHint: targetMapRaw && !/^not sure$/i.test(targetMapRaw) ? targetMapRaw : null,
    why: whyRaw && !/^\(no reason given\)$/i.test(whyRaw) ? whyRaw : null,
  };
}

/**
 * Matches a free-text "which map" hint against a domain's slug/shortName/
 * name (exact, case-insensitive), falling back to a substring match (e.g.
 * "web dev please" still finds "Web Dev"). Returns null for an empty hint,
 * "not sure" (already filtered out by parseSubmissionIssueBody), or no
 * match — the caller then tries every domain instead of just one.
 */
export function resolveDomainHint(hint, domains) {
  if (!hint) return null;
  const normalized = hint.trim().toLowerCase();
  if (!normalized) return null;
  return (
    domains.find((d) => [d.slug, d.shortName, d.name].some((v) => (v ?? "").toLowerCase() === normalized)) ??
    domains.find((d) => normalized.includes((d.shortName ?? d.slug).toLowerCase())) ??
    null
  );
}

/**
 * Human-readable reasons `meta` fails discover-candidates.mjs's
 * passesQualityBar, for a submission-rejection comment — a maintainer (or
 * the submitter) can see exactly what's missing rather than a bare "no".
 * Empty array means it passes.
 */
export function qualityBarFailureReasons(meta, { minStars = MIN_STARS, maxInactiveMonths = MAX_INACTIVE_MONTHS, now = new Date() } = {}) {
  const reasons = [];
  if (meta.stars < minStars) reasons.push(`only ${meta.stars} stars (${minStars}+ required)`);
  if (meta.isFork) reasons.push("it's a fork");
  if (meta.isArchived) reasons.push("it's archived");
  if (!meta.hasLicense) reasons.push("no license");
  const cutoff = new Date(now).getTime() - maxInactiveMonths * 30 * MS_PER_DAY;
  if (new Date(meta.pushedAt).getTime() < cutoff) reasons.push(`no commits in the last ${maxInactiveMonths} months`);
  return reasons;
}

/**
 * Renders the closing comment for every possible outcome. Every path ends
 * in a close, whether the submission was a hit, a clean reject, or the
 * issue simply wasn't in a shape this pipeline understood — a submission
 * issue is a one-off request, not a durable tracking record the way the
 * old daily review queue was, so there's nothing gained by leaving it
 * open either way.
 */
export function formatSubmissionComment(outcome) {
  switch (outcome.type) {
    case "committed":
      return `✅ Added **${outcome.id}** to ${outcome.domainName} under "${outcome.path.join(" / ")}". Thanks for the suggestion!`;
    case "already-exists":
      return `**${outcome.id}** is already curated on the site — nothing to do here. Closing.`;
    case "quality-bar-failed":
      return `Thanks for the suggestion, but **${outcome.id}** doesn't clear the automated quality bar yet: ${outcome.reasons.join(", ")}. Feel free to re-open if that changes.`;
    case "no-fit":
      return `**${outcome.id}** doesn't clearly fit any current map (${outcome.reason}). If you think it deserves a map of its own, open a [New domain proposal](../../issues/new?template=new-domain-proposal.md) instead.`;
    case "invalid":
      return `Couldn't resolve **${outcome.id}** to a real GitHub repo (${outcome.reason}) — please re-open with a working link, e.g. https://github.com/owner/repo.`;
    case "unparseable":
    default:
      return "Couldn't parse this issue into a project submission — please use the [Suggest a project](../../issues/new?template=suggest-a-project.md) template.";
  }
}

// CLI entry point: node scripts/process-submission.mjs --issue <number>
// Auto-processes one "Suggest a project" issue end to end — parse, quality
// bar, classify against the hinted map (or every map), commit or reject —
// and always closes the issue with a comment explaining the outcome,
// whether it was opened by the /submit/ page or typed by hand. Thin I/O
// orchestration, not unit tested (same convention as discover-projects.mjs's
// main()); the pure parsing/formatting helpers above are.
async function main() {
  const issueFlagIndex = process.argv.indexOf("--issue");
  const issueNumber = issueFlagIndex !== -1 ? process.argv[issueFlagIndex + 1] : process.env.SUBMISSION_ISSUE_NUMBER;
  if (!issueNumber) {
    console.error("Error: --issue <number> (or SUBMISSION_ISSUE_NUMBER) is required.");
    process.exit(1);
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    console.error("Error: OPENROUTER_API_KEY is not set.");
    process.exit(1);
  }

  const ghToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const getJson = createGetJson(ghToken);

  const issue = JSON.parse(execFileSync("gh", ["issue", "view", issueNumber, "--json", "body,state"], { encoding: "utf8" }));
  if (issue.state === "CLOSED") {
    console.log(`#${issueNumber} is already closed, nothing to do.`);
    return;
  }

  function close(outcome) {
    execFileSync("gh", ["issue", "close", issueNumber, "--comment", formatSubmissionComment(outcome)], { stdio: "inherit" });
    console.log(`Closed #${issueNumber}: ${outcome.type}`);
  }

  const parsed = parseSubmissionIssueBody(issue.body);
  if (!parsed) return close({ type: "unparseable" });

  const { projectId, targetMapHint } = parsed;
  const domains = loadAllDomains();

  const existingIds = new Set(domains.flatMap((d) => d.projects.map((p) => p.id)));
  if (existingIds.has(projectId)) return close({ type: "already-exists", id: projectId });

  let meta;
  try {
    meta = await withRetry(() => fetchRepoMetadata(projectId, { getJson }));
  } catch (err) {
    return close({ type: "invalid", id: projectId, reason: err.message });
  }
  if (!meta) return close({ type: "invalid", id: projectId, reason: "not a valid GitHub repo" });

  const reasons = qualityBarFailureReasons(meta);
  if (reasons.length > 0) return close({ type: "quality-bar-failed", id: projectId, reasons });

  const hintedDomain = resolveDomainHint(targetMapHint, domains);
  const candidateDomains = hintedDomain ? [hintedDomain] : domains;

  let committed = null;
  let lastReason = "no configured map's classifier found it a fit";
  for (const domain of candidateDomains) {
    let classified;
    try {
      classified = await withRetry(() => classifyCandidates(domain, [meta], { callLlm: (prompt) => callOpenRouterApi(prompt, { apiKey: openRouterKey }) }));
    } catch (err) {
      lastReason = err.message;
      continue;
    }
    const [entry] = classified;
    if (!entry || entry.fits !== true) {
      lastReason = entry?.reason ?? lastReason;
      continue;
    }
    const [resolved] = selectAutoCommit(classified);
    if (!resolved) continue;

    const [, repoName] = projectId.split("/");
    let enriched;
    try {
      enriched = await enrichProject(
        {
          schemaVersion: SCHEMA_VERSION,
          id: projectId,
          link: `https://github.com/${projectId}`,
          name: repoName,
          desc: meta.description,
          githubName: null,
          githubDescription: null,
          tags: meta.topics,
          history: [],
        },
        { getJson },
      );
    } catch (err) {
      lastReason = `enrichment failed: ${err.message}`;
      continue;
    }
    if (typeof enriched.weight !== "number" || !Number.isInteger(enriched.weight) || enriched.weight <= 0) {
      lastReason = "enrichment didn't produce a valid weight";
      continue;
    }

    saveProjectEntity(enriched);
    domain.projects.push({ id: projectId, path: resolved.path });
    saveDomain(domain);
    committed = { domainName: domain.shortName ?? domain.name, path: resolved.path };
    break;
  }

  if (committed) return close({ type: "committed", id: projectId, ...committed });
  return close({ type: "no-fit", id: projectId, reason: lastReason });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
