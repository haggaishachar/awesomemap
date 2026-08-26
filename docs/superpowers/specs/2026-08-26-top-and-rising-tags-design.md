# Top & Rising Tags — Design

Status: Draft
Date: 2026-08-26

## Context

Every project in `data/<slug>.json` now carries a `tags` field (an array of
its GitHub topics — see the `backfill-repo-tags` branch/commit
`5e51643`), backfilled across all 507 projects. Nothing in the app reads it
yet. Raw GitHub topics are noisy: generic language/campaign tags
(`python`, `hacktoberfest`) dominate by sheer frequency, some tags are
self-referential (pandas is tagged `pandas`), and cardinality per project
ranges from 1 to 15.

Separately, the site already has a working "how did this slice of the
ecosystem move?" answer at multiple scopes — `scripts/velocity.mjs`
(per-project) and `scripts/group-growth.mjs` (`computeGroupGrowth` +
`rankGroups`, currently used for categories and domains). `computeGroupGrowth`
takes a plain `projects` array and a `historyById` map, so it has no
built-in notion of *how* projects are grouped — grouping by shared tag
instead of by category/domain slots in without changing that function.

This spec adds tags as a first-class, third grouping dimension (alongside
category and domain), surfaced at three points: a compact widget on each
domain page, a new global `/tags/` explore page, and clickable tag chips on
the project detail panel.

**Dependency**: this spec builds on the `tags` field from `backfill-repo-tags`
(commit `5e51643`) — that branch must land first.

## Goals

- **New pure module `scripts/tag-growth.mjs`** owning every tag business
  rule: self-referential filtering, the stopword list, the ≥2-project
  eligibility threshold, popularity ranking, and growth ranking. Returns
  plain data; knows nothing about HTML, routing, or slugs.
- **Popularity ranking ("top tags")**: total stars across a tag's projects,
  primary sort; project count carried alongside as a secondary stat —
  mirrors how `rankGroups`'s callers already show `trackedCount/projectCount`
  next to a growth stat.
- **Growth ranking ("rising tags")**: `computeGroupGrowth` per tag group per
  window (7/30/90d), same eligibility rule the `/rising/` leaderboard
  already applies (`hasEnoughHistory` and `starDelta > 0` — a "rising" list
  never shows a flat or shrinking tag).
- **Domain-page widget**: a third section in the existing `.domain-insights`
  block (alongside "Where the heat is" and the "Rising this week" teaser) —
  "Top tags in this domain," domain-scoped, top tags decorated with a
  matching growth badge (default 7d window) where the tag also qualifies as
  rising. The badge lookup is a display-only join in the render layer (see
  Architecture) — no business logic there.
- **Global `/tags/` index page**: "Top tags" (global, star-ranked) and
  "Rising tags" (global, 7/30/90d window toggle, same client-side
  precomputed-per-window pattern the map and `/rising/` already use) — no
  per-domain filtering on this page (see Non-goals).
- **Per-tag pages `/tags/<slug>/`**: one per qualifying tag (~626 at current
  data volume), header with aggregate stats (total stars, project count,
  default-window growth), then every carrying project listed by star count
  with a domain badge (tags cross domains). Gets full `renderShell` SEO
  treatment (OG, canonical, `ItemList` JSON-LD) — a genuine long-tail SEO
  surface as a side effect.
- **Detail-panel tag chips**: existing detail panel gains a chip per tag,
  linking straight to `/tags/<slug>/`.
- **Nav entry**: "Tags" added to `renderSiteHeader`, next to "Rising."
- **Strict data/presentation separation**: `render-page.mjs` never imports
  or calls `tag-growth.mjs`. It only gains functions that accept
  already-computed, already-ranked arrays as parameters. `generate.mjs` is
  the sole file that calls both and wires one's output into the other's
  input — same pattern already used for `categoryGrowthBySlug`.

## Non-goals

- No per-domain filtering UI on the global `/tags/` index page — domain-
  scoped tag rankings already live on the domain widget; a second filtering
  mechanism for the same data would be pure duplication.
- No embed variant of tag pages — embeds are for treemap visualizations;
  a tag page is a list.
