# Rising Projects View — Design

Status: Approved
Date: 2026-08-08

## Context

Every domain map (`data/<slug>.json`) sizes each tool's treemap tile by
`weight`, a single live snapshot of its GitHub star count, refreshed
manually via `scripts/enrich-domain.mjs`. This means the map always shows
the same handful of long-established, high-star projects as the biggest
boxes — it has no way to surface a project that's growing fast but hasn't
accumulated a large absolute star count yet. There is currently no
historical data anywhere in the repo: `weight` is overwritten in place each
time enrichment runs, so there's nothing to compute growth from.

This spec adds a second sizing mode, "Rising," alongside the existing
"Popular" mode (unchanged `weight`-based sizing), driven by star-growth
velocity over a selectable time window. Curation stays entirely manual, as
today — this spec only changes how already-curated tools are sized and
ranked, not which tools appear in a domain's map.

## Goals

- Capture daily star-count history per tool, going forward, via a new
  scheduled job — no external history backfill.
- Compute a blended growth-velocity score per tool for three windows (7,
  30, 90 days): `score = starDelta / sqrt(max(currentStars, 1))`, floored
  at a small positive epsilon so a shrinking project still renders (never
  zero/negative — `d3.treemap()` requires positive weights) but shrinks
  toward negligible.
- Precompute every mode/window's size at build time and embed the results
  in the generated page, so switching modes in the browser is instant and
  requires no network call or client-side scoring logic.
- Add a Popular/Rising toggle plus a 7d/30d/90d window selector to both the
  full map pages and the chrome-free `/embed/<slug>` pages.
- Flag any tool that doesn't yet have enough history for the selected
  window (e.g. a tool added yesterday, viewed at the 90-day window) with a
  minimal-size, visually distinct tile rather than silently falling back to
  a different metric.
- Show the growth stat behind a tile's size (e.g. "+340 stars (18%) in 30
  days") in the detail panel when Rising mode is active.

## Non-goals

- No discovery of un-curated trending repos — curation stays manual, as
  decided for this project. A future spec could add that as a separate
  subsystem.
- No history backfill from external sources (e.g. star-history.com,
  GH Archive/BigQuery) — history starts accumulating from this feature's
  ship date; a 90-day window simply won't be meaningful until ~90 days of
  snapshots exist.
- No change to the curated-content schema (`data/<slug>.json`'s `tools`
  array) or to inclusion/filtering logic — `weight` keeps meaning "current
  star count" and keeps driving Popular mode exactly as today.
- No windows beyond 7/30/90 days in this spec (e.g. 365-day) — the 120-day
  retention window is sized for what's in scope now; a longer window would
  need a retention change first.

## Architecture

### History snapshots

New file per domain, `data/history/<slug>.json`, keyed by tool `id`:

```json
{
  "scikit-learn/scikit-learn": [
    { "date": "2026-08-08", "stars": 66930 },
    { "date": "2026-08-07", "stars": 66910 }
  ]
}
```

- **`scripts/snapshot-history.mjs`** (new): for every tool in every
  `data/<slug>.json`, fetches current star count via the same GitHub API
  call `enrich-domain.mjs` already makes, appends today's `{date, stars}`
  to that tool's array in `data/history/<slug>.json`, and prunes entries
  older than 120 days (comfortably past the longest supported window, with
  headroom). Writing is idempotent — running it twice in one day updates
  today's entry in place rather than appending a duplicate.
- **`.github/workflows/snapshot-history.yml`** (new): scheduled daily cron
  (`workflow_dispatch` also enabled for manual runs), runs
  `snapshot-history.mjs`, commits `data/history/*.json` directly if
  anything changed, no-ops otherwise (mirrors `deploy.yml`'s auth pattern
  for calling the GitHub API from Actions).

### Velocity scoring

- **`scripts/velocity.mjs`** (new, pure — no I/O): exports
  `computeVelocity(history, windowDays)` returning
  `{ score, hasEnoughHistory, starDelta, percentDelta }`. Looks up the
  snapshot closest to (but not after) `windowDays` ago; `hasEnoughHistory`
  is `false` if the oldest available snapshot is younger than that
  (there's no data point far back enough to measure the full window).
  `score` is floored at a small epsilon (e.g. `0.01`) so it's always a
  valid positive treemap weight.

### Build-time embedding

- `scripts/generate.mjs` reads `data/history/<slug>.json` alongside each
  domain's tool list (missing history file ⇒ every tool in that domain is
  `hasEnoughHistory: false` for every window). For each tool it computes
  `sizes: { popular, rising7, rising30, rising90 }` and
  `hasEnoughHistory: { rising7, rising30, rising90 }`, replacing the single
  `weight` the generated tree currently carries. `popular` is just the
  existing `weight` (or its `1` fallback) — unchanged behavior.
