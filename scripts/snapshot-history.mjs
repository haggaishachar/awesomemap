import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseGhRepo, createGetJson } from "./enrich-domain.mjs";
import { MS_PER_DAY } from "./velocity.mjs";

const DATA_DIR = "data";
const HISTORY_DIR = "data/history";
const MAX_AGE_DAYS = 120;

/**
 * Inserts today's `{ date, stars }` snapshot into a tool's history array,
 * keeping entries sorted ascending by date. A snapshot sharing an existing
 * entry's date replaces that entry rather than duplicating it, so running
 * the job twice in one day is a no-op the second time.
 */
export function appendSnapshotEntry(entries, snapshot) {
  const withoutSameDate = entries.filter((entry) => entry.date !== snapshot.date);
  return [...withoutSameDate, snapshot].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Drops entries older than `maxAgeDays` relative to `now`. 120 days
 * comfortably covers the longest supported rising window (90 days) with
 * headroom, keeping history files small and bounded.
 */
export function pruneOldEntries(entries, { now = new Date(), maxAgeDays = MAX_AGE_DAYS } = {}) {
  const cutoff = new Date(now).getTime() - maxAgeDays * MS_PER_DAY;
  return entries.filter((entry) => new Date(entry.date).getTime() >= cutoff);
}

function todayIso(now) {
  return new Date(now).toISOString().slice(0, 10);
}

// CLI entry point: node scripts/snapshot-history.mjs
// Snapshots every tool in every data/<slug>.json into
// data/history/<slug>.json. Thin I/O orchestration, not unit tested (same
// convention as generate.mjs / enrich-domain.mjs's main()) — verified
// manually in Task 4.
async function main() {
  const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const getJson = createGetJson(token);
  mkdirSync(HISTORY_DIR, { recursive: true });

  const today = todayIso(new Date());
  const domainFiles = readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"));

  let totalAttempted = 0;
  let totalFetched = 0;

  for (const file of domainFiles) {
    const domain = JSON.parse(readFileSync(`${DATA_DIR}/${file}`, "utf8"));
    const historyPath = `${HISTORY_DIR}/${domain.slug}.json`;
    const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : {};

    let fetched = 0;
    let failed = 0;
    for (const tool of domain.tools) {
      const repo = parseGhRepo(tool.id);
      if (!repo) continue;
      totalAttempted += 1;
      try {
        const repoData = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
        const existing = history[tool.id] ?? [];
        const withToday = appendSnapshotEntry(existing, { date: today, stars: repoData.stargazers_count });
        history[tool.id] = pruneOldEntries(withToday, { now: new Date() });
        fetched += 1;
        totalFetched += 1;
      } catch (err) {
        failed += 1;
        console.error(`Warning: failed to snapshot "${tool.id}": ${err.message}`);
      }
    }

    writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n");
    console.log(`${historyPath}: ${fetched} snapshot(s) recorded, ${failed} failed`);
  }

  if (totalAttempted > 0 && totalFetched === 0) {
    console.error(
      `Error: 0/${totalAttempted} tool(s) were successfully snapshotted across all domains — ` +
        "this looks like a systemic failure (e.g. an invalid/expired token or a GitHub outage), not isolated per-tool flakiness."
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
