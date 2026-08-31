/**
 * Pure helpers for the /submit/ page's "suggest a project" form. Framework-
 * and DOM-free (no `window`/`location` access), same convention as
 * compare-url.js/zoom-url.js — usable both from the browser and from
 * `node --test`.
 *
 * There's no write-capable backend on this static site, so a submission
 * can't be filed directly from here — instead the form builds a prefilled
 * GitHub "new issue" URL (using the suggest-a-project.md issue template)
 * and hands off to GitHub for the actual submit. `scripts/process-
 * submission.mjs` picks up the opened issue from there and auto-processes
 * it within minutes — no maintainer step.
 */

/** Matches a bare `owner/repo` id: exactly two non-empty, slash-free segments. */
const OWNER_REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

/**
 * Normalizes user-typed input into a bare `owner/repo` id: trims
 * whitespace, strips trailing slash(es), and strips a
 * `https://github.com/` prefix when present (a pasted repo URL is the
 * likely input here). Mirrors compare-url.js's normalizeProjectId exactly
 * — kept as a separate copy rather than an import so this module has no
 * dependency on the compare feature, but any behavior change should be
 * made in both.
 */
export function normalizeProjectId(input) {
  const trimmed = (input ?? "").trim().replace(/\/+$/, "");
  const githubPrefix = "https://github.com/";
  return trimmed.startsWith(githubPrefix) ? trimmed.slice(githubPrefix.length) : trimmed;
}

/** True when `input` normalizes to a plausible `owner/repo` id. */
export function isValidProjectInput(input) {
  return OWNER_REPO_PATTERN.test(normalizeProjectId(input));
}

/**
 * Builds the issue body in the exact shape suggest-a-project.md's headers
 * expect ("**Project**" / "**Which map should it go in?**" / "**Why it
 * fits**"), so process-submission.mjs's parser can read it back out
 * reliably regardless of whether a human filled the template in by hand
 * or the /submit/ form built it. `why` and `targetMap` fall back to
 * placeholder text rather than an empty field, matching what a human
 * leaving the template's own placeholder comment in place would produce.
 */
export function buildSubmissionIssueBody({ projectId, targetMap, why }) {
  return [
    "**Project**",
    "",
    `https://github.com/${projectId}`,
    "",
    "**Which map should it go in?**",
    "",
    targetMap?.trim() || "Not sure",
    "",
    "**Why it fits**",
    "",
    why?.trim() || "(no reason given)",
  ].join("\n");
}

/**
 * Builds the full "open a prefilled issue" URL for `repoUrl` (this site's
 * own GitHub repo, e.g. "https://github.com/haggaishachar/awesomemap").
 * `projectId` must already be a normalized `owner/repo` id — callers
 * validate via isValidProjectInput first.
 */
export function buildSubmissionIssueUrl({ repoUrl, projectId, targetMap, why }) {
  const params = new URLSearchParams({
    template: "suggest-a-project.md",
    title: `Suggest: ${projectId}`,
    body: buildSubmissionIssueBody({ projectId, targetMap, why }),
  });
  return `${repoUrl}/issues/new?${params.toString()}`;
}
