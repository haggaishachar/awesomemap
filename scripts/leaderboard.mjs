import { computeVelocity, MS_PER_DAY } from "./velocity.mjs";
import { tierForStars } from "./tiers.mjs";

// Anomaly guard: a project more than doubling within one window from an
// already-sizeable base is almost always purchased stars or a data error
// (2026-10-19: morluto/rea, ~87k -> 314k in 7 days), not organic growth.
// Small projects doubling is normal, hence the baseline floor.
export const ANOMALY_MIN_BASELINE_STARS = 10_000;
export const ANOMALY_MAX_PERCENT_DELTA = 100;

/** True when a `computeVelocity` result looks like an implausible jump (see the constants above). */
export function isAnomalous(velocity) {
  const baselineStars = velocity.currentStars - velocity.starDelta;
  return baselineStars >= ANOMALY_MIN_BASELINE_STARS && velocity.percentDelta > ANOMALY_MAX_PERCENT_DELTA;
}

/** The candidate shape every leaderboard (and spiking.mjs) ranks — `score` is what `rankAgainstYesterday` sorts by. */
export function toCandidate(domain, project, velocity) {
  return {
    id: project.id,
    name: project.name,
    link: project.link,
    image: project.image,
    desc: project.desc,
    domain: domain.name,
    domainShort: domain.shortName ?? domain.name,
    domainSlug: domain.slug,
    score: velocity.score,
    starDelta: velocity.starDelta,
    percentDelta: velocity.percentDelta,
    currentStars: velocity.currentStars,
    tier: tierForStars(velocity.currentStars),
  };
}

/** Truncates a project's history to entries on or before `asOf` (a Date). */
function historyAsOf(project, asOf) {
  const asOfDateStr = asOf.toISOString().slice(0, 10);
  return (project.history ?? []).filter((entry) => entry.date <= asOfDateStr);
}

/**
 * For `scope: "global"`, a project listed in more than one domain is
 * deduped to its single best-scoring listing (ties keep whichever domain
 * was encountered first).
 */
export function dedupeBestById(candidates) {
  const bestById = new Map();
  for (const candidate of candidates) {
    const existing = bestById.get(candidate.id);
    if (!existing || candidate.score > existing.score) bestById.set(candidate.id, candidate);
  }
  return [...bestById.values()];
}

/**
 * Collects every eligible candidate for one scope ("global" or a domain
 * slug), as of `asOf`. `asOf` must be a `Date`. A candidate is eligible
 * when `computeVelocity` reports enough history for `windowDays` using
 * only history entries dated on or before `asOf` — this is what lets the
 * same function compute "today's" candidates and "yesterday's" candidates
 * just by varying `asOf`, with no separate stored rank data. `tier`, when
 * set, drops candidates outside that size tier *before* ranking; the tier is
 * decided from the star count as of `asOf`.
 */
function collectCandidates(domains, scope, windowDays, asOf, tier) {
  const relevantDomains = scope === "global" ? domains : domains.filter((d) => d.slug === scope);

  const candidates = [];
  for (const domain of relevantDomains) {
    for (const project of domain.projects) {
      const velocity = computeVelocity(historyAsOf(project, asOf), windowDays, { now: asOf });
      if (!velocity.hasEnoughHistory) continue;
      // A leaderboard called "Rising"/"risers" must never surface a flat or
      // shrinking project — mirrors the filter the removed computeTopRisers
      // used to apply in social-digest.mjs.
      if (velocity.starDelta <= 0) continue;
      if (isAnomalous(velocity)) continue;
      const candidate = toCandidate(domain, project, velocity);
      if (tier && candidate.tier !== tier) continue;
      candidates.push(candidate);
    }
  }

  return scope === "global" ? dedupeBestById(candidates) : candidates;
}

