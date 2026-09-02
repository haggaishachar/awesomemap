// Daily job (added as a step in .github/workflows/snapshot-history.yml,
// same commit as the star snapshot) that fetches external "why did this
// grow" events for every project entity and appends them to a new `events`
// array, alongside `history` (see data-store.mjs). One free, deterministic
// source for v1 — no LLM classification (see product.md's Data foundation
// section for that as a future refinement):
//
//   - HN discussions whose submitted url points at the repo (Algolia HN
//     Search API, unauthenticated), kept only above a points threshold.
//
// GitHub releases were dropped after a first production run — release
// noise (routine version bumps) outweighed the signal, unlike HN mentions
// which are inherently curated by real discussion/upvotes.
//
// Unlike `history`, `events` is never pruned — events are sparse enough
// (a handful a year even for an active repo) that the full timeline is
// worth keeping; scripts/render-page.mjs caps the *rendered* slice
// instead.
import { parseGhRepo, withRetry } from "./enrich-domain.mjs";
import { loadAllProjectEntities, saveProjectEntity } from "./data-store.mjs";

const HN_POINTS_THRESHOLD = 50;
const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search";

/** Builds the Algolia HN search URL for stories whose url field matches this repo. */
export function buildHnSearchUrl(owner, repo) {
  const params = new URLSearchParams({
    query: `${owner}/${repo}`,
    restrictSearchableAttributes: "url",
    tags: "story",
    hitsPerPage: "50",
  });
  return `${HN_SEARCH_URL}?${params.toString()}`;
}

/**
 * True when an Algolia HN search hit's own url actually points at this
 * repo. Algolia's `restrictSearchableAttributes=url` search is tokenized,
 * not an exact match — querying "facebook/react" can surface a story about
 * an unrelated, similarly-named repo. This is the precision backstop: only
 * a hit whose url contains `github.com/<owner>/<repo>` survives.
 */
export function hnHitMatchesRepo(hit, owner, repo) {
  const url = typeof hit?.url === "string" ? hit.url.toLowerCase() : "";
  return url.includes(`github.com/${owner}/${repo}`.toLowerCase());
}

/**
 * Maps one Algolia HN search hit onto an event entry — the event links to
 * the HN discussion itself (not back to the repo the reader is already
 * on). `created_at` is a full ISO timestamp; only the date portion is
 * kept, matching every other event/history entry's `date` shape.
 */
export function mapHnHit(hit) {
  return {
    date: hit.created_at.slice(0, 10),
    type: "hn",
    title: hit.title,
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    points: hit.points,
  };
}

/**
 * Fetches this repo's HN mentions, filtered to real url matches (see
 * `hnHitMatchesRepo`) at or above `pointsThreshold`, mapped to event
 * entries. `fetchImpl` is injectable for testing, same convention as
 * `enrich-domain.mjs`'s `createGetJson`.
 */
export async function fetchHnEvents(owner, repo, { fetchImpl = fetch, pointsThreshold = HN_POINTS_THRESHOLD } = {}) {
  const data = await withRetry(async () => {
    const res = await fetchImpl(buildHnSearchUrl(owner, repo));
    if (!res.ok) {
      const err = new Error(`${res.status} ${res.statusText} for HN search of ${owner}/${repo}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  return hits
    .filter((hit) => hnHitMatchesRepo(hit, owner, repo) && typeof hit.points === "number" && hit.points >= pointsThreshold)
    .map(mapHnHit);
}

/**
 * Merges newly-fetched events into a project's existing `events` array,
 * deduped by `url` (an event's natural identity — an HN thread has exactly
 * one URL), sorted ascending by date. A url shared with an existing entry
 * is replaced rather than duplicated — the same "re-running is a no-op /
 * re-running picks up fresh data" property `snapshot-history.mjs`'s
 * `appendSnapshotEntry` has for `history`, and additionally lets a
 * re-fetched HN entry's `points` climb as a thread gains votes instead of
 * staying frozen at first-seen.
 */
export function appendEventEntries(existing, newEvents) {
  const byUrl = new Map();
  for (const event of existing ?? []) byUrl.set(event.url, event);
  for (const event of newEvents) byUrl.set(event.url, event);
  return [...byUrl.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// CLI entry point: node scripts/snapshot-events.mjs
// Snapshots every project entity in data/projects/**/*.json, merging fresh
// HN events into its `events` array. Thin I/O orchestration, not unit
// tested (same convention as snapshot-history.mjs's main()) — verified
// manually.
async function main() {
  const entitiesById = loadAllProjectEntities();

  let totalAttempted = 0;
  let totalFetched = 0;
  let failed = 0;

  for (const entity of entitiesById.values()) {
    const repo = parseGhRepo(entity.id);
    if (!repo) continue;
    totalAttempted += 1;
    try {
      const hnEvents = await fetchHnEvents(repo.owner, repo.repo);
      const events = appendEventEntries(entity.events, hnEvents);
      saveProjectEntity({ ...entity, events });
      totalFetched += 1;
    } catch (err) {
      failed += 1;
      console.error(`Warning: failed to snapshot events for "${entity.id}": ${err.message}`);
    }
  }

  console.log(`${totalFetched}/${totalAttempted} project(s) had events snapshotted, ${failed} failed`);

  if (totalAttempted > 0 && totalFetched === 0) {
    console.error(
      `Error: 0/${totalAttempted} project(s) were successfully snapshotted — ` +
        "this looks like a systemic failure (e.g. an invalid/expired token or an API outage), not isolated per-project flakiness."
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
