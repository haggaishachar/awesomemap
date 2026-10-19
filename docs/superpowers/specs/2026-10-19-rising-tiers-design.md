# Rising tiers, Spiking, and the anomaly guard — design

Date: 2026-10-19
Status: approved in brainstorming, pending spec review

## Problem

The Show HN post ("discover rising open-source projects before they get
big") drew the fair criticism that the front page leads with Ghidra, Vite,
PageIndex and Codex. The rising score,
`starDelta / sqrt(currentStars + 2000)` (`scripts/velocity.mjs`), damps size
too weakly: on the 2026-10-19 7-day data (1,266 growing projects, median
~12k stars) the global top 15 is almost entirely 30k–315k-star projects,
with one project under 5k.

Two more gaps showed up in the same data:

- No surface rewards a *sudden* change of pace — a project growing many
  times faster than its own norm is invisible unless its absolute gain is
  also large.
- `morluto/rea` went ~87k → 314k stars in 7 days (+227k, +261%), ranking #1
  under every formula. That is almost certainly purchased stars or a data
  error, and it currently tops the leaderboard.

## Goals

- Small projects get their own ranked space, and it is the default view
  everywhere, so "before they get big" is literally true.
- Sudden accelerations get a dedicated surface, open to any size.
- Large projects stay visible, ranked against their peers.
- Implausible star jumps never top a leaderboard.

## Non-goals

- Changing `computeVelocity`'s score formula or the treemap's Rising tile
  sizes.
- A manual per-project override/allow list for the anomaly guard.
- Moving `readme-risers.mjs` or `rising-story-select.mjs` to tiers (follow-up).
- New data sources (Codeberg/GitLab) or new categories.

## Design

### 1. Tiers

One exported constant, in a new `scripts/tiers.mjs` (in both repos):

```js
export const TIERS = [
  { key: "breakout", label: "Breakout", minStars: 0, maxStars: 10_000 },
  { key: "climbing", label: "Climbing", minStars: 10_000, maxStars: 50_000 },
  { key: "giants", label: "Giants", minStars: 50_000, maxStars: Infinity },
];
export const DEFAULT_TIER = "breakout";
export function tierForStars(stars) { /* first tier with minStars <= stars < maxStars */ }
```

`minStars` is inclusive, `maxStars` exclusive. Tier membership uses the
candidate's `currentStars` as of the leaderboard's `asOf`. On 2026-10-19
data the split is 555 / 538 / 173 growing projects.

`SMALL_PROJECT_STAR_THRESHOLD` (5k, "one to watch") stays separate and
unchanged.

### 2. `computeLeaderboard` changes (`scripts/leaderboard.mjs`)

New optional option `tier` (a tier key). When present, `collectCandidates`
drops candidates outside that tier **before** ranking, for both today's and
yesterday's candidate lists. Membership is decided per day from that day's
`currentStars`, then the existing id-intersection step keeps both rank spaces
over the same population. Consequence: a project that crossed 10k overnight
is in neither Breakout's nor Climbing's intersection that day (it was
Breakout yesterday, Climbing today), so it is absent from both tiered
leaderboards for one day and appears in Climbing the next. This is accepted
— it mirrors how the existing rule already drops newly-eligible entries for
a day, and avoids a rankDelta computed across two different tiers.

Omitting `tier` means all sizes — existing callers are unchanged.

Every returned row gains `tier` (the key from `tierForStars(currentStars)`).

### 3. Anomaly guard

In `collectCandidates`, after computing velocity, skip any candidate where:

```
baselineStars >= ANOMALY_MIN_BASELINE_STARS (10_000)
&& percentDelta > ANOMALY_MAX_PERCENT_DELTA (100)
```

`percentDelta` is the window's own (7d or 30d). Both constants are exported
from `leaderboard.mjs`. The guard applies whether or not `tier` is set, so
all leaderboard consumers (including `readme-risers` and `rising-story`)
inherit it.

`generate.mjs` logs one `console.warn` per excluded project id per build
(collected via a new exported `findAnomalies(domains, { windowDays, now })`
helper that reuses the same predicate — `collectCandidates` itself stays
silent). Excluded projects keep their treemap tile and project page; only
leaderboards, signals and teasers skip them.

### 4. Spiking (`scripts/spiking.mjs`, new, pure)

```js
export const SPIKING_MIN_STAR_DELTA = 100;
export const SPIKING_MIN_SHARE_OF_STARS = 0.005; // 0.5%
export const SPIKING_BASELINE_WEEKS = 4;
export const SPIKING_SMOOTHING = 20;

export function computeSpiking(domains, { scope, limit = 20, now = new Date() })
```

For each project in scope (global dedupes to the best-multiple listing, as
`computeLeaderboard` does):

- `d7` = stars gained over the last 7 days (same baseline lookup as
  `computeVelocity`).
- `priorWeekly` = (stars at 7 days ago − stars at 35 days ago) / 4.
- `multiple = d7 / (max(priorWeekly, 0) + SPIKING_SMOOTHING)`.

Eligible only when: history reaches back 35 days; `d7 >= 100`;
`d7 >= 0.005 * currentStars`; and not excluded by the anomaly guard.

Ranked by `multiple` desc (ties by name). Rows have the same shape as
leaderboard rows plus `multiple` and `priorWeekly`, and `tier: "spiking"`
for rendering. `rankDelta` is computed the same way as `computeLeaderboard`
(today vs. `now − 1 day`, intersected population).

Spiking has only a 7-day form. On `/rising/`, the 30d window toggle is
disabled while the Spiking tab is active.

### 5. Surfaces

**`/rising/` (`renderRisingPage`)**

- New tab bar above the domain filter: Breakout · Climbing · Giants ·
  Spiking. Breakout active by default.
- Pre-rendered blocks for every tier × scope × window (Spiking: 7d only),
  toggled client-side with the existing show/hide pattern. Each block carries
  `data-tier`, `data-window`, and lives inside its scope's section.
- One-line explainer under the tab bar per tab:
  - Breakout: "Projects under 10k stars, ranked by star growth."
  - Climbing: "Projects with 10k–50k stars, ranked by star growth."
  - Giants: "Projects over 50k stars, ranked by star growth."
  - Spiking: "Projects growing far faster than their own usual pace."
- Spiking rows show "N× its usual pace" in place of the percent stat.
- Empty tier × scope: "No growing projects in this tier for this domain
  this week." instead of an empty list.
- URL hash: `#<domain>`, `#<tier>`, `#<domain>/<tier>`; missing tier =
  Breakout, missing domain = all. Existing `#<domain>` links keep working.
  Clicking a tab or domain updates the hash with `history.replaceState`.
- Hero tagline: "Fast-growing projects, grouped by size — start with the
  ones that haven't hit 10k stars yet."

**Homepage "this week's signals" (`this-weeks-signals.mjs`)**

- `mover` (Biggest mover): highest `starDelta` among Breakout-tier
  candidates only.
- `heatingUp` slot is replaced by `spiking`: the top `computeSpiking` row
  for the scope, card label "⚡ Spiking", stat "N× its usual pace (+D
  stars this week)". `pickThisWeeksSignals` takes an optional
  `spikingPool` argument; generate.mjs passes the scope's
  `computeSpiking(..., { limit: Infinity })` result.
