/**
 * Pure routing decision for one classified candidate (see
 * classifyCandidates's output shape in classify-candidates.mjs): "drop"
 * for a confirmed non-fit (`fits === false`) or an unparseable/failed
 * classification (`fits === null` — an LLM or parsing failure, not a
 * content judgment, so there's nothing here to commit), "qualifies" for
 * anything the classifier affirmed genuinely fits this domain
 * (`fits === true`).
 *
 * There is deliberately no confidence threshold and no daily cap here
 * anymore: every candidate that clears the hard, objective quality bar
 * (discover-candidates.mjs's passesQualityBar — real, maintained, popular
 * enough, actively pushed) and gets a `fits: true` content judgment from
 * the classifier is meant to land in the data without waiting on a human
 * — see CONTRIBUTING.md's "Automated project discovery" section. A
 * `suggestedNewCategory` no longer routes to review either; selectAutoCommit
 * (below) resolves it straight into the new category's path.
 */
export function routeCandidate(classified) {
  return classified.fits === true ? "qualifies" : "drop";
}

/**
 * Filters `classified` down to the candidates to auto-commit, each with
 * its final `path` resolved: an existing category's `path` when the
 * classifier matched one, otherwise a brand-new one-element path built
 * from `suggestedNewCategory` (isValidClassification in
 * classify-candidates.mjs already guarantees `fits: true` always carries
 * one or the other). Sorted by confidence descending, purely so a
 * maintainer skimming the commit log or Action output sees the strongest
 * matches first — it's no longer a cap boundary.
 */
export function selectAutoCommit(classified) {
  return classified
    .filter((c) => routeCandidate(c) === "qualifies")
    .map((c) => ({ ...c, path: c.path ?? [c.suggestedNewCategory] }))
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Returns the deduped union of ids the job has ever evaluated (whether
 * auto-committed, auto-rejected, or left out to retry — see
 * discover-projects.mjs for which of those actually get recorded), so
 * none of them are re-fetched or re-classified on a future run.
 */
export function updateSeenIds(existingSeenIds, todaysEvaluatedIds) {
  return [...new Set([...existingSeenIds, ...todaysEvaluatedIds])];
}
