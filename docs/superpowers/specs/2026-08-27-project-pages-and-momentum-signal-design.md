# Project Pages & Always-On Momentum Signal — Design

Status: Draft
Date: 2026-08-27

## Context

Following a product/UX audit of awesomemap.dev (see `product.md` for the
prior ongoing backlog), three structural gaps stood out against the
product's core promise — helping developers see what's gaining momentum in
open source, not just what's popular:

1. **A project has no canonical page.** It only exists as ephemeral
   client-side panel state (`app/shared/detail-panel.js`) inside one
   specific domain's treemap — not a URL, not shareable, not indexable.
2. **Popular mode — the default mode every visitor lands in — shows zero
   momentum signal.** `renderGrowthLine`/`renderDomainRankLine` in the
   detail panel only render when `leafData.activeSizeKey` is a `"rising*"`
   key, even though every leaf already carries `growth`/`hasEnoughHistory`
   for all three windows regardless of the active mode.
3. **The signal is computed but never explained.** The generator already
   computes per-project growth (`velocity.mjs`) and per-category growth
   (`group-growth.mjs`, surfaced today as the domain page's "Where the heat
   is" widget), but nothing compares them to say *why* a given project's
   growth is interesting — sustained across windows vs. a short-term spike,
   or outpacing its category.

This spec covers all three as one connected change: project pages give the
momentum story a permanent home; the always-on panel fix and the signal
line are what actually go in it (and, for the panel fix, in the existing
in-map flow too).

Out of scope for this round (tracked as follow-ups, not forgotten):
related-projects lists, an "also listed in" note for cross-domain
projects, site search, inline trend visuals on the `/rising/` leaderboard
rows, a "what changed since your last visit" feed, and hash-routing into a
specific treemap category. None of these are needed to ship the two core
fixes above, and folding them in now would blur one focused change into a
much larger one.

## Goals

- **New route `/projects/<owner>/<repo>/`** — one canonical, shareable,
  indexable page per project, url-shaped identically to its GitHub repo
  (`github.com/<owner>/<repo>` → `awesomemap.dev/projects/<owner>/<repo>/`),
  avoiding both slug-collision risk and a new slugification scheme.
- **Canonical domain per project**: a project curated into more than one
  domain's `data/<slug>.json` gets exactly one project page, attributed to
  whichever domain wins the same last-write-wins dedup `generate.mjs`
  already applies when building `allProjectsWithDomain` for global tag
  groups. No new dedup policy — reusing the existing one.
- **Always-on momentum**: both the project page and the detail panel show a
  momentum stat regardless of Popular/Rising mode. The panel's existing
  mode-gated behavior (showing the *active* window's stat as headline in
  Rising mode) is preserved on top of this — the fix is that Popular mode
  no longer shows nothing.
- **Signal line**: one derived sentence, computed by a new pure module,
  used on the project page and (space-permitting) rising-leaderboard rows:
  - *Sustained vs. spike*: `starDelta > 0` holds across all three windows
    (7/30/90d) vs. only the shortest.
  - *Relative to category*: the project's 7-day `percentDelta` vs. its
    category's 7-day `computeGroupGrowth` result (the same figure the
    domain page's "Where the heat is" widget already computes) — e.g.
    "growing 3.2× faster than LLM Frameworks this week."
- **Detail panel gains a "View full project page →" link** (non-embed
  only), so the fast in-map glance and the shareable canonical page are
  connected, not competing surfaces.
- **SEO parity with tag pages**: canonical URL, `SoftwareSourceCode`
  JSON-LD, sitemap inclusion.

## Non-goals

- No related-projects list on the project page yet (shared-tag/category
  suggestions) — natural next step once the page itself exists, deferred
  to keep this change to exactly the two core fixes above.
- No "also listed in [other domain]" note for cross-domain projects — the
  canonical-domain dedup already resolves *which* page exists; surfacing
  the others is a follow-up, not required for the page to be correct.
- No widening of category growth to all three windows — the
  category-relative comparison uses the existing 7-day
  `categoryGrowthBySlug` figure `generate.mjs` already computes for the
  domain widget, not a new 3-window category computation.
- No hash-routing/deep-linking the treemap to a project's category — the
  project page links back to the domain's page root, not into a specific
  zoomed state.
- No embed variant of project pages — same reasoning as tag pages: embeds
  are for treemap visualizations, a project page is a document.
- No new persisted data file — project pages are generated at build time
  from data `generate.mjs` already parses and sizes; nothing new is
  fetched or stored.

## Architecture

### `scripts/signal.mjs` (new, pure — no I/O)

- `explainSignal({ growthByWindow, categoryGrowth7d })`:
  - `growthByWindow` is a project's existing `growth` object (keyed
    `rising7`/`rising30`/`rising90`, as built by `computeProjectSizing` in
    `velocity.mjs`) alongside its matching `hasEnoughHistory` object.
  - `categoryGrowth7d` is the project's category's `computeGroupGrowth`
    result at the 7-day window (the same object `categoryGrowthBySlug`
    already holds per category).
  - Returns `{ sustained: boolean | null, relativeMultiple: number | null,
    headline: string | null }`:
    - `sustained` is `null` when any window lacks history (nothing to
      compare); otherwise `true` when `starDelta > 0` in all three windows,
      `false` when the 7-day window is positive but a longer window isn't
      (the "spike" case).
    - `relativeMultiple` is `null` when either side lacks history or the
      category's `percentDelta <= 0` (a ratio against a flat/shrinking
      baseline isn't a meaningful "faster than" claim); otherwise
      `project.percentDelta / category.percentDelta`, floored at a sane
      minimum before use (see Error handling).
    - `headline` is the one rendered sentence, composed from whichever of
      the two signals are available — e.g. "Growing steadily, 3.2× faster
      than LLM Frameworks this week," or just "Growing steadily this week"
      when the category comparison isn't available, or `null` when neither
      signal is (falls back to the plain momentum stat with no narrative
      line).
