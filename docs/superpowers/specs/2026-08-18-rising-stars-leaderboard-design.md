# Rising Stars Leaderboard — Design

Status: Approved
Date: 2026-08-18

## Context

The map already has a "Rising" sizing mode (`rising7/30/90`, computed from
`data/history/<slug>.json` snapshots via `scripts/velocity.mjs`) — a project
growing fast gets a bigger treemap tile. Separately,
`scripts/social-digest.mjs` computes a cross-domain "top risers" list of its
own (`computeTopRisers`), used only to update the README and open a weekly
GitHub issue — it never reaches the live site. There is no ranked,
"what's hot right now" list anywhere on awesomemap.dev itself, and no way to
tell whether a project is climbing or falling versus where it ranked
yesterday.

This spec adds an on-site rising-stars leaderboard: a dedicated `/rising/`
page with global and per-domain top-20 lists, plus short teasers on the
landing page and each domain page. It reuses the existing velocity
computation and daily snapshot data; it doesn't change how sizing or
curation work.

## Goals

- **New shared module, `scripts/leaderboard.mjs`**, computing a ranked,
  rank-diffed, deduplicated leaderboard for a scope (global or one domain)
  and window (7/30/90 days). Reused by both `generate.mjs` (site) and
  `social-digest.mjs` (README/issue digest), replacing
  `social-digest.mjs`'s private `computeTopRisers`.
- **Rank-vs-yesterday indicator**, derived at build time from the same
  120-day history already stored — no new persisted state. A project is
  only leaderboard-eligible once it has enough history to compute the
  window's score **both today and yesterday**, so every visible entry
  always has a real prior rank to diff against; there is no "NEW" case to
  special-case in the UI.
- **Dedup in the global list only**: a project curated into more than one
  domain is allowed to appear in every domain's own leaderboard, but the
  global cross-domain list keeps only its single best-scoring listing, so
  one project can't occupy two of the global top-20 slots.
- **New `/rising/` page**: one global leaderboard (top 20) plus one
  leaderboard per domain (top 20), all sharing one 7/30/90-day window
  toggle (default 7d), all windows precomputed at build time and toggled
  client-side (same pattern the map's Popular/Rising toggle already uses —
  no client-side recomputation, no network call on toggle). Each domain's
  section is anchor-linkable (`/rising/#<slug>`).
