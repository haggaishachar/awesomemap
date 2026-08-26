# Daily Project Discovery — Design

Status: Approved
Date: 2026-08-25

## Context

Today, every project addition to a domain map (`data/<slug>.json`) is
manual: someone finds a project, writes its entry (`id`, `path`, etc.),
`enrich-domain.mjs` fills in `weight`/`image` from GitHub, and it goes
through a normal PR reviewed by a maintainer (per `CONTRIBUTING.md`).
There is no mechanism that goes looking for new projects on its own.

This spec adds a daily scheduled job that discovers candidate open-source
projects, works out which existing domain and category/subcategory they
belong in, and — for the ones it's confident about — adds them directly;
everything else lands in a daily review issue for a human decision. It
follows the same shape as the existing daily/weekly automation
(`snapshot-history.yml`, `social-digest.yml`): a scheduled GitHub Actions
workflow running a `scripts/*.mjs` entry point, committing straight back
to `master`.

This intentionally punches a hole in `CONTRIBUTING.md`'s "every addition
gets a human-reviewed PR" rule for the subset of candidates this job is
confident about — that trade-off (speed vs. always-reviewed) was a
deliberate choice, guarded by the quality bar, confidence threshold, and
daily cap below, not an oversight.

## Goals

- **`data/discovery/sources.json`** (new, hand-maintained): per existing
  domain slug, a list of GitHub topics to search and a list of
  "awesome-`X`" repos to diff against. This is what determines *which
  domain* a candidate is even considered for — the LLM classification
  step validates and places it within that domain, it doesn't pick a
  domain from an open-ended set. Seeded once per domain, tuned
  occasionally; not touched by the job itself.
- **`scripts/discover-candidates.mjs`** (new): gathers raw candidate repo
  ids per domain from GitHub Search (by topic) and awesome-list README
  parsing, excludes anything already listed in any domain or already
  surfaced by a previous run, fetches GitHub repo metadata for the rest,
  and filters to those passing a hard quality bar (stars, activity, not a
  fork/archived, has a license) — cheaply ruling out non-candidates
  *before* any LLM call is spent on them.
- **`scripts/classify-candidates.mjs`** (new): one LLM call per domain
  per day, given that domain's existing category tree and its
  quality-passing candidates, returns per candidate whether it genuinely
  fits the domain, which category/subcategory path, a confidence score,
  and (if no existing category is a good fit) a suggested new category
  name.
