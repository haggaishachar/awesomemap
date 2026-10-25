/**
 * "Related projects" for a project page — its nearest neighbours in the
 * catalog, so a visitor who lands on one project (usually from search) has
 * somewhere to go next besides back. Also the main source of internal links
 * between the ~1,700 project pages, which otherwise only link out to their
 * domain, category and tags.
 *
 * Closeness comes from data every project already has: the category path
 * it sits in (sharing the top-level category matters most, sharing a deeper
 * level more still) and its GitHub topics. Ties go to whichever neighbour
 * gained more stars this week, then the bigger one — the momentum the rest
 * of the site ranks by, and a stable order across daily rebuilds.
 */

const SAME_DOMAIN = 1;
const SAME_CATEGORY = 4;
const PER_DEEPER_LEVEL = 2;
const PER_SHARED_TAG = 1;

/** Number of leading `path` segments two projects share. */
function sharedPathDepth(a, b) {
  let depth = 0;
  while (depth < a.length && depth < b.length && a[depth] === b[depth]) depth += 1;
  return depth;
}

/**
 * How related `candidate` is to `project` — 0 when they share neither a
 * category nor a tag (same domain alone isn't enough to call two projects
 * related). Both carry `domainSlug`, `path` and `tags`.
 */
export function relatednessScore(project, candidate) {
  const sameDomain = project.domainSlug === candidate.domainSlug;
  const depth = sameDomain ? sharedPathDepth(project.path ?? [], candidate.path ?? []) : 0;
  const candidateTags = new Set(candidate.tags ?? []);
  const sharedTags = (project.tags ?? []).filter((tag) => candidateTags.has(tag)).length;
  if (depth === 0 && sharedTags === 0) return 0;
  const categoryScore = depth > 0 ? SAME_CATEGORY + (depth - 1) * PER_DEEPER_LEVEL : 0;
  return (sameDomain ? SAME_DOMAIN : 0) + categoryScore + sharedTags * PER_SHARED_TAG;
}

/** A candidate's 7-day star gain, or 0 when it has no tracked growth for that window. */
function weekGain(candidate) {
  const growth = candidate.growth?.rising7;
  return candidate.hasEnoughHistory?.rising7 && typeof growth?.starDelta === "number" ? growth.starDelta : 0;
}

/**
 * Up to `limit` projects most related to `project` among `candidates`
 * (which may include `project` itself — it's skipped), most related first.
 */
export function pickRelatedProjects(project, candidates, { limit = 6 } = {}) {
  return candidates
    .filter((candidate) => candidate.id !== project.id)
    .map((candidate) => ({ candidate, score: relatednessScore(project, candidate) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        weekGain(b.candidate) - weekGain(a.candidate) ||
        (b.candidate.weight ?? 0) - (a.candidate.weight ?? 0) ||
        a.candidate.id.localeCompare(b.candidate.id)
    )
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
