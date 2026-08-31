import { execFileSync } from "node:child_process";
import { parseGhRepo, createGetJson } from "./enrich-domain.mjs";
import { MS_PER_DAY } from "./velocity.mjs";
import { loadAllProjectEntities, saveProjectEntity } from "./data-store.mjs";

const MAX_AGE_DAYS = 120;

/**
 * Inserts today's snapshot (see `buildSnapshotEntry`) into a project's
 * history array, keeping entries sorted ascending by date. A snapshot
 * sharing an existing entry's date replaces that entry rather than
 * duplicating it, so running the job twice in one day is a no-op the
 * second time.
 */
export function appendSnapshotEntry(entries, snapshot) {
  const withoutSameDate = entries.filter((entry) => entry.date !== snapshot.date);
  return [...withoutSameDate, snapshot].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Drops entries older than `maxAgeDays` relative to `now`. 120 days
 * comfortably covers the longest supported rising window (90 days) with
 * headroom, keeping history arrays small and bounded.
 */
export function pruneOldEntries(entries, { now = new Date(), maxAgeDays = MAX_AGE_DAYS } = {}) {
  const cutoff = new Date(now).getTime() - maxAgeDays * MS_PER_DAY;
  return entries.filter((entry) => new Date(entry.date).getTime() >= cutoff);
}

function todayIso(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Maps a GitHub repo API response onto today's history entry: stars,
 * forks, and open issues ride along for free since they're already in the
 * same response the daily job fetches for `stargazers_count`, no extra API
 * call needed. GitHub's own `name`/`description` are handled separately
 * (see `main()`) — they're upserted directly onto the project entity, not
 * carried on every history entry, since only the latest value is ever
 * needed (drift detection against the curated `name`/`desc`, not an audit
 * trail of every past rename).
 */
export function buildSnapshotEntry(repoData, date) {
  return {
    date,
    stars: repoData.stargazers_count,
    forks: repoData.forks_count,
    openIssues: repoData.open_issues_count,
  };
}

// CLI entry point: node scripts/snapshot-history.mjs
// Snapshots every project entity in data/projects/**/*.json, appending
// today's entry to its `history` and upserting `githubName`/
// `githubDescription` from the same API response. Thin I/O orchestration,
// not unit tested (same convention as generate.mjs / enrich-domain.mjs's
// main()) — verified manually.
async function main() {
  const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const getJson = createGetJson(token);

  const today = todayIso(new Date());
  const entitiesById = loadAllProjectEntities();

  let totalAttempted = 0;
  let totalFetched = 0;
  let failed = 0;

  for (const entity of entitiesById.values()) {
    const repo = parseGhRepo(entity.id);
    if (!repo) continue;
    totalAttempted += 1;
    try {
      const repoData = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}`);
      const withToday = appendSnapshotEntry(entity.history ?? [], buildSnapshotEntry(repoData, today));
      const history = pruneOldEntries(withToday, { now: new Date() });
      saveProjectEntity({ ...entity, githubName: repoData.name, githubDescription: repoData.description, history });
      totalFetched += 1;
    } catch (err) {
      failed += 1;
      console.error(`Warning: failed to snapshot "${entity.id}": ${err.message}`);
    }
  }

  console.log(`${totalFetched}/${totalAttempted} project(s) snapshotted, ${failed} failed`);

  if (totalAttempted > 0 && totalFetched === 0) {
    console.error(
      `Error: 0/${totalAttempted} project(s) were successfully snapshotted — ` +
        "this looks like a systemic failure (e.g. an invalid/expired token or a GitHub outage), not isolated per-project flakiness."
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