/** Sorts candidates by score descending (ties broken by name) and assigns 1-based `rank`. */
function rankCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return sorted.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/**
 * Ranks today's candidates and diffs each against its rank among
 * yesterday's. Only candidates eligible on both days are kept — intersected
 * by id BEFORE ranking, so both rank spaces cover the same population;
 * otherwise rank numbers gap once ineligible candidates are filtered out,
 * and rankDelta ends up diffing two differently-populated rank spaces.
 *
 * `keepNew: true` instead ranks every one of today's candidates and gives
 * the ones absent yesterday `rankDelta: 0`; the rest keep the movement
 * computed over the intersected population. For a list whose whole point
 * is timeliness (spiking.mjs), dropping a candidate on its first eligible
 * day would show every spike a day late.
 */
export function rankAgainstYesterday(todayCandidates, yesterdayCandidates, { keepNew = false } = {}) {
  const yesterdayById = new Map(yesterdayCandidates.map((c) => [c.id, c]));
  const eligibleToday = todayCandidates.filter((c) => yesterdayById.has(c.id));

  const todayRanked = rankCandidates(eligibleToday);
  const yesterdayRanked = rankCandidates(eligibleToday.map((c) => yesterdayById.get(c.id)));
  const yesterdayRankById = new Map(yesterdayRanked.map((c) => [c.id, c.rank]));

  const intersectedRanked = todayRanked.map((c) => ({ ...c, rankDelta: yesterdayRankById.get(c.id) - c.rank }));
  if (!keepNew) return intersectedRanked;

  const rankDeltaById = new Map(intersectedRanked.map((c) => [c.id, c.rankDelta]));
  return rankCandidates(todayCandidates).map((c) => ({ ...c, rankDelta: rankDeltaById.get(c.id) ?? 0 }));
}

/** The public row shape every leaderboard consumer reads. */
export function toRow(c) {
  return {
    rank: c.rank,
    id: c.id,
    name: c.name,
    link: c.link,
    image: c.image,
    desc: c.desc,
    domain: c.domain,
    domainShort: c.domainShort,
    domainSlug: c.domainSlug,
    score: c.score,
    starDelta: c.starDelta,
    percentDelta: c.percentDelta,
    currentStars: c.currentStars,
    rankDelta: c.rankDelta,
    tier: c.tier,
  };
}

/**
 * Computes a ranked, rank-diffed leaderboard for one scope ("global" or a
 * domain slug), window, and optional size `tier` (a tiers.mjs key; omitted =
 * every size). A project appears only when it has enough history to rank
 * both today and "yesterday" (`now` minus one day) — so every returned entry
 * always has a real prior rank to diff against, and there's no ambiguous
 * "new entry" case to special-case downstream. Projects failing the anomaly
 * guard (`isAnomalous`) never appear. `domains` is a domain list with each
 * project already joined against its own entity (see data-store.mjs's
 * `joinDomainProjects`) — each `{ slug, name, projects }`, where every
 * project carries its own `history` array directly.
 */
export function computeLeaderboard(domains, { scope, windowDays, limit = 20, now = new Date(), tier }) {
  const nowDate = new Date(now);
  const yesterdayDate = new Date(nowDate.getTime() - MS_PER_DAY);

  const today = collectCandidates(domains, scope, windowDays, nowDate, tier);
  const yesterday = collectCandidates(domains, scope, windowDays, yesterdayDate, tier);

  return rankAgainstYesterday(today, yesterday).slice(0, limit).map(toRow);
}

/**
 * Every project (deduped by id across domains) the anomaly guard would
 * exclude from a `windowDays` leaderboard as of `now` — for generate.mjs to
 * log, since `computeLeaderboard` itself drops them silently.
 */
export function findAnomalies(domains, { windowDays, now = new Date() }) {
  const asOf = new Date(now);
  const byId = new Map();
  for (const domain of domains) {
    for (const project of domain.projects) {
      if (byId.has(project.id)) continue;
      const velocity = computeVelocity(historyAsOf(project, asOf), windowDays, { now: asOf });
      if (velocity.hasEnoughHistory && isAnomalous(velocity)) {
        byId.set(project.id, { id: project.id, starDelta: velocity.starDelta, percentDelta: velocity.percentDelta, currentStars: velocity.currentStars });
      }
    }
  }
  return [...byId.values()];
}