- No client-side treemap filtering/highlighting when a tag chip is clicked
  — chips navigate to the tag's page instead, which is richer (tags cross
  domains) and reuses one mechanism instead of two.
- No hand-maintained tag denylist file, no synonym/canonicalization mapping
  (e.g. merging `gbdt`/`gbm`/`gbrt`). Filtering is two hardcoded rules
  (self-referential check + a 3-item stopword constant) living in code, not
  data — zero ongoing curation burden. Revisit only if the shipped top-tags
  list turns out to still need it.
- No changes to `discover-projects.mjs`/`enrich-domain.mjs`'s tag
  population — that's `backfill-repo-tags`'s concern, already shipped
  there.
- No new persisted data file — tag groupings and rankings are recomputed at
  build time from `data/<slug>.json` + `data/history/<slug>.json`, same as
  every other derived stat on the site.

## Architecture

### `scripts/tag-growth.mjs` (new, pure — no I/O)

- `STOPWORD_TAGS = new Set(["hacktoberfest", "open-source", "awesome"])` —
  hardcoded, not data-driven (see Non-goals).
- `isSelfReferential(tag, project)`: normalizes both sides
  (`toLowerCase()`, strip non-alphanumeric) and compares `tag` against both
  `project.name` and the repo-name segment of `project.id` (e.g.
  `pandas-dev/pandas` → `pandas`) — catches a tag matching either the
  display name or the repo slug.
- `buildTagGroups(projects)`: for each project, for each of its `tags`,
  drops it if stopword-listed or self-referential, then buckets projects by
  surviving tag (one project can land in several groups — this is the one
  place a project fans out to multiple groups, unlike category/domain
  grouping). Drops any resulting group with fewer than 2 projects. Returns
  `[{ tag, projects }]`. Pure grouping — no history, no ranking; reused by
  both functions below and computed once per scope (global once, once per
  domain), independent of any growth window.
- `computeTopTags(tagGroups, { limit } = {})`: for each group, sums
  `weight` (`totalStars`) and counts projects (`projectCount`); sorts by
  `totalStars` descending (ties: `projectCount` desc, then `tag`
  alphabetically), stamps `rank`, slices to `limit` if given. No history
  input — this ranking is history-independent.
- `computeRisingTags(tagGroups, historyById, windowDays, { limit } = {})`:
  runs `computeGroupGrowth(group.projects, historyById, windowDays)` per
  group, filters to `hasEnoughHistory && starDelta > 0`, ranks via the
  existing `rankGroups` (mapping each group to `{ key: tag, growth }`) so
  the sort/tie-break logic isn't duplicated, slices to `limit`. Returns
  `[{ tag, projectCount, totalStars, rank, growth }]`.
- Neither function knows about slugs, HTML, or routing — output is keyed by
  the raw tag string.

### `generate.mjs` (changed)

- Computes `buildTagGroups` once per scope needed: once globally, once per
  domain.
