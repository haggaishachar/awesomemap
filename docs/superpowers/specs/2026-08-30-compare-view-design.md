# Compare View — Design

Status: Draft
Date: 2026-08-30

## Context

`product.md`'s Positioning & discovery section flags a project comparison
view as the single feature "most likely to turn a 30-second visit into a
10-minute one" — picking 2-4 projects and seeing stars, 7/30/90d growth,
momentum tier, and ecosystem side by side. It's explicitly unbuilt ("no
existing scaffolding — a new surface").

Two things already in the codebase turn out to matter a lot for this
design, despite predating it:

1. **`allProjectsWithDomain`** (`scripts/generate.mjs`, built for the
   global tag-groups and project-pages passes) is already every curated
   project across all domains, deduped, decorated with `growth`,
   `hasEnoughHistory`, `domainSlug`/`domainShort` — exactly the source list
   a cross-domain comparison needs, and nothing currently writes it out as
   its own artifact.
2. **`snapshot-history.mjs`'s `buildSnapshotEntry`** already captures
   `forks`, `openIssues`, and GitHub's own `name`/`description` in each
   day's snapshot — its docstring says outright this rides along "so the
   compare view can show current copy." That data has had no consumer
   until now.

The site is fully static (`generate.mjs` → `dist/`, no server/API), and
there is no existing cross-domain project lookup (site search is also
unbuilt) — so the core architectural problem this spec solves is: given
2-4 arbitrary project ids from any domain, how does a static page resolve
them to comparable data client-side.

Out of scope for this round (tracked as follow-ups): site search itself
(a real project picker), a cross-page "compare tray" that survives
navigating between domain pages (would require localStorage, which this
round deliberately avoids — see Non-goals), and folding
forks/open-issues capture into the momentum *signal* itself (that's
`product.md`'s separate "statistical anomaly detection" backlog item —
compare only *displays* forks/issues, it doesn't change how momentum is
computed).

## Goals

- **New route `/compare/`**, generated the same way `/rising/` and
  `/tags/` are — a static shell plus a client-side module that does the
  real rendering once loaded.
- **New build artifact `dist/compare-index.json`**: one compact record
  per canonical project (id, name, domain, image, link, desc, tags,
  stars, growth per window, forks, openIssues, momentum signal headline),
  built once per `generate.mjs` run from data it already has in memory —
  no new data collection, no new API calls.
- **Selection lives entirely in the URL**, as repeated `id=` query
  params (`/compare/?id=facebook/react&id=vuejs/core`) — matching
  `zoom-url.js`'s existing convention of repeated params over
  delimiter-joining for values that may themselves contain `/`, which
  every project id (`owner/repo`) does. Reloading, sharing, and bookmarking
  all reproduce the same comparison; no localStorage.
- **Entry points**: a "+ Compare" link on the detail panel and on
  `/projects/<id>/` pages, seeding a single-project `/compare/?id=…`.
  The compare page itself owns building up to 4 via a small "add
  project" box (typed `owner/repo` id or a pasted project-page URL,
  normalized to an id) — this is what makes cross-domain comparisons
  possible without any multi-select state living anywhere else.
- **Table content**: name/logo/link, ecosystem (domain), description,
  tags, stars, 7/30/90d growth, momentum (the existing `signal.headline`
  sentence from `signal.mjs`), forks, open issues.

## Non-goals

- No full search/picker UI — the add-box takes a typed id, not a fuzzy
  search. Real project search is `product.md`'s own separate, unbuilt
  backlog item; building a parallel picker here would duplicate that
  work under a different name.
- No cross-page "compare tray" / multi-select state on domain or project
  pages — would require localStorage to survive navigation, which
  contradicts the URL-only persistence goal above. The add-box on the
  compare page itself is the one place selection is built.
- No new momentum computation — `signal.mjs`'s `explainSignal` is reused
  as-is; forks/openIssues are displayed, not folded into the sustained/
  spike signal.
- No embed variant of `/compare/` — same reasoning as tag and project
  pages: embeds are for treemap visualizations, compare is a document.
- No "N things changed" diffing between comparisons or over time — that's
  `product.md`'s longer-term personalized-tracking idea, a different
  feature building on different (persisted, accounts-adjacent)
  infrastructure.

## Architecture

### `scripts/generate.mjs` (changed)

- After Pass 4 (project pages), builds `compareIndex`: maps
  `allProjectsWithDomain` to `{ id, name, domainSlug, domainShort, image,
  link, desc, tags, weight, growth, hasEnoughHistory, forks, openIssues,
  signalHeadline }`.
  - `growth`/`hasEnoughHistory` are already on each project (from Pass 1's
    `computeProjectSizing`) — copied through as-is.
  - `signalHeadline` reuses the same `explainSignal(...)` call Pass 4
    already makes for that project's page — computed once, not twice.
  - `forks`/`openIssues` come from `globalHistoryById[project.id]`'s most
    recent entry (already loaded in Pass 1 for star-history sparklines);
    `null` when the project has no history entries yet (see Error
    handling).
- Writes `dist/compare-index.json` via `writeFileSync`, one file for the
  whole site, alongside the other global outputs (`tags/index.html`-style
  writes already do the same thing at this point in the pipeline).
- Writes `dist/compare/index.html` via a new `renderComparePage()` (below)
  and adds `/compare/` to the sitemap's `extraPaths` (indexable, not
  domain- or project-specific).

### `scripts/render-page.mjs` (changed)

