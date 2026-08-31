# Product improvement backlog

Ongoing, non-urgent improvement ideas for awesomemap.dev — a running list
to pull from, not a commitment or a schedule. Sections and items are
ordered most-impactful-first; completed items move to Shipped at the end
instead of cluttering the top.

See [`MVP.md`](MVP.md) for the current curated, priority-ordered shortlist
pulled from this backlog — the commitment-shaped subset of the ideas below.

## Positioning & discovery experience

Added from an external first-time-user review of the live site received
2026-08-28 (homepage → ecosystem map → Rising flow). Its core critique: the
product currently reads as a well-made data directory rather than a tool
worth returning to, because "momentum, not just popularity" isn't yet the
thing a visitor actually *experiences* — it's true of the data but not of
the UI. The reviewer's own priority order was: hero rewrite, project pages,
and search as P0; real visual maps, momentum visualization, and "why is
this rising" as P1; compare and personalized tracking as P2. Project pages
and tags (P0/P1) had already landed or were in flight before this review —
see Shipped, at the end of this file.

- [ ] Give the ecosystem map genuine map-like affordances: a growth-based
      color/intensity scale (not just box area for size), and a visual cue
      that distinguishes a "zoom into category" box from an "open project
      detail" box before the click. `app/shared/treemap.js`/`treemap.css`
      already size boxes by the active metric, but carry no growth-color
      scale, and `.treemap-category`/`.treemap-leaf` still share identical
      chrome (also tracked as the narrower version of this fix under Flow &
      conversion, below — this is the more ambitious "make it feel like a
      map" version of the same gap).
- [ ] Reframe the Rising page's mental model from "leaderboard" to "what's
      happening right now," and make a trend visible without a click.
      Section headings already lean this way ("Hottest overall" /
      `renderRisingPage`), but each row (`renderRisingRow`,
      `scripts/render-page.mjs` line 380) is still a flat ranked table with
      no per-row trend cue, so a reader can't tell a sustained climb from a
      one-week spike without opening the project page. Surface
      `explainSignal`'s sustained/spike verdict as a small per-row badge,
      and/or add the row-level sparkline the project-pages spec explicitly
      deferred ("inline trend visuals on the /rising/ leaderboard rows" —
      see that spec's Context section).
- [ ] Flip the primary discovery path from taxonomy-down (domain → category
      → projects) to signal-up (an interesting/rising project or tag → its
      ecosystem → related projects → compare). Concretely: surface specific
      rising projects and tags directly in the homepage teaser, not just
      domain names, so a visitor can land on e.g. a specific fast-rising
      project or tag before ever choosing a domain. The reverse direction
      (ecosystem → project, via the map's zoom-in and a project page's
      breadcrumb) already works well; this is about adding the missing
      forward entry points.
- [ ] Make "momentum" the site's explicit organizing concept across every
      surface, not just inside a project page. The ranking math already
      does this — `rankCandidates` in `scripts/leaderboard.mjs` sorts by
      growth `score`, never by absolute stars — but nothing near the
      homepage teaser or Rising rows says so as plainly as a project page's
      signal line does. Bring consistent momentum language/iconography
      (tie in with the copy pass below) to those surfaces too.
- [ ] Richer summary cards wherever a project appears in list form (Rising
      rows, domain teasers, tag pages): a one-line "why you're seeing this"
      context (e.g. "#2 fastest-growing AI project this week," derivable
      from the `rank`/`domainSlug` the row already carries), alongside a
      compact momentum bar or sparkline. Related to the Rising-page item
      above but broader — every list surface, not just Rising.
- [ ] Friendlier empty-state copy for windows/categories without enough
      star history yet. `renderRisingRows` (`scripts/render-page.mjs` line
      408) and its domain-page counterpart show a flat "Not enough
      star-history yet for this window." for e.g. newer domains or the 90d
      window on young categories — reads as broken rather than "still
      collecting data." Name when the window will become available (from
      the domain/category's first tracked snapshot date, already known to
      `generate.mjs`), or hide the empty section entirely until it has
      data.
- [ ] "Today's signals" homepage module — a rotating summary (a heating-up
      ecosystem, the biggest single-project mover, a small "one to watch"
      with unusually high acceleration relative to its size, optionally a
      cooling-off item) as a reason to come back daily — closer to a
      Hacker-News-trends/Bloomberg-terminal framing than a static directory
      front page. Builds on data already computed for the Rising
      leaderboard and `group-growth.mjs`'s category rankings — mainly a new
      render surface, not new data.
- [ ] Site-wide copy pass toward heat/momentum/discovery language, e.g.
      "🔥 What's heating up" instead of "Rising stars," "🗺 Explore the
      ecosystems" instead of "Explore the maps." Low-effort, and ties
      together every item above into one consistent voice. `MVP.md` item
      #4 (renaming "Today's signals" to "This week's signals") is the
      first slice of this.
- [ ] Longer-term: personalized tracking — "follow" a domain/category/tag
      and get a "N things changed since your last visit" digest. No
      accounts or persistence exist today; sequence this after search and
      project pages land, and prefer a client-side (localStorage follow
      list + generated diff) approach before a server-side accounts system
      is justified.

## Usability

- [ ] Site search. The whole site is browse-only today — finding a known
      project means guessing which domain/category it's filed under. Since
      each domain's data is static JSON at build time, a small client-side
      fuzzy-search index (built at generate time, searched in-browser)
      would let visitors jump straight to a project by name. Should match
      on tags too, so it doubles as the entry point into the project pages
      and tag pages above (Positioning & discovery experience) — a
      developer's first instinct is "does this track X," and search is
      currently the only piece of that flow that doesn't exist yet.

## Flow & conversion

Added from a user-perspective walkthrough of the live site and source on
2026-08-28, focused on where visitors get stuck or leave earlier than they
need to.

- [ ] Explain Popular/Rising and box sizing on pages reached without going
      through the homepage first. The tagline on `/` (in
      `scripts/render-page.mjs`) is the only place that spells out what the
      mode toggle and box size represent — a domain page or `/rising/`
      reached via search or a shared link has no equivalent, just the mode
      bar itself. A small "?" affordance near the mode bar would cover
      that entry path.
- [ ] Add a backdrop-click / Escape dismissal to the detail panel.
      `createDetailPanel` (`app/shared/detail-panel.js`) only wires close
      to the `×` button and to a mode switch — on narrow viewports the
      panel is a fixed 320px slide-in with only that small button as an
      escape hatch.
- [ ] Surface a note when a mode/window switch relocates focus out of an
      "Others" bucket. `findNodeByIdPath` in `app/shared/treemap.js`
      intentionally bounces focus up to the real parent category when
      Others' synthetic id doesn't survive a Popular/Rising switch (its
      membership isn't stable across sizing modes) — correct behavior, but
      silent, so it can read as "where did my view go?" A brief transient
      note would close the gap.

## Data foundation

Added from a review of an external product-backlog brainstorm received
2026-08-30. Most of that brainstorm's ideas (tags, project pages, a
"why is this rising" narrative, a weekly risers digest, automated
candidate discovery + review, keyboard a11y, compare view, search) turned
out to already be shipped or already tracked above — this section is what
was left after checking against the actual code: the site's momentum
signal is real but built on stars alone, and has no visible reliability
net if the daily jobs that feed it go quiet.

- [ ] Statistical anomaly detection, not just sign-based sustained/spike.
      `computeSustained` (`scripts/signal.mjs`) only checks whether growth
      is positive in every window — it can't say "this is 3× this
      project's own trailing average," which is what actually
      distinguishes a genuine breakout from routine growth. Comparing each
      window's delta to the project's own prior-window baseline (not just
      its category's, which `computeRelativeMultiple` already does) would
      sharpen the "why is this rising" headline beyond today's two-state
      verdict. Forks/open-issues history is now captured (see Shipped)
      but not yet fed into this — a star spike corroborated by fork
      movement should read differently from one that isn't, and today the
      signal still can't tell the two apart.
- [ ] A single normalized momentum score (e.g. "Momentum 92 🔥") to
      complement `explainSignal`'s sustained/spike + relative-multiple
      narrative — something a reader can compare across projects at a
      glance without parsing a sentence. Sequence this after the two items
      above: a score built from stars alone would be as gameable as a
      star count is today, and less trustworthy than one corroborated by
      forks/issues activity and anomaly detection.
- [ ] On-site data freshness indicator (e.g. "Data updated 6h ago"), from
      `data/history/<slug>.json`'s latest snapshot date — already
      computed for the "not enough history yet" checks. Cheap trust
      signal, and doubles as a visible canary if
      `.github/workflows/snapshot-history.yml` ever silently stops
      running.
- [ ] Missing-snapshot / failed-ingestion alerting. `snapshot-history.yml`
      and `discovery.yml` run on GitHub's best-effort daily cron, which is
      known to skip runs under load; today a failure or a skipped day only
      shows up as a red X in the Actions tab, if anyone happens to look. A
      check that fails loudly when a domain's latest history entry is
      older than ~36h would catch a silent gap before Rising mode quietly
      goes stale.
- [ ] Backfill tooling. There's no supported way to rebuild
      `data/history/*.json` if the velocity formula (`scripts/velocity.mjs`)
      or its 120-day pruning window changes — today that means either
      living with the old computation until enough fresh data
      re-accumulates, or hand-editing history files. A script to
      recompute/re-derive stored history would make future formula
      changes safe to ship.
- [ ] Restructure `data/` from one JSON file per domain to one JSON file
      per project, with domains reduced to thin pointer lists. From a
      2026-08-31 brainstorm: today `data/<slug>.json` inlines full project
      metadata per domain (1.3k-1.6k lines each) and
      `data/history/<slug>.json` inlines per-project star history per
      domain (2.2k-5.5k lines each) — and worse than just size, a project
      curated into more than one domain (7 today, e.g. `apache/airflow`
      in both `automation.json` and `databases.json`) gets an independent
      copy of its own metadata and history per domain, which can
      silently drift out of sync since `enrich-domain.mjs` only updates
      whichever domain file it's pointed at. Proposed shape:
      `data/domains/<slug>.json` (identity + `{id, path}` pointers only —
      `path` stays domain-scoped since it's genuinely different per
      domain for a shared project), `data/projects/<owner>/<repo>.json`
      (curated metadata), and `data/history/<owner>/<repo>.json` (daily
      snapshots) — keeps the existing curated-vs-bot-written split the
      repo already relies on, just re-keyed by project instead of by
      domain. Touches `generate.mjs` Pass 1, `enrich-domain.mjs`,
      `snapshot-history.mjs`, the discover/classify/apply-discoveries
      pipeline, `CONTRIBUTING.md`, and `pr-check.yml`'s validation —
      architectural scope, needs a written design doc before
      implementation. Side finding from the same brainstorm: flat
      per-project files would also make the data cleanly queryable with
      off-the-shelf SQL-on-JSON tooling (e.g. DuckDB's official Node
      binding, which reads the file tree directly) for ad hoc maintainer
      analysis, at no new cost to the production build — evaluated and
      explicitly not worth pursuing: replacing the production
      calculation scripts (`velocity.mjs`/`leaderboard.mjs`/
      `group-growth.mjs`/`tag-growth.mjs`) with SQL (not broken, data
      volume doesn't need it), or TinyDB in either its Python or npm
      form (neither is SQL, and both own their storage rather than
      querying these files in place).

## Measurement

- [ ] Add privacy-friendly analytics (e.g. Plausible, GoatCounter, Umami —
      no cookie banner needed). There's currently no visibility into which
      domains/projects get traffic, which would inform curation priorities
      and show whether Rising mode is actually being used.

## Content & growth

- [ ] Cross-link related/similar projects from the detail panel to
      increase session depth (currently just GitHub link + homepage).
- [ ] Publish an explicit roadmap or a pinned "vote on the next domain"
      issue — the README has said "More domains are on the way" for a
      while with no visible mechanism for visitors to weigh in.
- [ ] Consider documenting the per-domain JSON as a stable public data
      endpoint, so others can build embeddable badges/dashboards off it —
      free distribution for the project.

## Shipped

- [x] On-site project submission, with the human review queue removed
      entirely — data contribution is now hands-off end to end, so
      contributor effort (`CONTRIBUTING.md`) can point entirely at
      platform/code work instead. A `/submit/` page
      (`renderSubmitPage`/`app/shared/submit-project.js`) lets any
      visitor nominate a repo without a GitHub account beyond opening the
      prefilled issue it builds (the `suggest-a-project.md` template from
      the earlier version of this item); `scripts/process-submission.mjs`
      + `.github/workflows/submit-project.yml` then classify and commit
      or reject it within minutes and always close the issue — no
      maintainer step, whether the issue came from the form or was typed
      by hand. The scheduled discovery job
      (`scripts/discover-projects.mjs`) dropped its daily cap and
      confidence gate to match: `scripts/apply-discoveries.mjs`'s
      `routeCandidate` now auto-commits every `fits: true` verdict
      (auto-creating a suggested new category rather than parking it),
      and the daily "🔍 Discovery review" issue is gone — a classification
      or enrichment failure is simply retried on a later run instead of
      waiting on a human.
      _Done 2026-08-31._
- [x] Project comparison view (`/compare/?id=…`), picking 2-4 projects and
      seeing stars, 7/30/90d growth, momentum signal, forks, and open
      issues side by side, plus a cross-page "+ Compare" cart
      (`app/shared/compare-cart.js`) that persists the selection across
      navigation via localStorage. Flagged by an external reviewer as the
      feature most likely to turn a 30-second visit into a 10-minute one —
      see `docs/superpowers/specs/2026-08-30-compare-view-design.md`.
      _Done 2026-08-31: `scripts/compare-index.mjs` builds the static
      `dist/compare-index.json` artifact, `app/shared/compare.js` renders
      the table client-side, and the compare-cart wiring adds "+ Compare"
      toggle buttons to the detail panel, project pages, and Rising/tag
      rows. Extending the toggle to every remaining list surface and
      reworking the table into a true row-aligned layout are now tracked
      as `MVP.md` items #3 and #7._
- [x] Track more than stars per daily snapshot. `buildSnapshotEntry`
      (`scripts/snapshot-history.mjs`) now records `forks` and
      `openIssues` (plus GitHub's own `name`/`description`, for drift
      detection) alongside `stars` in every day's snapshot, riding along
      free on the same GitHub API response `enrich-domain.mjs` already
      fetches.
      _Done 2026-08-30. Currently consumed by the compare view only
      (`compare.js`'s "Forks"/"Open issues" rows); surfacing the same
      stats on the individual project page is `MVP.md` item #8, and
      feeding them into the momentum signal itself (a spike corroborated
      by fork/contributor movement) remains the separate "statistical
      anomaly detection" item below, still unbuilt._
- [x] Rewrite the homepage hero around outcome/discovery, paired with a
      "today's signals" teaser (biggest single-project mover, a heating-up
      ecosystem, a small high-acceleration project to watch) ahead of the
      domain grid.
      _Done 2026-08-28: `hero-tagline` in `scripts/render-page.mjs` now reads
      "What's taking off in open source — spotted by growth, not just
      stars." The old "Rising this week" teaser on the landing page is
      replaced by a new `todays-signals` module (`renderTodaysSignals`) fed
      by a new `scripts/todays-signals.mjs` (`pickTodaysSignals`), reusing
      an uncapped global leaderboard pool (`computeVelocity`/
      `computeLeaderboard` now also carry each candidate's `currentStars`)
      plus the same domain-growth ranking the map cards already use. Each
      of the three cards is omitted individually when no candidate
      qualifies, and the whole section is omitted when none do. Domain
      pages keep their own per-domain teaser unchanged._
- [x] Reflect zoom depth and mode/window in the URL. `zoomTo`/
      `zoomToOthers` in `app/shared/treemap.js` never call
      `history.pushState` — so a zoomed-in view can't be shared or
      bookmarked, and on mobile the back button/gesture exits the page
      instead of stepping back one zoom level the way users expect. Fixed
      via a new `app/shared/zoom-url.js` (pure encode/decode of
      `{mode, window, idPath}` to/from a query string) wired into
      `mountTreemap`'s new `initialState`/`onNavigate` options and the
      domain page's inline script: a zoom pushes a history entry (so back
      steps back one level), a mode/window switch replaces it in place
      (visible in the URL but not its own undo step), and zooming into a
      synthetic "N more" bucket touches neither, since its membership
      isn't stable across modes.
- [x] Point leaderboard rows at the internal project page instead of the
      project's external homepage. `renderRisingRow` in
      `scripts/render-page.mjs` links each row's name to `entry.link`
      (sourced from `project.link`) — on the homepage teaser and the full
      `/rising/` page alike — so the site's most shareable surface sends
      visitors straight off-domain before they ever see the description,
      star-history sparkline, domain rank, or tags that live on
      `/projects/<id>/` (and in the treemap's detail panel,
      `app/shared/detail-panel.js`). Link the name internally and let that
      page be the one that sends people onward to GitHub/homepage.
- [x] Give category and leaf boxes a distinct visual affordance.
      `.treemap-category` and `.treemap-leaf` (`app/shared/treemap.css`)
      share the same chrome and both use `cursor: pointer` — a category
      click zooms in, a leaf click opens the detail panel, and nothing
      distinguishes the two until you click. Fixed with a `▸` corner
      glyph on `.treemap-category` (via `::after`, colored with
      `--color-accent` so it follows light/dark mode) to signal
      "zooms into more" before the first click.
- [x] Give every project a canonical, shareable page with always-on
      momentum stats and a "why is this rising" narrative line
      (sustained-vs-spike, growth relative to its category). This directly
      answers the review's points on "Why is this rising?" and on
      individual project pages as a growth/SEO engine. Designed and
      substantially implemented: `scripts/signal.mjs` (`explainSignal`) +
      `renderProjectPage` in `scripts/render-page.mjs` — see
      `docs/superpowers/specs/2026-08-27-project-pages-and-momentum-signal-design.md`.
- [x] Tags as a first-class discovery/browsing dimension — "click a tag,
      see rising projects across every category it touches," not just a
      rigid domain/category tree. Already shipped: `scripts/tag-growth.mjs`
      (`computeTopTags`/`computeRisingTags`), the global `/tags/` index,
      per-tag pages (`renderTagPage`), and clickable tag chips on the
      project detail panel — see
      `docs/superpowers/specs/2026-08-26-top-and-rising-tags-design.md`.
- [x] Keyboard/screen-reader accessibility on treemap boxes
      (`app/shared/treemap.js`). Only the header/close button have
      `aria-label`/focus handling today — the individual boxes have no
      `role`, `tabindex`, or `keydown` handling, so the site's core
      interaction is mouse/touch-only. Add `role="button"`, `tabindex`,
      Enter/Space activation, and a per-box `aria-label` (project name +
      size context).
      _Done 2026-08-20: category/leaf/Others boxes are now
      `role="button"`, tab-reachable, Enter/Space-activatable, with an
      `aria-label` carrying the size context (star count in Popular mode,
      growth stat in Rising mode) that's otherwise conveyed only by the
      box's visual area — plus a visible `:focus-visible` ring. Verified
      with a headless-browser pass: Tab reaches a box, Enter zooms a
      category in, a leaf's label reads e.g. "TensorFlow, 196,997 stars"._
- [x] Add JSON-LD structured data (e.g. `WebSite` + `ItemList`) per domain
      page, built from the same flat project JSON `generate.mjs` already
      reads — may help projects surface in "awesome list" style search
      queries.
      _Done 2026-08-19: `WebSite` on the landing page, `ItemList` (one
      `ListItem` per linked project) on each domain page; omitted from
      embed pages, consistent with their sitemap exclusion._
- [x] Add `<link rel="canonical">` to the shell, alongside the `og:url`
      value each `render*Page` function already computes.
      _Done 2026-08-19: reuses `{{OG_URL}}`, which already points embed
      pages at their non-embed counterpart, so it doubles as
      duplicate-content de-dup for free._
- [x] Add a favicon. `app/` currently has no `favicon.ico`/`icon.svg` and
      the template has no `<link rel="icon">` — every tab/bookmark shows
      the generic browser icon.
      _Done 2026-08-19: `app/favicon.svg`, copied to `dist/` by
      `generate.mjs`._
- [x] Add a plain `<meta name="description">` to the page shell
      (`app/index.html.template`) — today only `og:description` /
      `twitter:description` are set, and some crawlers and search snippets
      still key off the plain tag. `renderShell` in `scripts/render-page.mjs`
      already computes an `ogDescription` per page; thread it through.
      _Done 2026-08-19: reuses the existing `{{OG_DESCRIPTION}}` value._
