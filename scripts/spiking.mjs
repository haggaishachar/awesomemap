// scripts/spiking.mjs
// Kept byte-identical with awesomemap-data/scripts/spiking.mjs.
import { computeVelocity, MS_PER_DAY } from "./velocity.mjs";
import { isAnomalous, toCandidate, dedupeBestById, rankAgainstYesterday, toRow } from "./leaderboard.mjs";

export const SPIKING_WINDOW_DAYS = 7;
// The project's "usual pace" is its average weekly gain over this many
// weeks, ending where this week's window starts.
export const SPIKING_BASELINE_WEEKS = 4;
// Floors that keep a big multiple from meaning nothing: a handful of stars
// on a usually-dead repo, or ordinary jitter on a huge one (bootstrap going
// 10 -> 112/week on 175k stars was the calibration case).
export const SPIKING_MIN_STAR_DELTA = 100;
export const SPIKING_MIN_SHARE_OF_STARS = 0.005;
// Pseudo-count added to the prior weekly pace so a project with ~no prior
// growth doesn't divide by ~zero.
export const SPIKING_SMOOTHING = 20;

/**
 * This week's gain vs. the project's own prior pace, as of `asOf` — or null
 * when the project isn't eligible (too little history, below a floor, or
 * anomalous). `priorWeekly` can be negative (a project that lost stars);
 * it's clamped to 0 for the multiple so the result stays finite and positive.
 */
function spikingStats(history, asOf) {
  const asOfStr = asOf.toISOString().slice(0, 10);
  const truncated = history.filter((entry) => entry.date <= asOfStr);
  const current = computeVelocity(truncated, SPIKING_WINDOW_DAYS, { now: asOf });
  if (!current.hasEnoughHistory) return null;

  const priorEnd = new Date(asOf.getTime() - SPIKING_WINDOW_DAYS * MS_PER_DAY);
  const priorEndStr = priorEnd.toISOString().slice(0, 10);
  const prior = computeVelocity(
    truncated.filter((entry) => entry.date <= priorEndStr),
    SPIKING_BASELINE_WEEKS * 7,
    { now: priorEnd }
  );
  if (!prior.hasEnoughHistory) return null;

  if (current.starDelta < SPIKING_MIN_STAR_DELTA) return null;
  if (current.starDelta < SPIKING_MIN_SHARE_OF_STARS * current.currentStars) return null;
  if (isAnomalous(current)) return null;

  const priorWeekly = prior.starDelta / SPIKING_BASELINE_WEEKS;
  const multiple = current.starDelta / (Math.max(priorWeekly, 0) + SPIKING_SMOOTHING);
  return { velocity: current, priorWeekly, multiple };
}

function collectSpikingCandidates(domains, scope, asOf) {
  const relevantDomains = scope === "global" ? domains : domains.filter((d) => d.slug === scope);
  const candidates = [];
  for (const domain of relevantDomains) {
    for (const project of domain.projects) {
      const stats = spikingStats(project.history ?? [], asOf);
      if (!stats) continue;
      candidates.push({
        ...toCandidate(domain, project, stats.velocity),
        score: stats.multiple,
        multiple: stats.multiple,
        priorWeekly: stats.priorWeekly,
      });
    }
  }
  return scope === "global" ? dedupeBestById(candidates) : candidates;
}

/**
 * The Spiking leaderboard: projects growing far faster than their own
 * usual pace this week, any size. Same scope/limit/now contract as
 * `computeLeaderboard` (leaderboard.mjs), ranked by `multiple` instead of
 * score — but a project spiking for the first time today is kept (with
 * `rankDelta: 0`) rather than waiting a day to be eligible "yesterday" too. Rows carry
 * `multiple` and `priorWeekly` on top of the usual row shape, and
 * `tier: "spiking"` so renderers can treat them as their own tab.
 */
export function computeSpiking(domains, { scope, limit = 20, now = new Date() }) {
  const nowDate = new Date(now);
  const yesterdayDate = new Date(nowDate.getTime() - MS_PER_DAY);

  const today = collectSpikingCandidates(domains, scope, nowDate);
  const yesterday = collectSpikingCandidates(domains, scope, yesterdayDate);

  return rankAgainstYesterday(today, yesterday, { keepNew: true })
    .slice(0, limit)
    .map((c) => ({ ...toRow(c), multiple: c.multiple, priorWeekly: c.priorWeekly, tier: "spiking" }));
}