- `scripts/build-tree.mjs` carries `sizes`/`hasEnoughHistory` through onto
  each leaf node unchanged, the same way it already carries `name`/`desc`/
  `link`/`image`.

### Client-side rendering

- `app/shared/layout.js`'s `weightOf()` takes the active mode+window as a
  parameter and reads `node.sizes.popular` or
  `node.sizes.rising{7,30,90}` instead of a hardcoded `weight` field.
  Switching modes re-runs the existing `d3.treemap()` layout client-side —
  no new network call, since everything needed is already inlined in the
  page.
- `app/shared/treemap.js` gains a small mode-toggle control (Popular /
  Rising) near the existing breadcrumb chrome, and — visible only when
  Rising is active — a 7d/30d/90d segmented control, defaulting to 30d.
  Both controls are added to the full page template and the embed
  template, so embeds get feature parity with full pages.
- A tile whose tool has `hasEnoughHistory[window] === false` renders with a
  distinct visual treatment (diagonal hatch fill) at its minimal `sizes`
  value.
- `app/shared/detail-panel.js`, when Rising mode is active, adds a growth
  line above the existing description (e.g. "+340 stars (18%) in 30 days"),
  or "Not enough history yet — first tracked <date>" when
  `hasEnoughHistory` is `false`.

### File layout changes

```
/data/
  history/
    data-science.json          # NEW — per-tool star snapshots
    ...
/scripts/
  snapshot-history.mjs          # NEW — daily snapshot job
  velocity.mjs                  # NEW — pure scoring function
  generate.mjs                  # CHANGED — computes sizes/hasEnoughHistory per tool
  build-tree.mjs                # CHANGED — carries sizes/hasEnoughHistory onto leaves
/app/shared/
  layout.js                     # CHANGED — weightOf() takes mode+window
  treemap.js                    # CHANGED — mode toggle + window selector
  detail-panel.js               # CHANGED — growth stat / insufficient-history line
/.github/workflows/
  snapshot-history.yml          # NEW — daily cron
/test/
  velocity.test.js              # NEW
  snapshot-history.test.js      # NEW
```

## Error handling

- **Snapshot job**: a per-tool GitHub API failure is logged and that tool
  is skipped for the day rather than failing the whole run — a single
  missed day doesn't break windowed lookups, since scoring looks up the
  closest available snapshot rather than requiring exact daily coverage.
- **Missing/empty history file**: treated as "no history yet," not an
  error — every tool in that domain is `hasEnoughHistory: false` for every
  window until the snapshot job has run at least once.
- **Build-time validation**: extend the existing `findInvalidWeights`-style
  check in `generate.mjs` to also fail the build if any tool's computed
  `sizes` value is zero, negative, or `NaN` — a broken tile should never
  reach production.

## Testing

- `velocity.test.js`: exact-boundary windows (snapshot exactly N days old),
  gaps in snapshots (missing a day, still resolves to closest prior),
  declining stars (score floors at epsilon, never negative/zero), and a
  brand-new tool with no history (`hasEnoughHistory: false`).
- `snapshot-history.test.js`: appends a new day's entry correctly, updates
  (not duplicates) an existing same-day entry on a second run, and prunes
  entries older than 120 days.
- `generate.mjs`/`build-tree.mjs` tests extended to confirm a tool with a
  history fixture gets a correct `sizes`/`hasEnoughHistory` object, and a
  tool with none defaults to `hasEnoughHistory: false` on every window.
- Manual verification: run `snapshot-history.mjs` against a small fixture
  domain across several simulated days, then `npm run dev` and confirm the
  toggle switches tile sizes live, the window selector changes Rising
  sizing, an insufficient-history tile shows the hatch treatment, and the
  detail panel shows the right growth stat per mode — on both a full page
  and its `/embed/<slug>` counterpart.

## Deployment

- `snapshot-history.yml` needs the same GitHub API auth `enrich-domain.mjs`
  already uses (`gh auth token` locally; in Actions, the workflow's
  built-in `GITHUB_TOKEN` is sufficient for public-repo star lookups) and
  `contents: write` permission to commit `data/history/*.json` back to
  `master`.
- No change to `deploy.yml` beyond the fact that `generate.mjs` now also
  reads `data/history/*.json` — a domain with no history file yet still
  generates correctly (see Error handling).