- **Teasers**: top 5, 7-day window, on the landing page (global) and each
  domain page (that domain's own list), each linking to the full page
  (`/rising/` or `/rising/#<slug>`). Domain-page teasers sit below the
  existing map, which keeps full-width top billing — the map stays the
  page's primary focus; the leaderboard is a secondary, supporting panel.
- **Row appearance**: rank, project icon (reuses the existing `image`
  field), name (linked, existing accent color), domain tag (global list
  only — redundant on a per-domain list), an up/red-down/neutral-dash rank
  arrow with the number of positions moved, and the star delta + percent
  (same numbers `computeVelocity` already produces, same format as the
  detail panel and README digest). Each list header shows "Updated
  {date}" as a freshness signal.
- **Nav entry**: add "Rising" to the site header, next to the brand link,
  so it's a discoverable, first-class destination.
- **`CONTRIBUTING.md`** gets a short addition welcoming smaller/newer
  projects with genuine momentum (not just already-large ones — otherwise
  the leaderboard just re-ranks the same big names already visible in
  Popular mode) and noting the eligibility lag: a newly-added project
  needs `windowDays + 1` days of accumulated daily snapshots (up to 91
  days for the 90-day window) before it can appear on any leaderboard.

## Non-goals

- No per-subdomain/category leaderboards — global + per-domain only. A
  future spec could add category-level lists if the per-domain lists turn
  out too coarse.
- No new persisted "rank history" data file — every rank, including
  "yesterday's," is derived at build time from the existing star-count
  history. Nothing here changes `data/history/<slug>.json`'s shape or the
  daily snapshot job.
- No client-side/live ranking — the leaderboard is precomputed at build
  time and embedded per page, identical in spirit to how Rising-mode tile
  sizes are already embedded.
- No change to `scripts/snapshot-history.mjs`'s per-project GitHub API
  call pattern. As project count grows, batching those calls via GraphQL
  is a real future scale improvement, but it's an existing-script concern
  independent of this feature and out of scope here.
- No curation/schema changes beyond the `CONTRIBUTING.md` wording — this
  spec doesn't add a minimum-stars gate or any other new field to
  `data/<slug>.json`.

## Architecture

### `scripts/leaderboard.mjs` (new, pure — no I/O)

- `computeCandidates(domain, history, windowDays, asOfDate)`: for every
  project in `domain.projects`, filters `history[project.id]` to entries
  with `date <= asOfDate`, calls the existing
  `computeVelocity(filtered, windowDays, { now: asOfDate })`, and keeps
  only `hasEnoughHistory` results. `computeVelocity`'s "current stars"
  already comes from the latest entry in whatever history array it's
  given, so passing a date-filtered array is sufficient to compute a
  historical "as of" score — no change needed to `velocity.mjs` itself.
- `computeLeaderboard(domains, historyBySlug, { scope, windowDays, limit, now })`:
  - `scope` is `"global"` or `{ domainSlug }`.
  - Computes today's candidates and yesterday's candidates (`now` minus
    one day) via `computeCandidates`, per relevant domain(s).
  - For `scope: "global"`, flattens candidates across all domains first,
    then dedups by project `id`, keeping the highest-scoring listing (and
    that listing's domain) for both the today and yesterday passes.
  - Eligibility: a candidate must be present in **both** the today and
    yesterday candidate sets (same identity — `id` for global after
    dedup, `id` within its domain otherwise).
  - Ranks each set by score descending, computes
    `rankDelta = yesterdayRank - todayRank` (positive = moved up), sorts
    the eligible set by today's rank, and slices to `limit`.
  - Returns `[{ rank, id, name, link, image, domain, starDelta, percentDelta, rankDelta }]`.

### `generate.mjs` (changed)

- For each of the 3 windows, computes one global leaderboard (`limit: 20`)
  and one per-domain leaderboard (`limit: 20`) via `computeLeaderboard`,
  and embeds them as JSON for the `/rising/` page.
- The landing-page and domain-page teasers reuse the same 7-day,
  `limit: 20` result, just rendering only its first 5 entries — no
  separate computation.
- A domain with no history file yet (or too new for any window) yields an
  empty eligible set for every window — rendered as the existing
  "not enough history yet" convention, not an error.

### `scripts/render-page.mjs` (changed)

- New `renderRisingPage(domains, leaderboardsByWindow, { ... })`: global
  section followed by one section per domain, each a table of rows per
  the appearance spec above. A window toggle (7/30/90) shows/hides the
  precomputed set for the active window, mirroring the map's existing
  mode-toggle pattern.
- `renderDomainPage` gains a teaser section below the map (top 5, 7-day,
  that domain's leaderboard), linking to `/rising/#<slug>`.
- `renderLandingPage` gains a teaser section between the hero and the
  domain-card grid (top 5, 7-day, global leaderboard), linking to
  `/rising/`.
- `renderSiteHeader` gains a "Rising" link next to the brand.

### `app/shared/treemap.css` (changed)

- New row styles for leaderboard entries, and two new semantic color
  tokens (light/dark pairs) for the up/down rank arrow, alongside the
  existing `--color-accent`/`--color-text-muted`/`--color-border` tokens
  already used for the rest of the row (icon, name, domain tag, delta
  text).

### `scripts/social-digest.mjs` (changed)

- Drops its private `computeTopRisers` in favor of
  `computeLeaderboard(domains, historyBySlug, { scope: "global", windowDays: 7, limit: 5 })`
  from the new shared module. `formatDigest`/`renderReadmeRisers` keep
  their current output shape — `rankDelta` isn't used in the Markdown
  digest, it's simply an unused field on the returned candidates there.

### File layout changes

```
/scripts/
  leaderboard.mjs               # NEW — shared ranked/deduped/diffed leaderboard
  generate.mjs                  # CHANGED — computes + embeds leaderboards
  render-page.mjs               # CHANGED — /rising/ page, teasers, nav link
  social-digest.mjs             # CHANGED — uses leaderboard.mjs, drops computeTopRisers
/app/shared/
  treemap.css                   # CHANGED — leaderboard row styles + arrow color tokens
/CONTRIBUTING.md                # CHANGED — welcomes smaller projects, notes eligibility lag
/test/
  leaderboard.test.js            # NEW
```

## Error handling

- **No history for a domain/project**: treated as "not enough history
  yet," not an error — same convention the existing Rising mode already
  uses for tiles.
- **Fewer than `limit` eligible projects**: the list simply shows what's
  eligible; no padding or placeholder rows.
- **Build-time validation**: leaderboard entries are built from the same
  `computeVelocity` output already validated for treemap sizing, so no
  separate NaN/invalid-value check is needed — a broken velocity result
  would already fail the existing `findInvalidSizes` check in
  `generate.mjs` before the leaderboard step runs.

## Testing

- `leaderboard.test.js`: rank-diff correctness (climbed/fell/unchanged),
  eligibility requiring history as-of both today and yesterday, dedup
  keeping the best-scoring listing when a project appears in multiple
  domains, an empty-history domain producing an empty list, and `limit`
  slicing.
- `render-page.test.js` extended: `/rising/` page renders all domain
  sections plus the global section, domain/landing pages render their
  teaser sections and link correctly.
- `social-digest.test.js` extended to confirm digest output is unchanged
  after switching to the shared `computeLeaderboard`.
- Manual verification: `npm run dev`, confirm `/rising/` renders with the
  window toggle switching all sections together, a domain page's teaser
  links to the right anchor, and the landing page teaser links to
  `/rising/`.

## Deployment

- No new workflow — this only changes what `generate.mjs` computes and
  renders from data the existing daily `snapshot-history.yml` job already
  produces. Ships via the existing `deploy.yml` on push to `master`.
