# Product improvement backlog

Ongoing, non-urgent improvement ideas for awesomemap.dev, gathered from a
review of the live site and generator source on 2026-08-19. Not a
commitment or a schedule — a running list to pull from.

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
- [ ] Keyboard/screen-reader accessibility on treemap boxes
      (`app/shared/treemap.js`). Only the header/close button have
      `aria-label`/focus handling today — the individual boxes have no
      `role`, `tabindex`, or `keydown` handling, so the site's core
      interaction is mouse/touch-only. Add `role="button"`, `tabindex`,
      Enter/Space activation, and a per-box `aria-label` (project name +
      size context).

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