- `watch`, `breakout`, `buzz`, `losingMomentum` unchanged.
- Uniqueness: `spiking` is picked after `mover`/`watch`/`breakout` and skips
  their ids; `buzz`/`losingMomentum` skip `spiking`'s id too.
- The anomaly guard already applies through `computeLeaderboard`.

**Domain-page teaser (`renderRisingTeaser` call in `renderDomainPage`)**

- Top 5 of the domain's Breakout leaderboard.
- If Breakout has fewer than 3 rows, fill up to 5 from Climbing; filled
  rows show a small "Climbing" tag.
- Heading stays "Rising this week"; link goes to `/rising/#<domain>`.

**Detail panel rank (`app/shared/detail-panel.js`)**

- `domainRank[risingN]` becomes `{ tier, rank } | null`, rank within the
  project's own tier on that domain's tiered leaderboard.
- Text: "#3 Breakout in AI" / "#2 Giant in AI" / "#5 Climbing in AI"
  (singular label map: breakout → Breakout, climbing → Climbing,
  giants → Giant).

**Archive and RSS**

- Snapshot rows use composite scope keys `<tier>:<scope>` (e.g.
  `breakout:global`, `spiking:artificial-intelligence`). Tiers: breakout,
  climbing, giants, spiking. No D1 schema or worker change — `scope` is
  already a free string (awesomemap-data `src/lib/writes.mjs`,
  `buildReplaceLeaderboardSnapshotStatements`).