- **`scripts/apply-discoveries.mjs`** (new): routes each classified
  candidate to either auto-commit (fits an existing category, confidence
  above threshold, domain hasn't hit its daily cap) or the review queue
  (everything else that still passed the quality bar: low confidence,
  suggests a new category, capped-out overflow, or a classification the
  job couldn't parse) — never silently drops anything that cleared the
  quality bar, and never auto-creates a new category.
- **`scripts/discover-projects.mjs`** (new): thin CLI orchestrator tying
  the above together, run daily by a new workflow; supports `--dry-run`
  for local testing without writing/committing/opening anything.
- **New workflow, `.github/workflows/discovery.yml`**: daily cron (after
  the existing 6am snapshot job), auto-commits qualifying additions
  (enriched via the existing `enrichProject` from `enrich-domain.mjs`,
  reused rather than duplicated) to `data/<slug>.json`, and opens one
  GitHub issue for the day's review queue, if non-empty.
- **`CONTRIBUTING.md`** gets a short new section documenting the job:
  what it does, the quality bar/cap/confidence numbers, and that
  flagged candidates land in a daily "Discovery review" issue rather
  than being silently discarded or silently added.

## Non-goals

- **No open-ended domain discovery.** The job never proposes an entirely
  new domain (e.g. "Game Development") — that stays the manual
  `new-domain-proposal.md` issue flow. `discovery/sources.json` only ever
  maps *existing* domains to search inputs.
- **No auto-created categories/subcategories.** A candidate that needs a
  new category always goes to the review issue, never auto-committed
  under a category that doesn't exist yet in `data/<slug>.json`.
- **No persistent "seen" nagging avoidance beyond a flat id list.** Once
  a candidate has been evaluated (auto-committed, put in a review issue,
  or rejected by the quality bar or `fits: false`), its id is recorded in
  `data/discovery/seen.json` and never re-surfaced by the job again. If a
  review-issue candidate is ignored, it will not reappear tomorrow — the
  issue itself is the durable record; a maintainer can always add it
  later through the normal manual PR flow regardless of `seen`. No
  "snooze" or "re-surface after N days" mechanism in v1.
- **No new runtime dependency.** LLM and GitHub calls are raw `fetch`,
  matching every existing script in `scripts/` (only `d3-hierarchy`, used
  by the site itself, is an actual dependency).
- **No change to `snapshot-history.yml` or `social-digest.yml`** — this
  is a fully independent workflow and script family.
- **No analytics/dashboard on job performance** (accept/reject rates
  over time). Could be mined from commit/issue history later if wanted.

## Architecture

### `data/discovery/sources.json` (new, hand-maintained)

Lives in a `data/discovery/` subdirectory, not directly in `data/` —
`generate.mjs`, `snapshot-history.mjs`, and `social-digest.mjs` all do
`readdirSync(DATA_DIR).filter(name => name.endsWith(".json"))` and treat
every match as a domain map (`{ slug, projects, ... }`); a config file
sitting directly in `data/` would be parsed as one and break all three.
Same reasoning `data/history/` already follows for per-project star
snapshots — non-domain data goes in its own subdirectory.

```json
{
  "artificial-intelligence": {
    "searchTopics": ["llm", "rag", "vector-database", "ai-agents"],
    "awesomeLists": ["steven2358/awesome-generative-ai"]
  }
}
```

A domain slug with no entry (or an empty one) is simply skipped by the
job — this file, not `data/*.json`'s existence, is what turns discovery
on for a domain.

### `scripts/discover-candidates.mjs` (new)

- `buildSearchQuery(topic, { minStars })` — pure. Builds a GitHub code
  search query string (`topic:<topic> stars:>${minStars} archived:false
  fork:false`).
- `searchGithubByTopic(topic, { getJson, minStars })` — calls the GitHub
  Search Repositories API, returns raw result items.
- `parseAwesomeListLinks(readmeMarkdown)` — pure, regex-extracts
  `github.com/<owner>/<repo>` links from Markdown, returns deduped
  `owner/repo` ids.
- `fetchAwesomeListCandidates(repoId, { getJson })` — fetches that repo's
  README via the GitHub contents API, base64-decodes it, and calls
  `parseAwesomeListLinks`.
- `collectCandidateIds(domainSlug, sourcesConfig, { getJson })` — merges
  and dedups ids from both sources for one domain.
- `excludeKnownIds(candidateIds, knownIds)` — pure. `knownIds` is the
  union of every `id` across all `data/<slug>.json` files plus everything
  in `data/discovery/seen.json`, computed once by the caller.
- `fetchRepoMetadata(id, { getJson })` — reuses `parseGhRepo` from
  `enrich-domain.mjs` to split `id`, fetches the repo, returns
  `{ id, stars, isFork, isArchived, pushedAt, hasLicense, description,
  topics }`.
- `passesQualityBar(meta, { minStars = 500, maxInactiveMonths = 12, now })`
  — pure. Requires `stars >= minStars`, `!isFork`, `!isArchived`,
  `hasLicense`, and `pushedAt` within `maxInactiveMonths` of `now`.

### `scripts/classify-candidates.mjs` (new)

- `buildCategoryTree(domain)` — pure. Dedups every `path` array already
  present in `domain.projects` into a flat list of category/subcategory
  breadcrumbs, for the prompt.
- `buildClassificationPrompt(domain, categoryTree, candidates)` — pure.
  Produces the system + user message content: domain name/description,
  the category tree, and each candidate's id/description/topics/README
  excerpt. Requests a forced-JSON tool-use response (not free-text) so
  parsing is never regex-against-prose.
- `callOpenRouterApi(prompt, { apiKey, model, fetchImpl })` — the real,
  injectable implementation (same `getJson`-injection pattern as
  `createGetJson` in `enrich-domain.mjs`), `POST
  https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible
  chat-completions shape) with `tool_choice` forcing a
  `classify_candidates` tool call. `model` defaults to the
  `OPENROUTER_MODEL` env var, falling back to `google/gemini-3.7-flash`
  — a current, cheap ($0.375/M input, $1.875/M output) OpenRouter model,
  chosen since this call is small/structured (a category tree + a
  handful of candidate descriptions in, a short JSON classification
  out) and doesn't need a frontier model.
- `classifyCandidates(domain, candidates, { callLlm })` — calls
  `callLlm`, validates the response: each returned id must match a
  submitted candidate, `confidence` must be a number in `[0, 1]`, and any
  `path` must be a prefix-complete path (each returned path either
  exactly matches or extends an existing `categoryTree` entry, or is
  paired with `suggestedNewCategory`). A candidate whose entry is
  missing, malformed, or fails validation gets
  `{ fits: null, reason: "unparseable classification" }` — routed to
  review, never silently dropped (the quality-bar work already spent on
  it isn't wasted) and never auto-committed.

### `scripts/apply-discoveries.mjs` (new)

- `routeCandidate(classified)` — pure, maps one classified candidate
  to `"drop"` (`fits === false`), `"needsReview"` (`fits === null`,
  `suggestedNewCategory` present, or `confidence < minConfidence`), or
  `"qualifies"` (`fits === true`, no `suggestedNewCategory`,
  `confidence >= minConfidence`).
- `selectAutoCommit(classified, { minConfidence = 0.8, dailyCap = 3 })`
  — pure. Routes every candidate via `routeCandidate`; among
  `"qualifies"` candidates, sorts by `confidence` descending and takes
  the top `dailyCap` as `autoCommit`, pushing any overflow into
  `pending` alongside the `"needsReview"` set. Returns
  `{ autoCommit: [...], pending: [...] }` (`"drop"` candidates appear in
  neither — see Non-goals on why they're still recorded as `seen`).
- `formatReviewIssueBody(pendingByDomain, date)` — pure Markdown
  formatter (mirrors `formatDigest`/`renderReadmeRisers` in
  `social-digest.mjs`): one section per domain, each candidate listed
  with its id/link, stars, suggested path or `suggestedNewCategory`,
  confidence, and `reason`.
- `updateSeenIds(existingSeenIds, todaysEvaluatedIds)` — pure, returns
  the deduped union (every candidate touched today — dropped,
  auto-committed, or sent to review — so none of them are re-fetched or
  re-classified tomorrow).

### `scripts/discover-projects.mjs` (new, CLI orchestrator)

Mirrors `enrich-domain.mjs`'s `main()` shape:

1. Read `data/discovery/sources.json`, every `data/<slug>.json`, and
   `data/discovery/seen.json` (empty array if absent).
2. Per domain with a sources entry: `collectCandidateIds` →
   `excludeKnownIds` → `fetchRepoMetadata` for the rest. Ids whose
   metadata fetch *succeeds* are "evaluated" from here on, regardless of
   what happens next — collected into that domain's `evaluatedIds`
   (this is what feeds `seen` in step 5; a metadata-fetch failure is the
   only case that leaves an id out of `evaluatedIds`, so it's retried
   tomorrow). Filter by `passesQualityBar` — rejects stop here (already
   in `evaluatedIds`, never classified) — then `classifyCandidates` on
   survivors, then `selectAutoCommit`.
3. For every domain's `autoCommit` list: run each through the existing
   `enrichProject`/`getJson` (imported from `enrich-domain.mjs`) to get
   real `weight`/`image`, append to that domain's `projects`, write the
   file.
4. Collect every domain's `pending` list; if non-empty, build the issue
   body via `formatReviewIssueBody` and open it with `gh issue create`.
5. Write the updated `data/discovery/seen.json` (`updateSeenIds` over
   every domain's `evaluatedIds` from step 2 — covers auto-committed,
   pending, quality-bar-rejected, and `fits: false` ids alike, so none
   of them are re-fetched or re-classified on tomorrow's run).
6. `--dry-run`: performs steps 1–4's computation and prints a summary
   (domain → counts of auto-commit/pending/dropped) but skips every
   write, commit, and `gh issue create` call — for local testing with
   just `gh auth token` + `OPENROUTER_API_KEY` set, no side effects.

### File layout

```
/data/
  discovery/
    sources.json                 # NEW — hand-maintained, per-domain search config
    seen.json                    # NEW — flat array of ids the job has ever evaluated
/scripts/
  discover-candidates.mjs       # NEW
  classify-candidates.mjs       # NEW
  apply-discoveries.mjs         # NEW
  discover-projects.mjs         # NEW — CLI orchestrator
/.github/workflows/
  discovery.yml                 # NEW
/test/
  discover-candidates.test.js   # NEW
  classify-candidates.test.js   # NEW
  apply-discoveries.test.js     # NEW
/CONTRIBUTING.md                # CHANGED — documents the job
```

## Error handling

- **A single GitHub Search query or awesome-list README fetch fails**:
  logged as a warning, that source is skipped, discovery continues with
  whatever other sources succeeded — same per-item try/catch pattern
  `enrich-domain.mjs` already uses.
- **Repo metadata fetch fails for one candidate**: that candidate is
  dropped from consideration for the day (logged), not retried
  mid-run; it isn't added to `seen`, so it's naturally retried on the
  next daily run.
- **LLM call fails (network/5xx) for a domain**: retried via the
  existing `withRetry` (imported from `enrich-domain.mjs`); if still
  failing after retries, that domain's classification is skipped for the
  day (logged loudly), not the whole job — other domains still run, and
  nothing for the failed domain is marked `seen`, so it's retried
  tomorrow.
- **Malformed/partial LLM JSON for specific candidates**: handled by
  `classifyCandidates`'s per-candidate validation (see above) — routed
  to review, not dropped, not auto-committed.
- **`gh issue create` fails**: the workflow step fails loudly (visible in
  Actions). This runs *after* the data-file commit step, so a review-issue
  failure never blocks or rolls back auto-committed additions that day —
  worst case, that day's `pending` set is only visible in job logs until
  a manual re-run or next day's issue.
- **No candidates survive discovery/quality-bar for a domain**: logged as
  a `0` count, not an error.

## Testing

- `discover-candidates.test.js`: search query construction, awesome-list
  link parsing (including edge cases: relative links, non-GitHub links,
  duplicate links), `excludeKnownIds` set logic, `passesQualityBar` for
  each threshold independently (stars, fork, archived, license,
  inactivity) with injected `now`.
- `classify-candidates.test.js`: prompt construction includes the right
  category tree and candidates; response validation accepts a
  well-formed response and routes each malformed shape (unknown id,
  out-of-range confidence, invalid path, missing entry) to the
  `fits: null` fallback; injected `callLlm` so no real network/API call.
- `apply-discoveries.test.js`: `routeCandidate` for all three outcomes;
  `selectAutoCommit`'s cap enforcement (confidence-sorted, overflow to
  pending) and confidence-threshold routing; `formatReviewIssueBody`
  output shape; `updateSeenIds` dedup.
- Manual verification: `OPENROUTER_API_KEY=... node
  scripts/discover-projects.mjs --dry-run` (requires `gh auth token`,
  same as `enrich-domain.mjs`) against the live repo data, confirming
  the printed summary's counts look sane for at least one domain before
  the workflow is enabled.

## Deployment

- New `.github/workflows/discovery.yml`: `cron: "0 7 * * *"` (an hour
  after `snapshot-history.yml`'s `0 6 * * *`, so it discovers against
  that day's fresh history if it ever needs it), plus
  `workflow_dispatch`. `permissions: contents: write, issues: write`.
  `concurrency: { group: discovery, cancel-in-progress: false }`, same
  as `snapshot-history.yml`. Steps: checkout, setup-node, `npm ci`,
  `node scripts/discover-projects.mjs`, then commit
  `data/<slug>.json` + `data/discovery/seen.json` if changed (same
  git-config-and-conditional-commit pattern as the other two workflows).
- **New repository secret required**: `OPENROUTER_API_KEY` (already set
  on `haggaishachar/awesomemap` via `gh secret set` as part of writing
  this spec). Same category of manual prerequisite as the Pages source
  setting `CONTRIBUTING.md` already calls out for `deploy.yml` — not
  something the workflow file itself configures, just consumed by it
  (`${{ secrets.OPENROUTER_API_KEY }}` in the `discovery` job's `env`).
