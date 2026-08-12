# Star History Backfill — Design

Status: Approved
Date: 2026-08-12

## Context

The [Rising Projects View](2026-08-08-rising-projects-view-design.md) feature (shipped 2026-08-08) sizes tiles by
star-growth velocity over 7/30/90-day windows, computed from
`data/history/<slug>.json` snapshots. That spec deliberately scoped out a
backfill as a non-goal — history was meant to accumulate going forward from
the daily `snapshot-history.mjs` cron. In practice, every history file still
contains exactly one date (2026-08-08), so `hasEnoughHistory` is `false` for
all 241 tools and Rising mode has nothing to show. This spec reverses that
non-goal: GitHub's stargazers API exposes per-star `starred_at` timestamps,
which is enough to reconstruct daily counts for the trailing window in a
single one-time backfill instead of waiting ~90 days for organic data.

## Goals

- Reconstruct ~120 days of daily `{date, stars}` history for every tool
  across all 5 domains from the GitHub stargazers API, in one manual,
  resumable run.
- Merge the reconstructed history into `data/history/<slug>.json` using the
  exact same idempotent append/prune logic the daily snapshot job already
  uses, so the two data sources are indistinguishable to `velocity.mjs`.
- Make the run safe to interrupt and resume without redoing completed
  tools or losing already-spent API requests.
- Handle GitHub's rate limit gracefully (sleep-and-continue) rather than
  failing, since some repos require far more requests than a "typical"
  tool.

## Non-goals

- Not part of the daily cron — this is a one-time script run manually, once,
  after which its checkpoint file is discarded. The daily
  `snapshot-history.mjs` job is unchanged and keeps extending history
  forward from here.
- No attempt to correct for unstars (see Known limitation below) — this is
  an inherent limitation of the public GitHub API, shared by every
  star-history tool, not something this backfill can solve.
- No change to `velocity.mjs`, `generate.mjs`, or any client-side rendering
  — this spec only populates data that the already-shipped Rising feature
  reads.

## Architecture

### Backfill script

**`scripts/backfill-history.mjs`** (new): CLI entry point,
`node scripts/backfill-history.mjs`, invoked manually (mirrors
`snapshot-history.mjs`'s convention of iterating every `data/*.json`
domain automatically in one run, rather than `enrich-domain.mjs`'s
per-domain-argument convention — chosen because resumability makes a
single long-running, interruptible pass simpler than tracking which
domains are done by hand).

For every tool in every domain whose `id` parses as an `owner/repo`
shorthand (via the existing `parseGhRepo`):

1. **Checkpoint check**: skip the tool if its id is already present in
   `data/history/.backfill-checkpoint.json`'s `completedToolIds`.
2. **Current count**: `GET /repos/{owner}/{repo}` for `stargazers_count`
   (same call shape as `enrich-domain.mjs`/`snapshot-history.mjs`).
3. **Walk stargazers backward**: `GET /repos/{owner}/{repo}/stargazers`
   with `Accept: application/vnd.github.star+json` and `per_page=100`,
   starting at `page = ceil(stargazers_count / 100)` and decrementing.
   Stop when the oldest `starred_at` on a fetched page is older than the
   120-day cutoff, or page 1 is reached. No cap on pages walked — some
   repos (e.g. fast-growing AI projects) will take far more than the
   "typical" 10-30 requests; rate-limit handling (below) makes this safe
   rather than needing an artificial cap.
4. **Reconstruct daily history**: pure function
   `reconstructDailyHistory(starEvents, currentStars, { now, retentionDays })`
   returns one `{date, stars}` entry per calendar day from
   `max(cutoffDate, earliestEventDate)` to today:
   `stars_at_end_of_day(d) = currentStars - count(events with starred_at > endOfDay(d))`.
   This is exact for any `d` at or after the cutoff, because the walk
   collects every star event from the cutoff to now — nothing after `d` is
   missing from that set.
5. **Merge**: fold each reconstructed entry through the existing
   `appendSnapshotEntry` (imported from `snapshot-history.mjs`, not
   duplicated) into that tool's existing history, then `pruneOldEntries`
   at 120 days — identical semantics to what the daily job would have
   produced had it been running all along.
