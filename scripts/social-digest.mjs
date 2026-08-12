import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { computeVelocity } from "./velocity.mjs";

const DATA_DIR = "data";
const HISTORY_DIR = "data/history";
const WINDOW_DAYS = 7;
const LIMIT = 5;

/**
 * Computes the top star-growth risers across every domain for one
 * window. `domains` is `[{ slug, name, tools }]` (raw `data/*.json`
 * shape); `historyBySlug` maps slug to that domain's
 * `data/history/<slug>.json` contents (`{ toolId: [{date, stars}] }`).
 *
 * A tool can appear once per domain it's listed in (the same tool may be
 * curated into more than one map) — each listing is scored
 * independently since its history is keyed by tool id, not by
 * domain+tool. Only tools with `hasEnoughHistory` for the window are
 * eligible, so the list is empty (not wrong) until enough daily
 * snapshots have accumulated.
 */
export function computeTopRisers(domains, historyBySlug, { windowDays = WINDOW_DAYS, limit = LIMIT, now = new Date() } = {}) {
  const candidates = [];

  for (const domain of domains) {
    const history = historyBySlug[domain.slug] ?? {};
    for (const tool of domain.tools) {
      const velocity = computeVelocity(history[tool.id] ?? [], windowDays, { now });
      if (!velocity.hasEnoughHistory || velocity.starDelta <= 0) continue;
      candidates.push({
        id: tool.id,
        name: tool.name,
        link: tool.link,
        domain: domain.name,
        starDelta: velocity.starDelta,
        percentDelta: velocity.percentDelta,
      });
    }
  }

  candidates.sort((a, b) => b.starDelta - a.starDelta);
  return candidates.slice(0, limit);
}

/**
 * Formats a list of risers (as returned by `computeTopRisers`) into a
 * GitHub-flavored Markdown digest body. Returns a placeholder message
 * instead of an empty list when there aren't enough snapshots yet, so
 * the digest reads as "not ready yet" rather than "nothing is rising".
 */
export function formatDigest(risers, { windowDays = WINDOW_DAYS } = {}) {
  if (risers.length === 0) {
    return `Not enough star-history yet to compute ${windowDays}-day growth. This digest will start reporting once daily snapshots cover a full ${windowDays}-day window.`;
  }

  const lines = risers.map((r, i) => {
    const sign = r.starDelta > 0 ? "+" : "";
    const pct = r.percentDelta.toFixed(1);
    return `${i + 1}. **[${r.name}](${r.link})** (${r.domain}) — ${sign}${r.starDelta} stars (${sign}${pct}%)`;
  });

  return [`Biggest risers on [awesomemap](https://haggaishachar.github.io/awesomemap/) over the last ${windowDays} days:`, "", ...lines].join("\n");
}

// CLI entry point: node scripts/social-digest.mjs
// Reads every data/<slug>.json + data/history/<slug>.json, computes the
// week's top risers, and opens a GitHub issue with the digest so it's
// public content ready to reuse for social posts — no external
// credentials needed, same GITHUB_TOKEN pattern as snapshot-history.mjs.
// Thin I/O orchestration, not unit tested (same convention as
// generate.mjs's main()).
function main() {
  const domainFiles = readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"));
  const domains = domainFiles.map((file) => JSON.parse(readFileSync(`${DATA_DIR}/${file}`, "utf8")));

  const historyBySlug = {};
  for (const domain of domains) {
    const historyPath = `${HISTORY_DIR}/${domain.slug}.json`;
    historyBySlug[domain.slug] = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : {};
  }

  const risers = computeTopRisers(domains, historyBySlug, {});
  const body = formatDigest(risers, {});

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