- Plain `global` / `<slug>` keys are still written, as a copy of the
  Breakout rows, so existing readers keep working.
- `renderRisingArchiveWeekPage`: when `scopes["breakout:global"]` exists,
  render the same tier tabs (no window toggle — snapshots are 7d); otherwise
  render the existing "Hottest overall" layout.
- `rss.mjs`: item lists `scopes["breakout:global"]` (fallback
  `scopes.global`), plus one line "Biggest spike: <name> (N× its usual
  pace)" when `scopes["spiking:global"]` has a row.

### 6. Cross-repo sync

`awesomemap-data/scripts/leaderboard.mjs` and `this-weeks-signals.mjs` are
byte-for-byte copies of this repo's files. `leaderboard.mjs`, `tiers.mjs`
and `spiking.mjs` must be identical in both repos after this change.
`awesomemap-data/scripts/leaderboard-snapshot.mjs`'s `buildWeeklySnapshot`
adds the tiered and spiking scopes.

## Testing

All with `node --test`, following existing `test/*.test.js` style.

- `leaderboard.test.js`: tier filtering before ranking; boundary at exactly
  10,000 (→ Climbing) and 50,000 (→ Giants); a project crossing 10k
  overnight is absent from both Breakout and Climbing that day; no `tier` = all sizes; anomaly guard excludes +101% on a 10k
  baseline, keeps +101% on a 9,999 baseline and +99% on a 10k baseline;
  rows carry `tier`.
- `spiking.test.js` (new): multiple math; each floor (100 stars, 0.5%,
  35-day history); 10 → 112/week on a 175k project is excluded by the
  0.5% floor; global dedupe; anomaly exclusion; rankDelta.
- `this-weeks-signals.test.js`: mover only from Breakout; spiking card
  picked and deduped against mover/watch/breakout; buzz/losingMomentum skip
  the spiking id; null spikingPool → no spiking card.
- `render-page.test.js`: tab bar with Breakout active; blocks per
  tier × scope × window; Spiking has no 30d block; empty-tier message;
  teaser fill from Climbing with tag; tiered vs. legacy archive week page.
- `rss.test.js`: prefers `breakout:global`, falls back to `global`, spike
  line present/absent.
- Detail-panel rank text: covered where `detail-panel.js` rank formatting is
  tested, or a new focused test of the formatting function.
- awesomemap-data: `buildWeeklySnapshot` emits composite keys plus plain
  copies.
- Manual: `npm run generate` on real data, check `/rising/` (each tab, a
  domain hash, `#spiking`), homepage signals, and one domain page in the
  browser preview at desktop and mobile widths. Confirm `morluto/rea` is
  absent from leaderboards and logged.

## Rollout

1. awesomemap-data: add `tiers.mjs`, `spiking.mjs`, sync `leaderboard.mjs`,
   extend `buildWeeklySnapshot`. Safe first — nothing reads the new keys.
2. awesomemap: scoring modules (tiers, leaderboard, spiking), then
   signals, then rendering surfaces, then detail panel.
3. After deploy: reply on the HN thread.

## Follow-ups (not in this change)

- Move `readme-risers.mjs` and `rising-story-select.mjs` to Breakout.
- Override list for anomaly-guard false positives.
- Revisit tier cutoffs once a few weeks of tiered snapshots exist.