6. **Flush**: write the domain's `data/history/<slug>.json` and append the
   tool's id to the checkpoint file **immediately after each tool**, not
   batched at the end of the domain. Unlike the daily snapshot job (one
   cheap request per tool), a single backfilled tool can cost hundreds of
   requests, so losing that work to a later crash is expensive enough to
   avoid.

A tool that fails after retries (see below) is logged and left out of the
checkpoint, so the next run retries it; its existing history (if any) is
left untouched.

### Rate limit handling

`createGetJson` (from `enrich-domain.mjs`) already retries network errors
and 5xx via `withRetry`, but does not treat rate-limit responses specially.
`backfill-history.mjs` wraps its own `getJson` around the same
`fetchImpl`/`withRetry` machinery, adding:

- After every response, read `X-RateLimit-Remaining` /
  `X-RateLimit-Reset`. When remaining drops below a small buffer (e.g. 50),
  sleep until the reset time (plus a small margin) before issuing the next
  request.
- A 403 response with `X-RateLimit-Remaining: 0` is treated as
  retryable: sleep until reset, then retry the same request, instead of
  counting against the tool's normal failure path.

Combined with resumability, a run that spans multiple rate-limit windows
(plausible with no per-tool cap) simply pauses and continues — including
across a manual interrupt and restart.

### Checkpoint file

`data/history/.backfill-checkpoint.json`, git-ignored: `{ "completedToolIds": [...] }`.
A tool is marked complete once its walk-back terminates (cutoff reached or
page 1 reached) and its history has been written — not inferred from the
history file's oldest date, since a repo younger than 120 days would
otherwise look permanently incomplete. This file is scaffolding for the
one-time run; delete it once the backfill has finished across all domains.

### Known limitation

The stargazers endpoint lists *current* stargazers with their `starred_at`
timestamp — it does not include users who starred and later unstarred
within the window. Reconstructed counts can therefore slightly undercount
at points in the past relative to what a live daily snapshot would have
shown at the time. This is an inherent limitation of the public GitHub API
(shared by every third-party star-history tool) and is not correctable;
the error is small in practice since unstar churn is a small fraction of
total stars.

## File layout changes

```
/scripts/
  backfill-history.mjs         # NEW — one-time resumable backfill CLI
/test/
  backfill-history.test.js     # NEW
/.gitignore                    # CHANGED — data/history/.backfill-checkpoint.json
```

## Error handling

- **Per-tool API failure** (after `withRetry`'s attempts exhausted): logged
  and skipped, existing history untouched, tool not marked complete in the
  checkpoint — retried on the next run.
- **Rate limit hit**: not a failure — sleep until reset and continue (see
  above), whether encountered as a low `X-RateLimit-Remaining` or a 403.
- **Tool already complete**: skipped silently (expected steady state on a
  resumed run), counted in a "skipped" summary line per domain.

## Testing

- `reconstructDailyHistory`: exact reconstruction against a known
  `currentStars` and synthetic event list; a repo younger than the cutoff
  (page 1 reached before 120 days); zero recent star events (flat count);
  boundary date exactly at the cutoff.
- Checkpoint logic: marking a tool complete, skipping already-complete
  tools on a subsequent call, an interrupted-then-resumed run only
  processes remaining tools.
- Manual verification: run against one real domain end-to-end, confirm
  `data/history/<slug>.json` ends up with ~120 days of entries per tool and
  that `computeVelocity`/Rising mode report `hasEnoughHistory: true` for
  the 30d and 90d windows afterward.

## Deployment

- One-time manual run: `node scripts/backfill-history.mjs`, using
  `gh auth token` the same way `enrich-domain.mjs`/`snapshot-history.mjs`
  do. Not added to any GitHub Actions workflow.
- Resulting `data/history/*.json` changes are committed normally (by hand,
  or reusing the commit pattern from `snapshot-history.yml` if run in CI
  ad hoc) — this spec doesn't change how history files are deployed, only
  how they're populated for the first time.
