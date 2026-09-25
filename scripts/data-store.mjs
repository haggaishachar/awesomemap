// Read-only HTTP client for awesomemap-data's public API — the site's
// build (generate.mjs) is the only consumer, replacing the old fs-based
// version that read data/domains/*.json + data/projects/**/*.json
// directly. See
// docs/superpowers/specs/2026-09-04-awesomemap-data-api-wiring-design.md.
//
// Mirrors the exported names/shapes of awesomemap-data's own
// scripts/data-store.mjs (loadAllDomains, loadAllProjectEntities,
// joinDomainProjects, SCHEMA_VERSION) but read-only — nothing in this
// repo writes data anymore, so there's no save*/write plumbing or
// internal-token handling here.
//
// Configuration: AWESOMEMAP_DATA_API_URL (base URL of the deployed
// Worker), defaulting to the live production API. The default matters:
// pr-check.yml runs on pull_request, including from forks, and GitHub
// does not expose repo secrets to fork-PR runs — local dev and fork-PR
// checks both need this to work with zero configuration.

export const SCHEMA_VERSION = 1;

function baseUrl() {
  // `||`, not `??`: GitHub Actions injects an env var declared in a
  // workflow's `env:` block as an empty string (not an absent variable)
  // whenever the secret it references doesn't exist — e.g.
  // `AWESOMEMAP_DATA_API_URL: ${{ secrets.AWESOMEMAP_DATA_API_URL }}` in
  // deploy.yml becomes `AWESOMEMAP_DATA_API_URL=""` if that secret was
  // ever unset. `??` only falls back on null/undefined, so it would build
  // a broken relative URL ("/domains") instead of the production default
  // — this happened in production (deploy.yml run 33898487635, "Failed to
  // parse URL from /domains") after the secret was removed from the repo.
  return (process.env.AWESOMEMAP_DATA_API_URL || "https://awesomemap-data.haggai-shachar.workers.dev").replace(/\/$/, "");
}

async function apiFetch(path, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${baseUrl()}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText} ${text}`.trim());
  }
  return res.json();
}

/** Loads every domain (with its membership list), sorted by slug. */
export async function loadAllDomains({ fetchImpl } = {}) {
  const domains = (await apiFetch("/domains", { fetchImpl })) ?? [];
  return [...domains].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Loads every project entity (full — including tags/history/events) into a Map keyed by id. */
export async function loadAllProjectEntities({ fetchImpl } = {}) {
  const projects = (await apiFetch("/projects", { fetchImpl })) ?? [];
  return new Map(projects.map((entity) => [entity.id, entity]));
}

/**
 * Joins a domain's membership list against the full project-entity map,
 * returning one merged object per project — every entity field plus that
 * domain's own `path` for this project. Pure. Throws on a dangling
 * reference (a membership id with no entity), the same "fail loudly on
 * bad data" convention the pre-split repo used.
 */
export function joinDomainProjects(domain, entitiesById) {
  return domain.projects.map(({ id, path }) => {
    const entity = entitiesById.get(id);
    if (!entity) {
      throw new Error(`domain "${domain.slug}": project "${id}" has no project entity`);
    }
    return { ...entity, path };
  });
}

/**
 * Lists every archived ISO week (issue #99's weekly rising archive),
 * newest first. Each entry is `{isoWeek, generatedAt}` — the full
 * per-week leaderboard data is a separate call (`loadLeaderboardSnapshot`)
 * so a page that only needs the week list (e.g. the archive index) never
 * pays for fetching every week's rows.
 */
export async function loadLeaderboardSnapshots({ fetchImpl } = {}) {
  return (await apiFetch("/leaderboard-snapshots", { fetchImpl })) ?? [];
}

/**
 * Loads one ISO week's full leaderboard snapshot: `{isoWeek, generatedAt,
 * scopes: {global: row[], [domainSlug]: row[]}}`, each row already
 * carrying display fields (name/link/image/domain) — no further joining
 * needed by the caller. Only call this for a week `loadLeaderboardSnapshots`
 * already confirmed exists; a nonexistent week 404s, which `apiFetch`
 * surfaces as a thrown error rather than `null` (unlike
 * awesomemap-data's own client — this repo's `apiFetch` has no 404-to-null
 * carve-out, and generate.mjs's usage never needs one).
 */
export async function loadLeaderboardSnapshot(isoWeek, { fetchImpl } = {}) {
  return apiFetch(`/leaderboard-snapshots/${isoWeek}`, { fetchImpl });
}