- No knowledge of HTML, routing, or the domain/category objects' full
  shape beyond the fields above — takes exactly the two precomputed inputs
  it needs, same pattern `computeGroupGrowth`/`computeRisingTags` already
  follow.

### `generate.mjs` (changed)

- After Pass 3 (per-domain pages) computes `categoryGrowthBySlug`, builds
  the canonical project list the same way the existing global-tag-groups
  dedup already does: `[...new Map(parsedDomains.flatMap(...)).values()]`,
  keyed by `id`, last domain read wins — reusing `allProjectsWithDomain`
  directly rather than a second, separately-ordered dedup pass.
- For each canonical project, looks up its category's `categoryGrowthBySlug[domainSlug]`
  entry (matched by `path[0]`, same key `generate.mjs`'s existing category
  grouping pass already uses) to pass into `explainSignal`.
- Writes `dist/projects/<owner>/<repo>/index.html` via a new
  `renderProjectPage` (below). `<owner>/<repo>` comes straight from
  splitting `project.id` on `/` — `CONTRIBUTING.md` already documents `id`
  as the GitHub `owner/repo` shorthand, so no new parsing/slugging
  function is needed; a project whose `id` doesn't contain exactly one `/`
  is treated as a data error (see Error handling).
- Collects every project page path into the same `extraPaths` list already
  passed to `buildSitemap` (alongside the tag page paths).

### `scripts/render-page.mjs` (changed)

- `renderProjectPage(project, { domain, categoryGrowth7d, signal, ... })`:
  - Header: logo, name, breadcrumb (`Home / <domain> / <path[0]> / …`,
    walking `project.path` in full — e.g. two segments for the
    artificial-intelligence domain's nested categories — each crumb
    linking to the landing page or the domain page, not a treemap
    deep-link, see Non-goals), star count, GitHub link, homepage link
    (when present). Note this breadcrumb is a display concern only: the
    signal's category comparison (below) is always keyed to `path[0]`
    specifically, matching `categoryGrowthBySlug`'s existing granularity —
    the two don't need to agree on depth.
  - Momentum block: three stat chips (7/30/90d), reusing the existing
    `renderMomentumStat`/`formatSignedPercent`/`formatSignedStars` helpers
    — no new formatting logic, just three calls instead of the one
    mode-gated call the panel makes today.
  - Signal line: `signal.headline` when non-null, rendered directly above
    the momentum block; omitted entirely when `null` (see Error handling).
  - Star-history sparkline: same SVG path-building approach
    `detail-panel.js` already uses client-side, but project pages are
    static HTML — the sparkline is rendered server-side from the same
    `data/history/<slug>.json` data `generate.mjs` already loads in Pass 1
    (no client-side fetch needed, unlike the panel).
  - Tag chips: same `renderTagChips`-equivalent as the panel already has,
    reused/ported to this server-rendered context.
  - Gets full `renderShell` treatment: canonical URL, OG tags, and a new
    `SoftwareSourceCode` JSON-LD via `seo.mjs` (below).
- `renderSiteHeader`/breadcrumb links are the only nav changes — no new
  top-level nav entry (project pages are reached via the treemap panel's
  new link and search-engine results, not a site-wide index page for this
  round).

### `scripts/seo.mjs` (changed)

