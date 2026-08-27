# Product improvement backlog

Ongoing, non-urgent improvement ideas for awesomemap.dev, gathered from a
review of the live site and generator source on 2026-08-19. Not a
commitment or a schedule — a running list to pull from.

## Flow & conversion

Added from a user-perspective walkthrough of the live site and source on
2026-08-28, focused on where visitors get stuck or leave earlier than they
need to.

- [ ] Point leaderboard rows at the internal project page instead of the
      project's external homepage. `renderRisingRow` in
      `scripts/render-page.mjs` links each row's name to `entry.link`
      (sourced from `project.link`) — on the homepage teaser and the full
      `/rising/` page alike — so the site's most shareable surface sends
      visitors straight off-domain before they ever see the description,
      star-history sparkline, domain rank, or tags that live on
      `/projects/<id>/` (and in the treemap's detail panel,
      `app/shared/detail-panel.js`). Link the name internally and let that
      page be the one that sends people onward to GitHub/homepage.
- [ ] Give category and leaf boxes a distinct visual affordance.
      `.treemap-category` and `.treemap-leaf` (`app/shared/treemap.css`)
      share the same chrome and both use `cursor: pointer` — a category
      click zooms in, a leaf click opens the detail panel, and nothing
      distinguishes the two until you click. A corner chevron/folder glyph
      on categories (or a subtly different border) would remove the
      guesswork on a visitor's first interaction.
- [ ] Reflect zoom depth and mode/window in the URL. `zoomTo`/
      `zoomToOthers` in `app/shared/treemap.js` never call
      `history.pushState` — so a zoomed-in view can't be shared or
      bookmarked, and on mobile the back button/gesture exits the page
      instead of stepping back one zoom level the way users expect.
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
- [ ] Explain Popular/Rising and box sizing on pages reached without going
      through the homepage first. The tagline on `/` (in
      `scripts/render-page.mjs`) is the only place that spells out what the
      mode toggle and box size represent — a domain page or `/rising/`
      reached via search or a shared link has no equivalent, just the mode
      bar itself. A small "?" affordance near the mode bar would cover
      that entry path.

## SEO

- [x] Add a plain `<meta name="description">` to the page shell
      (`app/index.html.template`) — today only `og:description` /
      `twitter:description` are set, and some crawlers and search snippets
      still key off the plain tag. `renderShell` in `scripts/render-page.mjs`
      already computes an `ogDescription` per page; thread it through.
      _Done 2026-08-19: reuses the existing `{{OG_DESCRIPTION}}` value._
- [x] Add a favicon. `app/` currently has no `favicon.ico`/`icon.svg` and
      the template has no `<link rel="icon">` — every tab/bookmark shows
      the generic browser icon.
      _Done 2026-08-19: `app/favicon.svg`, copied to `dist/` by
      `generate.mjs`._
- [x] Add `<link rel="canonical">` to the shell, alongside the `og:url`
      value each `render*Page` function already computes.
      _Done 2026-08-19: reuses `{{OG_URL}}`, which already points embed
      pages at their non-embed counterpart, so it doubles as
      duplicate-content de-dup for free._
- [x] Add JSON-LD structured data (e.g. `WebSite` + `ItemList`) per domain
      page, built from the same flat project JSON `generate.mjs` already
      reads — may help projects surface in "awesome list" style search
      queries.
      _Done 2026-08-19: `WebSite` on the landing page, `ItemList` (one
      `ListItem` per linked project) on each domain page; omitted from
      embed pages, consistent with their sitemap exclusion._

## Usability

- [ ] Site search. The whole site is browse-only today — finding a known
      project means guessing which domain/category it's filed under. Since
      each domain's data is static JSON at build time, a small client-side
      fuzzy-search index (built at generate time, searched in-browser)
      would let visitors jump straight to a project by name.
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

## Measurement

- [ ] Add privacy-friendly analytics (e.g. Plausible, GoatCounter, Umami —
      no cookie banner needed). There's currently no visibility into which
      domains/projects get traffic, which would inform curation priorities
      and show whether Rising mode is actually being used.

## Content & growth

- [ ] Publish an explicit roadmap or a pinned "vote on the next domain"
      issue — the README has said "More domains are on the way" for a
      while with no visible mechanism for visitors to weigh in.
- [ ] Cross-link related/similar projects from the detail panel to
      increase session depth (currently just GitHub link + homepage).
- [ ] Consider documenting the per-domain JSON as a stable public data
      endpoint, so others can build embeddable badges/dashboards off it —
      free distribution for the project.
