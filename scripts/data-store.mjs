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
//
// Fixture mode: when AWESOMEMAP_DATA_FIXTURE_DIR is set, every read comes
// from `<dir><path>.json` (e.g. test/fixtures/api/domains.json) instead of
// the network. pr-check.yml builds this way, so a PR's check proves its
// code change still builds a valid site without depending on the live
// Worker being up; deploy.yml still builds from the real API. Project
// history/event dates are shifted so the newest history date is today
// (`rebaseProjectDates`) — the build's growth windows are measured back
// from the current date, and a fixed fixture would otherwise age into
// empty windows.

import { readFileSync } from "node:fs";
import { withTrustedEvents } from "./project-events.mjs";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

/** Shifts a `YYYY-MM-DD` date by `days`. */
function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Returns copies of `projects` with every history and event date moved by
 * the same number of days, so the newest history date across all of them
 * lands on `now`'s UTC date. Gaps between dates are preserved. Used only
 * by fixture mode (see the top of this file).
 */
export function rebaseProjectDates(projects, now = new Date()) {
  const newest = projects.flatMap((p) => (p.history ?? []).map((h) => h.date)).sort().at(-1);
  if (!newest) return projects;
  const offset = Math.round((Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${newest}T00:00:00Z`)) / MS_PER_DAY);
  return projects.map((p) => ({
    ...p,
    ...(p.history ? { history: p.history.map((h) => ({ ...h, date: shiftDate(h.date, offset) })) } : {}),
    ...(p.events ? { events: p.events.map((e) => ({ ...e, date: shiftDate(e.date, offset) })) } : {}),
  }));
}

/** Fixture-mode read: `<dir><path>.json`, with project dates rebased to today. Throws naming the file when it's missing. */
function fixtureFetch(dir, path) {
  const file = `${dir.replace(/\/$/, "")}${path}.json`;
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`fixture mode: can't read ${file} (${err.message})`);
  }
  return path === "/projects" ? rebaseProjectDates(data) : data;
}

async function apiFetch(path, { fetchImpl = fetch } = {}) {
  const fixtureDir = process.env.AWESOMEMAP_DATA_FIXTURE_DIR;
  if (fixtureDir) return fixtureFetch(fixtureDir, path);
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

/** Loads every project entity (full — including tags/history/events) into a Map keyed by id, with wrong-project blog events dropped (`withTrustedEvents`). */
export async function loadAllProjectEntities({ fetchImpl } = {}) {
  const projects = (await apiFetch("/projects", { fetchImpl })) ?? [];
  return new Map(projects.map((entity) => [entity.id, withTrustedEvents(entity)]));
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
