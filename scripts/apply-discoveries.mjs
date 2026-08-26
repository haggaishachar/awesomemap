const DEFAULT_MIN_CONFIDENCE = 0.8;
const DEFAULT_DAILY_CAP = 3;

/**
 * Pure routing decision for one classified candidate (see
 * classifyCandidates's output shape in classify-candidates.mjs): "drop"
 * for a confirmed non-fit (`fits === false`), "needsReview" for anything
 * uncertain, requiring a new category, or unparseable (`fits === null`),
 * "qualifies" for a confident fit into an existing category.
 */
export function routeCandidate(classified, { minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  if (classified.fits === false) return "drop";
  if (classified.fits === true && !classified.suggestedNewCategory && classified.confidence >= minConfidence) {
    return "qualifies";
  }
  return "needsReview";
}

/**
 * Splits one domain's classified candidates into `autoCommit` (up to
 * `dailyCap`, highest confidence first) and `pending` (every
 * "needsReview" candidate, plus any "qualifies" candidate that didn't
 * make the cap). "drop" candidates appear in neither list — the caller
 * (discover-projects.mjs) still records them in data/discovery/seen.json
 * via `updateSeenIds` so they aren't re-evaluated tomorrow.
 */
export function selectAutoCommit(classified, { minConfidence = DEFAULT_MIN_CONFIDENCE, dailyCap = DEFAULT_DAILY_CAP } = {}) {
  const qualifies = [];
  const pending = [];

  for (const candidate of classified) {
    const route = routeCandidate(candidate, { minConfidence });
    if (route === "qualifies") qualifies.push(candidate);
    else if (route === "needsReview") pending.push(candidate);
  }

  qualifies.sort((a, b) => b.confidence - a.confidence);
  const autoCommit = qualifies.slice(0, dailyCap);
  const overflow = qualifies.slice(dailyCap);

  return { autoCommit, pending: [...pending, ...overflow] };
}

/**
 * Formats the day's review queue as GitHub-flavored Markdown: one
 * "### <domain>" section per domain with at least one pending candidate,
 * each listed with its GitHub link, star count, suggested placement
 * (existing path or a suggested new category), confidence, and the
 * classifier's stated reason. `pendingByDomain` values must carry `stars`
 * (merged in by the caller from repo metadata — classifyCandidates's
 * output alone doesn't include it). Mirrors formatDigest/
 * renderReadmeRisers in social-digest.mjs, including its "nothing to
 * report" placeholder convention for an empty queue.
 */
export function formatReviewIssueBody(pendingByDomain, date) {
  const domainSlugs = Object.keys(pendingByDomain).filter((slug) => pendingByDomain[slug].length > 0);
  if (domainSlugs.length === 0) {
    return `No discovery candidates need review for ${date}.`;
  }

  const sections = domainSlugs.map((slug) => {
    const lines = pendingByDomain[slug].map((c) => {
      const placement = c.suggestedNewCategory ? `suggests new category: "${c.suggestedNewCategory}"` : c.path ? c.path.join(" / ") : "no placement suggested";
      const confidencePct = Math.round(c.confidence * 100);
      return `- [**${c.id}**](https://github.com/${c.id}) — ${c.stars} stars, ${placement}, confidence ${confidencePct}% — ${c.reason}`;
    });
    return [`### ${slug}`, "", ...lines].join("\n");
  });

  return [`Discovery candidates awaiting review for ${date}:`, "", ...sections].join("\n\n");
}

/**
 * Returns the deduped union of ids the job has ever evaluated (whether
 * auto-committed, sent to review, or rejected outright), so none of them
 * are re-fetched or re-classified on a future run.
 */
export function updateSeenIds(existingSeenIds, todaysEvaluatedIds) {
  return [...new Set([...existingSeenIds, ...todaysEvaluatedIds])];
}