- `renderComparePage({ defaultOgImage, siteUrl, basePath })`: a minimal
  static shell (header/footer chrome, an empty `<div id="compare-root">`
  mount point, a `<script type="module" src="{basePath}/shared/compare.js">`)
  — no server-side knowledge of *which* projects are being compared; that
  only exists once the client parses the URL. Generic OG title/description
  ("Compare projects — awesomemap"), not per-comparison (a static build
  can't know the query string in advance).

### `app/shared/compare.js` (new, client-side)

- Pure/testable pieces, split out the same way `zoom-url.js` keeps
  URL logic DOM-free:
  - `parseCompareIds(searchParams)` → array of ids (repeated `id=` params,
    deduped, capped at 4 — extras beyond the 4th are dropped, not errored,
    so a hand-edited URL degrades gracefully).
  - `formatCompareIds(ids)` → query string, inverse of the above, used
    when the add-box or a remove ("×") control updates the URL via
    `history.pushState` (no full reload, matching how `treemap.js`
    already updates zoom state without reloading).
  - Row-building functions (growth line, momentum line, tag chips) —
    small, pure, given one project's `compare-index.json` record and
    returning DOM nodes or plain data, testable independently of the
    fetch/mount glue.
- DOM glue: on load, parse `id=` params, fetch `compare-index.json` once
  (cached in module scope for the page's lifetime), render one column per
  found id, render the add-box, wire remove buttons.
- Growth/momentum formatting (`+340 stars (+18%) in 30 days` etc.) is a
  small duplicated copy of `render-page.mjs`'s `formatSignedStars`/
  `formatSignedPercent`, following the same convention `detail-panel.js`
  already uses for the identical reason: `scripts/` is build-time-only and
  never ships to `dist/`, so client-side code keeps its own copy rather
  than importing across that boundary.

### `app/shared/detail-panel.js` (changed)

- New "+ Compare" link, built from `leafData.id` and `basePath`, appended
  after the existing "View full project page →" link (same
  `showProjectPageLink`-style gating — omitted in the embed variant, same
  reasoning as that link).

### `scripts/render-page.mjs` — `renderProjectPage` (changed)

- Same "+ Compare" link added next to the existing GitHub/homepage links.

### File layout changes

```
/scripts/
  generate.mjs                     # CHANGED — compareIndex build, /compare/ page, sitemap entry
  render-page.mjs                  # CHANGED — renderComparePage(), "+ Compare" link on project pages
/app/shared/
  compare.js                       # NEW — URL state, fetch/render, add-box, remove controls
  detail-panel.js                  # CHANGED — "+ Compare" link
/test/
  compare.test.js                  # NEW
```

## Data flow

```
generate.mjs (build time)
  allProjectsWithDomain + globalHistoryById + explainSignal(...)
    -> dist/compare-index.json   (one file, whole site)
    -> dist/compare/index.html   (static shell)

browser (/compare/?id=a&id=b)
  compare.js: parseCompareIds(url) -> fetch compare-index.json (once)
    -> look up each id -> render columns
  add-box / remove -> formatCompareIds -> history.pushState -> re-render
```

## Error handling

- **Id in the URL not found in `compare-index.json`** (stale link, typo,
  or a project since removed from curation): that column renders a
  "project not found" placeholder; other valid columns still render — one
  bad id doesn't fail the whole page, matching how a bad `path=` segment
  in `zoom-url.js` already falls back gracefully rather than erroring.
- **More than 4 `id=` params**: extras beyond the 4th are silently
  dropped when parsing, not treated as an error — keeps a hand-edited or
  very old shared URL usable.
- **Typed id in the add-box not found**: inline validation message next
  to the box ("couldn't find that project"); the URL is not touched until
  a valid id is entered.
- **`compare-index.json` fetch fails**: visible retry/error state in the
  mount point — unlike `history.json`'s existing silent
  `.catch(() => ({}))` fallback (acceptable there because a missing
  sparkline just means one absent chart), here without the index there is
  nothing to render at all.
- **Project has no history entries yet** (brand new, first snapshot not
  taken): `forks`/`openIssues` are `null` in the index; the table shows
  "—" for those cells, same convention `detail-panel.js` already uses for
  "Not enough history yet."
- **Zero or one `id=` param**: valid state, not an error — shows however
  many columns are present plus the add-box.

## Testing

- `test/compare.test.js`: `parseCompareIds`/`formatCompareIds` round-trip,
  dedup, the >4 cap, and row-building functions given sample
  `compare-index.json`-shaped records (present growth, missing history →
  "—", missing forks/openIssues → "—").
- `test/render-page.test.js` extended: `renderComparePage`'s static shell
  (mount point present, script tag present, OG tags present) and the new
  "+ Compare" link on `renderProjectPage`'s output.
- A `generate.mjs`-adjacent test (wherever the existing project-pages
  build logic is tested, if it is — otherwise a new focused test)
  covering `compareIndex` construction: fields present, `signalHeadline`
  matches the same-project's `/projects/` page signal, forks/openIssues
  pulled from the latest history entry, `null` when no history exists.
- Manual verification (`npm run dev`): `/compare/?id=<a>&id=<b>` renders
  both columns; the add-box adds a third from a different domain; a
  removed column updates the URL without a reload; `/compare/?id=<bad>`
  shows the not-found placeholder without breaking the other column;
  "+ Compare" from both the detail panel and a project page lands
  correctly; the embed variant omits the link.

## Deployment

No new workflow — ships via the existing `deploy.yml` on push to
`master`, same as every other `generate.mjs` change.

## Open questions

- Exact wording/layout of the add-box's id normalization (accepting a
  pasted `https://awesomemap.dev/projects/<id>/` or
  `https://github.com/<id>` URL, not just a bare `owner/repo`) — worth a
  quick pass during implementation rather than over-specifying the exact
  accepted formats here.
- Whether 4 is a hard cap or a soft one with graceful horizontal scroll
  beyond it — `product.md` says "2-4," this spec treats it as a hard cap
  for now; revisit if real usage wants more.