- Computes `computeTopTags` per scope (history-independent, one pass each).
- Computes `computeRisingTags` per scope per window it needs: global × 3
  windows (7/30/90, for the `/tags/` page's window toggle) and per-domain ×
  1 window (default 7d, for the widget).
- Builds one `/tags/index.html` page (global top + rising lists) and one
  `/tags/<slug>/index.html` per qualifying global tag, via new
  `render-page.mjs` functions (below). `<slug>` comes from a new
  `tagSlug(tag)` helper — GitHub topics are already lowercase-hyphenated,
  so this is close to identity, but centralizes the escaping/routing
  decision in one place rather than inlining it at each call site.
- Passes each domain's `{ topTags, risingTags }` into `renderDomainPage`
  the same way `categoryGrowth` is passed today.

### `scripts/render-page.mjs` (changed)

- `tagSlug(tag)`: routing-layer helper (see above) — the one place a tag
  string becomes a URL path segment. Lives here, not in `tag-growth.mjs`.
- `renderTagWidget(topTags, risingTags, { windowDays })`: renders the
  domain-page section. Builds a `Map` from `risingTags` keyed by `tag`, and
  for each `topTags` row looks up a matching growth badge to render inline
  (via the existing `renderMomentumStat`) if present. This lookup is
  display-only — it decides nothing about eligibility or ranking, both of
  which `tag-growth.mjs` already decided; it just answers "does this
  already-ranked tag happen to also appear in that already-ranked list."
  Returns `""` when `topTags` is empty (mirrors `renderCategoryMomentum`'s
  existing convention).
- `renderTagsIndexPage(topTags, risingTagsByWindow, { ... })`: the global
  `/tags/` page — a "Top tags" list and a window-toggled "Rising tags" list,
  same precomputed-per-window/client-side-toggle pattern `renderRisingPage`
  already uses.
- `renderTagPage(tag, projects, growth, { ... })`: one project's-eye view
  of a tag — header stats, then project rows (name, domain badge, stars),
  sorted by stars descending. Gets the full `renderShell` treatment (OG,
  canonical, `ItemList` JSON-LD), same as domain pages.
- `renderSiteHeader` gains a "Tags" link next to "Rising."

### `app/shared/detail-panel.js` (changed)

- Renders a chip per `project.tags` entry, `href="${basePath}/tags/${tagSlug}/"`
  — the panel already has `basePath` in scope for its other links. Uses the
  same `tagSlug` logic as `render-page.mjs` (small shared helper, or
  duplicated one-liner — see open question below).

### `app/shared/treemap.css` (changed)

- New styles: tag chip (detail panel), tag list/row (widget + index page +
  per-tag page), reusing existing color tokens rather than introducing new
  ones.

### File layout changes

```
/scripts/
  tag-growth.mjs                 # NEW — pure: filtering, grouping, top/rising ranking
  generate.mjs                   # CHANGED — computes tag stats, builds /tags/ pages, wires widget data
  render-page.mjs                # CHANGED — renderTagWidget, renderTagsIndexPage, renderTagPage, tagSlug(), nav link
/app/shared/
  detail-panel.js                # CHANGED — tag chips linking to /tags/<slug>/
  treemap.css                    # CHANGED — chip + tag-row styles
/test/
  tag-growth.test.js             # NEW
```

## Error handling

- **A project with no tags**: contributes to no group; no error.
- **A scope with zero qualifying tags** (everything filtered out or below
  the 2-project threshold): `renderTagWidget`/`renderTagsIndexPage` render
  an empty section (`""`), same convention `renderCategoryMomentum` already
  uses — not an error, not a placeholder.
- **A tag with projects but insufficient history**: `computeRisingTags`
  simply excludes it via the existing `hasEnoughHistory` filter; it can
  still appear in the popularity-only "top tags" list.
- **Build-time validation**: tag stats are built from the same `weight`/
  `computeGroupGrowth` values already validated elsewhere in `generate.mjs`
  (`findInvalidSizes`); no separate NaN/invalid-value check needed here.

## Testing

- `tag-growth.test.js`: self-referential filtering (both name-match and
  id-match cases), stopword filtering, the ≥2-project threshold, a project
  fanning out into multiple groups, `computeTopTags` sort/tie-break,
  `computeRisingTags`'s `starDelta > 0` eligibility filter and its reuse of
  `rankGroups`' sort order, and `limit` slicing.
- `render-page.test.js` extended: `renderTagWidget`'s badge-join logic
  (a top tag with a matching rising entry gets a badge, one without
  doesn't), `renderTagsIndexPage` renders all three windows, `renderTagPage`
  renders its project list with domain badges and gets `ItemList` JSON-LD.
- `generate.test.js`/manual verification: `npm run dev`, confirm `/tags/`
  renders, a per-tag page's project list is correct, a domain page's widget
  links to the right tag pages, and a detail-panel chip navigates to
  `/tags/<slug>/`.

## Deployment

- No new workflow — ships via the existing `deploy.yml` on push to
  `master`, same as every other `generate.mjs` change. Requires
  `backfill-repo-tags` merged first (see Context).

## Open questions

- Where the `tagSlug`-equivalent used by `detail-panel.js` (client-side)
  should live, given `render-page.mjs` (server-side) isn't importable from
  browser code — likely a small duplicated pure function (GitHub topics are
  already URL-safe, so this is close to a one-liner) rather than a shared
  module, but worth confirming during implementation rather than
  over-engineering a shared client/server utility for a near-identity
  function.
