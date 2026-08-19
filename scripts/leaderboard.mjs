import { computeVelocity, MS_PER_DAY } from "./velocity.mjs";

/**
 * Collects every eligible candidate for one scope ("global" or a domain
 * slug), as of `asOf`. `asOf` must be a `Date`. A candidate is eligible
 * when `computeVelocity` reports enough history for `windowDays` using
 * only history entries dated on or before `asOf` — this is what lets the
 * same function compute "today's" candidates and "yesterday's" candidates
 * just by varying `asOf`, with no separate stored rank data.
 *
 * For `scope: "global"`, a project listed in more than one domain is
 * deduped to its single best-scoring listing (ties keep whichever domain
 * was encountered first).
 */
function collectCandidates(domains, historyBySlug, scope, windowDays, asOf) {
  const relevantDomains = scope === "global" ? domains : domains.filter((d) => d.slug === scope);
  const asOfDateStr = asOf.toISOString().slice(0, 10);

  const candidates = [];
  for (const domain of relevantDomains) {
    const history = historyBySlug[domain.slug] ?? {};
    for (const project of domain.projects) {
      const truncated = (history[project.id] ?? []).filter((entry) => entry.date <= asOfDateStr);
      const velocity = computeVelocity(truncated, windowDays, { now: asOf });
      if (!velocity.hasEnoughHistory) continue;
      // A leaderboard called "Rising"/"risers" must never surface a flat or
      // shrinking project — mirrors the filter the removed computeTopRisers
      // used to apply in social-digest.mjs.
      if (velocity.starDelta <= 0) continue;
      candidates.push({
        id: project.id,
        name: project.name,
        link: project.link,
        image: project.image,
        domain: domain.name,
        domainSlug: domain.slug,
        score: velocity.score,
        starDelta: velocity.starDelta,
        percentDelta: velocity.percentDelta,
      });
    }
  }

  if (scope !== "global") return candidates;

  const bestById = new Map();
  for (const candidate of candidates) {
    const existing = bestById.get(candidate.id);
    if (!existing || candidate.score > existing.score) bestById.set(candidate.id, candidate);
  }
  return [...bestById.values()];
}

/** Sorts candidates by score descending (ties broken by name) and assigns 1-based `rank`. */
function rankCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return sorted.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/**
 * Computes a ranked, rank-diffed leaderboard for one scope ("global" or a
 * domain slug) and window. A project appears only when it has enough
 * history to rank both today and "yesterday" (`now` minus one day) — so
 * every returned entry always has a real prior rank to diff against, and
 * there's no ambiguous "new entry" case to special-case downstream.
 * `domains` is the raw `data/<slug>.json` shape (each
 * `{ slug, name, projects }`); `historyBySlug` maps slug to that domain's
 * `data/history/<slug>.json` contents.
 */
export function computeLeaderboard(domains, historyBySlug, { scope, windowDays, limit = 20, now = new Date() }) {
  const nowDate = new Date(now);
  const yesterdayDate = new Date(nowDate.getTime() - MS_PER_DAY);

  const todayCandidates = collectCandidates(domains, historyBySlug, scope, windowDays, nowDate);
  const yesterdayCandidates = collectCandidates(domains, historyBySlug, scope, windowDays, yesterdayDate);

  // Intersect by id BEFORE ranking, so both today's and yesterday's ranks are
  // computed over the same population — otherwise rank numbers gap once
  // ineligible candidates are filtered out, and rankDelta ends up diffing two
  // differently-populated rank spaces.
  const yesterdayById = new Map(yesterdayCandidates.map((c) => [c.id, c]));
  const eligibleTodayCandidates = todayCandidates.filter((c) => yesterdayById.has(c.id));

  const todayRanked = rankCandidates(eligibleTodayCandidates);
  const yesterdayRanked = rankCandidates(eligibleTodayCandidates.map((c) => yesterdayById.get(c.id)));
  const yesterdayRankById = new Map(yesterdayRanked.map((c) => [c.id, c.rank]));

  return todayRanked
    .slice(0, limit)
    .map((c) => ({
      rank: c.rank,
      id: c.id,
      name: c.name,
      link: c.link,
      image: c.image,
      domain: c.domain,
      domainSlug: c.domainSlug,
      starDelta: c.starDelta,
      percentDelta: c.percentDelta,
      rankDelta: yesterdayRankById.get(c.id) - c.rank,
    }));
}
