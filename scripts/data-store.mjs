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
  return (process.env.AWESOMEMAP_DATA_API_URL ?? "https://awesomemap-data.haggai-shachar.workers.dev").replace(/\/$/, "");
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
