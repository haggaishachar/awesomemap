import { computeGroupGrowth, rankGroups } from "./group-growth.mjs";

/**
 * Tags too generic to ever be an interesting "top tag" — GitHub
 * campaign/meta labels that aren't technology descriptors, so no
 * self-referential or project-count filter would ever catch them.
 * Hardcoded rather than a maintained data file: this list only grows when
 * a real top-tags run surfaces another one, and re-triaging every new tag
 * against a growing denylist is exactly the ongoing curation burden this
 * module is designed to avoid (see the design spec's Non-goals).
 */
export const STOPWORD_TAGS = new Set(["hacktoberfest", "open-source", "awesome"]);

/**
 * A tag shared by fewer projects than this is dropped before ranking — a
 * tag one project uses isn't a trend, it's that project's own name for
 * itself.
 */
export const MIN_PROJECTS_PER_TAG = 2;

/**
 * A tag group needs at least this many *tracked* projects (not just
 * MIN_PROJECTS_PER_TAG's raw project count) to be eligible for "rising."
 * A 2-project group's percent growth is dominated by whichever single
 * project happens to be tracked — group-growth.mjs's own justification for
 * using a plain ratio ("stable because it's a sum over dozens of
 * projects") doesn't hold at that size, so a tag can end up "rising" only
 * because one popular repo carries it alongside one small one. This floor
 * only gates rising eligibility; a 2-project tag still qualifies for
 * MIN_PROJECTS_PER_TAG-gated popularity ranking (computeTopTags) and still
 * gets its own /tags/<slug>/ page.
 */
export const MIN_TRACKED_PROJECTS_FOR_RISING = 4;

/** Lowercases and strips everything but letters/digits, so "SciKit Learn", "scikit-learn", and "scikit_learn" all compare equal. */
function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * True when `tag` just names `project` itself — either its display name
 * (pandas tagged `pandas`) or the repo-name segment of its `id`
 * (`pandas-dev/pandas` -> `pandas`), which sometimes differs from the
 * display name (e.g. NumPy's repo is `numpy/numpy`, its display name
 * "NumPy"). A self-referential tag is never an interesting "top tag" — by
 * construction it's unique to the one project that carries it.
 */
export function isSelfReferential(tag, project) {
  const normalizedTag = normalize(tag);
  if (project.name && normalize(project.name) === normalizedTag) return true;
  const repoName = typeof project.id === "string" ? project.id.split("/").pop() : undefined;
  if (repoName && normalize(repoName) === normalizedTag) return true;
  return false;
}

/**
 * Groups `projects` by shared tag, after dropping stopword and
 * self-referential tags, then dropping any resulting group smaller than
 * `MIN_PROJECTS_PER_TAG`. Unlike category/domain grouping (one group per
 * project), a project fans out into *every* tag group it qualifies for —
 * tags are multi-valued.
 *
 * Pure grouping: no history, no ranking. `computeTopTags` (Task 2) and
 * `computeRisingTags` (Task 3) both build on this same grouping, so the
 * eligibility rules (what counts as a "real" tag) are decided exactly
 * once.
 */
export function buildTagGroups(projects) {
  const byTag = new Map();
  for (const project of projects) {
    for (const tag of project.tags ?? []) {
      if (STOPWORD_TAGS.has(tag)) continue;
      if (isSelfReferential(tag, project)) continue;
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(project);
    }
  }
  return [...byTag]
    .filter(([, groupProjects]) => groupProjects.length >= MIN_PROJECTS_PER_TAG)
    .map(([tag, groupProjects]) => ({ tag, projects: groupProjects }));
}

/**
 * Ranks tag groups by total stars descending (ties: project count
 * descending, then tag name ascending) — "top tags" mirrors what
 * "Popular" already means everywhere else on the site. History-
 * independent: a tag's popularity doesn't depend on any growth window, so
 * this needs no `historyById` and can be computed once per scope.
 */
export function computeTopTags(tagGroups, { limit } = {}) {
  const ranked = tagGroups
    .map(({ tag, projects }) => ({
      tag,
      projectCount: projects.length,
      totalStars: projects.reduce((sum, project) => sum + (typeof project.weight === "number" ? project.weight : 0), 0),
    }))
    .sort((a, b) => b.totalStars - a.totalStars || b.projectCount - a.projectCount || a.tag.localeCompare(b.tag))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}

/**
 * Ranks tag groups by growth rate over `windowDays`, reusing
 * `computeGroupGrowth` (the same group-growth math categories and domains
 * already use) and `rankGroups` (the same sort/tie-break rule) — this
 * function's only job is deciding which tag groups are *eligible*. A group
 * qualifies only when it `hasEnoughHistory` AND its aggregate
 * `starDelta > 0`, the same rule `leaderboard.mjs` applies so a list
 * called "Rising" never shows a flat or shrinking entry.
 */
export function computeRisingTags(tagGroups, windowDays, { limit, now } = {}) {
  const groups = tagGroups.map(({ tag, projects }) => ({
    key: tag,
    tag,
    projectCount: projects.length,
    totalStars: projects.reduce((sum, project) => sum + (typeof project.weight === "number" ? project.weight : 0), 0),
    growth: computeGroupGrowth(projects, windowDays, { now }),
  }));
  const eligible = groups.filter(
    (group) => group.growth.hasEnoughHistory && group.growth.starDelta > 0 && group.growth.trackedCount >= MIN_TRACKED_PROJECTS_FOR_RISING
  );
  const ranked = rankGroups(eligible).map(({ key, ...rest }) => rest);
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}
