import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { computeLeaderboard } from "./leaderboard.mjs";
import { loadAllDomains, loadAllProjectEntities, joinDomainProjects } from "./data-store.mjs";

const WINDOW_DAYS = 7;
const LIMIT = 5;

/** Formats risers as a GitHub-flavored Markdown numbered list, one project per line. */
function formatRiserLines(risers) {
  return risers.map((r, i) => {
    const sign = r.starDelta > 0 ? "+" : "";
    const pct = r.percentDelta.toFixed(1);
    return `${i + 1}. **[${r.name}](${r.link})** (${r.domain}) — ${sign}${r.starDelta} stars (${sign}${pct}%)`;
  });
}

/**
 * Formats a list of risers (from `computeLeaderboard`) into a
 * GitHub-flavored Markdown digest body. Returns a placeholder message
 * instead of an empty list when there aren't enough snapshots yet, so
 * the digest reads as "not ready yet" rather than "nothing is rising".
 */
export function formatDigest(risers, { windowDays = WINDOW_DAYS } = {}) {
  if (risers.length === 0) {
    return `Not enough star-history yet to compute ${windowDays}-day growth. This digest will start reporting once daily snapshots cover a full ${windowDays}-day window.`;
  }

  return [`Biggest risers on [awesomemap](https://awesomemap.dev/) over the last ${windowDays} days:`, "", ...formatRiserLines(risers)].join("\n");
}

/**
 * Formats risers for embedding in the README (see `updateReadme`): just the
 * numbered list, no digest intro line, since that context is already set by
 * the surrounding README section. Same not-ready placeholder as
 * `formatDigest` for an empty list.
 */
export function renderReadmeRisers(risers, { windowDays = WINDOW_DAYS } = {}) {
  if (risers.length === 0) {
    return `_Not enough star-history yet to compute ${windowDays}-day growth — check back once daily snapshots cover a full ${windowDays}-day window._`;
  }

  return formatRiserLines(risers).join("\n");
}

const README_RISERS_START = "<!-- risers:start -->";
const README_RISERS_END = "<!-- risers:end -->";

/**
 * Splices `sectionMarkdown` into `readme` between the risers markers,
 * replacing whatever was there before. Throws if the markers aren't
 * present, so a renamed/removed marker fails the workflow loudly instead
 * of silently leaving the README stale.
 */
export function updateReadme(readme, sectionMarkdown, { startMarker = README_RISERS_START, endMarker = README_RISERS_END } = {}) {
  const startIdx = readme.indexOf(startMarker);
  const endIdx = readme.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error("README risers markers not found");
  }

  const before = readme.slice(0, startIdx + startMarker.length);
  const after = readme.slice(endIdx);
  return `${before}\n${sectionMarkdown}\n${after}`;
}

// CLI entry point: node scripts/social-digest.mjs
// Reads every data/domains/<slug>.json + data/projects/**/*.json, computes
// the week's top risers, and opens a GitHub issue with the digest so it's
// public content ready to reuse for social posts — no external
// credentials needed, same GITHUB_TOKEN pattern as snapshot-history.mjs.
// Thin I/O orchestration, not unit tested (same convention as
// generate.mjs's main()).
function main() {
  const rawDomains = loadAllDomains();
  const projectEntities = loadAllProjectEntities();
  const domains = rawDomains.map((domain) => ({ ...domain, projects: joinDomainProjects(domain, projectEntities) }));

  const risers = computeLeaderboard(domains, { scope: "global", windowDays: WINDOW_DAYS, limit: LIMIT });
  const body = formatDigest(risers, {});

  const readmePath = "README.md";
  const readme = readFileSync(readmePath, "utf8");
  const updatedReadme = updateReadme(readme, renderReadmeRisers(risers, {}));
  if (updatedReadme !== readme) {
    writeFileSync(readmePath, updatedReadme);
    console.log("Updated README risers section.");
  } else {
    console.log("README risers section unchanged.");
  }

  if (risers.length === 0) {
    console.log("Skipping issue creation: " + body);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  execFileSync("gh", ["issue", "create", "--title", `📈 Biggest risers — week of ${today}`, "--body", body, "--label", "digest"], {
    stdio: "inherit",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