- `buildSoftwareSourceCodeJsonLd({ name, description, url, codeRepository })`:
  a `SoftwareSourceCode` JSON-LD object, mirroring
  `buildItemListJsonLd`'s existing style (plain object, caller
  `JSON.stringify`s it) — `codeRepository` is the project's GitHub URL.

### `app/shared/detail-panel.js` (changed)

- `renderGrowthLine`: no longer returns `null` for Popular mode. When
  `activeSizeKey` is `"popular"` or absent, renders the 7-day stat (via
  `leafData.growth.rising7`/`hasEnoughHistory.rising7`, already present on
  every leaf) labeled as a 7-day figure rather than implying it's the
  active mode's own metric. When `activeSizeKey` is a `"rising*"` key,
  behavior is unchanged — that window's own stat headlines, as today.
- `renderDomainRankLine`: unchanged — domain rank is inherently a
  Rising-mode-window concept (rank *within a leaderboard for that window*),
  so it stays gated the same way it is today; the momentum stat alone is
  what needed to become mode-independent.
- New: a "View full project page →" link, built from `leafData.id`
  (split on `/` the same way `generate.mjs` does) and `basePath`, appended
  after the existing "Visit site ↗" link. Omitted when the panel is
  mounted in an embed page — embeds already carry `basePath` but the
  panel doesn't currently know it's embedded; simplest correct fix is
  passing a `showProjectPageLink` flag from `render-page.mjs`'s embed
  branch, mirroring how `renderDomainPage` already omits chrome for embeds
  at the call-site level rather than teaching child modules an `embed`
  flag of their own.

### File layout changes

```
/scripts/
  signal.mjs                      # NEW — pure: sustained-vs-spike, relative-to-category
  generate.mjs                    # CHANGED — canonical project list, /projects/ pages, sitemap
  render-page.mjs                 # CHANGED — renderProjectPage()
  seo.mjs                         # CHANGED — buildSoftwareSourceCodeJsonLd()
/app/shared/
  detail-panel.js                 # CHANGED — always-on 7d momentum, project-page link
/test/
  signal.test.js                  # NEW
```

## Error handling

- **`project.id` doesn't split into exactly `owner/repo`**: build-time
  error (thrown, same severity as the existing `id`/`path` validation in
  `generate.mjs`'s Pass 1) — a project page URL can't be derived, and
  silently skipping it would leave a project reachable from the treemap
  but not from its own page, a worse inconsistency than failing the build.
- **A project's category has no `categoryGrowthBySlug` entry** (e.g. a
  brand-new category with no history yet): `explainSignal` receives
  `categoryGrowth7d: undefined`, treats it as "not available," and
  `relativeMultiple` is `null` — the headline falls back to the
  sustained-vs-spike clause alone, or `null` if that's unavailable too.
- **Category `percentDelta <= 0`**: `relativeMultiple` is `null` rather
  than a negative or divide-by-near-zero ratio — "3.2× faster than a
  shrinking category" isn't a claim worth making; the sustained clause (if
  available) still renders alone.
- **No history at all for a project**: same convention every other
  momentum surface already uses — "Not tracked yet — first tracked …" (or,
  with zero snapshots, "Not tracked yet") in place of the momentum chips;
  `signal.headline` is `null` in this case (nothing to explain yet).
- **Two projects with the same `id` in different domains**: resolved by
  the existing last-write-wins dedup — not a new failure mode, just reused
  behavior.

## Testing

- `signal.test.js`: sustained-across-all-windows case, spike-only-in-7d
  case, missing-history-in-any-window (→ `sustained: null`), category
  comparison with a growing category, a flat/shrinking category (→
  `relativeMultiple: null`), a missing category entry, and the headline
  composition for each combination (both clauses, one clause, neither →
  `null`).
- `render-page.test.js` extended: `renderProjectPage` renders all three
  momentum chips, renders the signal line when present and omits it when
  `null`, includes the `SoftwareSourceCode` JSON-LD, and its breadcrumb
  links to the right domain page.
- `seo.test.js` extended: `buildSoftwareSourceCodeJsonLd` shape.
- Manual verification (`npm run dev`): a project page loads at
  `/projects/<owner>/<repo>/`, the detail panel shows a momentum stat in
  Popular mode (previously blank), its "View full project page →" link
  navigates correctly and is absent in the embed variant, and the sitemap
  includes every project page path.

## Deployment

No new workflow — ships via the existing `deploy.yml` on push to `master`,
same as every other `generate.mjs` change.

## Open questions

- Whether the signal headline's exact wording ("Growing steadily, 3.2×
  faster than X this week") reads well across the full range of real
  `relativeMultiple` values (e.g. a 47× outlier from a very small
  category) — worth a quick eyeball pass over real data during
  implementation rather than over-specifying copy rules here.
