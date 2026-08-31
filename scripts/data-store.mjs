// Shared read/write layer for the data/ directory's two entity kinds (MVP.md
// item 1, "Data structure refactor"):
//
//   data/domains/<slug>.json          — domain entity + membership only:
//                                       {schemaVersion, slug, name,
//                                       shortName, description,
//                                       projects: [{id, path}]}
//   data/projects/<owner>/<repo>.json — one file per project entity:
//                                       {schemaVersion, id, link, name, desc,
//                                       githubName, githubDescription,
//                                       weight, image, tags, history}
//
// Every script that used to read/write `data/<slug>.json` +
// `data/history/<slug>.json` directly goes through this module instead, so
// the join between a domain's membership list and each project's own
// record (and the on-disk path convention for a project file) is decided
// exactly once.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { parseGhRepo } from "./enrich-domain.mjs";

export const DOMAINS_DIR = "data/domains";
export const PROJECTS_DIR = "data/projects";
export const SCHEMA_VERSION = 1;

/** The on-disk path a project entity's `id` maps to — `owner/repo` -> `data/projects/owner/repo.json`. */
export function projectFilePath(id) {
  const repo = parseGhRepo(id);
  if (!repo) throw new Error(`project "${id}": not a valid "owner/repo" id, can't place it under ${PROJECTS_DIR}/`);
  return `${PROJECTS_DIR}/${repo.owner}/${repo.repo}.json`;
}

/**
 * Loads every `data/domains/<slug>.json` file, sorted by slug so callers get
 * a deterministic order independent of `readdirSync`'s own (filesystem-
 * dependent) ordering. Each domain's `projects` is membership-only —
 * `{id, path}` — never a project's own metadata; join against
 * `loadAllProjectEntities`'s result (see `joinDomainProjects`) for that.
 */
export function loadAllDomains() {
  if (!existsSync(DOMAINS_DIR)) return [];
  const files = readdirSync(DOMAINS_DIR).filter((name) => name.endsWith(".json"));
  const domains = files.map((file) => {
    const domainPath = `${DOMAINS_DIR}/${file}`;
    try {
      return JSON.parse(readFileSync(domainPath, "utf8"));
    } catch (err) {
      throw new Error(`${domainPath}: invalid JSON — ${err.message}`);
    }
  });
  return domains.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Loads every `data/projects/<owner>/<repo>.json` file into a `Map` keyed by
 * `id`. Walks exactly two levels deep (owner directory, then repo files) —
 * the same shape `projectFilePath` writes.
 */
export function loadAllProjectEntities() {
  const byId = new Map();
  if (!existsSync(PROJECTS_DIR)) return byId;
  const ownerDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const ownerDir of ownerDirs) {
    const ownerPath = `${PROJECTS_DIR}/${ownerDir.name}`;
    const repoFiles = readdirSync(ownerPath).filter((name) => name.endsWith(".json"));
    for (const file of repoFiles) {
      const entityPath = `${ownerPath}/${file}`;
      let entity;
      try {
        entity = JSON.parse(readFileSync(entityPath, "utf8"));
      } catch (err) {
        throw new Error(`${entityPath}: invalid JSON — ${err.message}`);
      }
      byId.set(entity.id, entity);
    }
  }
  return byId;
}

/** Reads one project entity by id, or `null` if it has no file yet. */
export function loadProjectEntity(id) {
  const path = projectFilePath(id);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Writes one project entity to its conventional path, creating the owner directory as needed. */
export function saveProjectEntity(entity) {
  const path = projectFilePath(entity.id);
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, JSON.stringify(entity, null, 2) + "\n");
}

/**
 * Writes a domain's membership file, stripping any joined project fields
 * back down to `{id, path}` — so a caller that read a domain via
 * `joinDomainProjects` can pass its (now project-metadata-carrying)
 * `projects` array straight back in without hand-picking fields itself.
 */
export function saveDomain(domain) {
  mkdirSync(DOMAINS_DIR, { recursive: true });
  const out = {
    schemaVersion: domain.schemaVersion ?? SCHEMA_VERSION,
    slug: domain.slug,
    name: domain.name,
    shortName: domain.shortName,
    description: domain.description,
    projects: domain.projects.map((project) => ({ id: project.id, path: project.path })),
  };
  writeFileSync(`${DOMAINS_DIR}/${domain.slug}.json`, JSON.stringify(out, null, 2) + "\n");
}

/**
 * Joins a domain's membership list against the full project-entity map,
 * returning one merged object per project — every entity field plus that
 * domain's own `path` for this project. Throws on a dangling reference (a
 * membership id with no entity file), the same "fail loudly on bad data"
 * convention `generate.mjs`'s Pass 1 already applies to missing `id`/`path`.
 */
export function joinDomainProjects(domain, entitiesById) {
  return domain.projects.map(({ id, path }) => {
    const entity = entitiesById.get(id);
    if (!entity) {
      throw new Error(`domain "${domain.slug}": project "${id}" has no data/projects/ entity file`);
    }
    return { ...entity, path };
  });
}
