# README Rewrite & Landing Page Hero — Design

Status: Approved
Date: 2026-08-07

## Context

`techmap`'s README currently opens with install/run/deploy instructions —
appropriate for a contributor guide, not for a project that now has a live,
public site (`https://haggaishachar.github.io/techmap/`). The landing page
(`renderLandingPage` in `scripts/render-page.mjs`) is a bare title + card
grid with no hero, minimal styling (`app/shared/treemap.css`), and no dark
mode.

This spec covers two independent, small changes bundled together because
they're both "first impression" polish done at the same time:

1. Split the README into a showcase (awesome-list style, points at the live
   site) and a separate `CONTRIBUTING.md` (the existing dev/deploy/schema
   content, preserved verbatim).
2. Add a hero section to the landing page and refresh the shared stylesheet
   (palette-consistent modernization + dark mode), since `treemap.css` is
   shared by the landing page and every domain page.

## Goals

- A visitor landing on GitHub sees what techmap *is* and a link to try it,
  not npm commands.
- A contributor can still find the exact same dev/deploy/schema docs, just
  in `CONTRIBUTING.md` instead of `README.md`.
- The landing page has a hero: title, tagline, and a decorative
  nested-rectangles motif (CSS only, no image asset) before the map grid.
- The shared stylesheet keeps its current blue (`#2b5fad`) accent but gets
  modernized spacing/type/shadows and a `prefers-color-scheme: dark`
  variant, applying consistently across landing, domain, and detail-panel
  UI since they share one CSS file.

## Non-goals

- No new build tooling, no image assets, no JS behavior changes to
  `treemap.js`/`detail-panel.js`/`layout.js`.
- No changes to the data schema, generator logic, or deploy workflow.
- No license section in the README (no `LICENSE` file exists in the repo;
  adding one is out of scope).
- Not reworking the treemap visualization itself (box rendering, zoom,
  detail panel content) — only page chrome (hero, cards, palette).

## Design

### `CONTRIBUTING.md` (new)

Everything currently under the README's "Develop", "Test", "Deploy", and
"Adding a new map" headings moves here **verbatim** (npm scripts,
`BASE_PATH`/`SITE_URL` explanation, the tool JSON schema example, the
image-matching note). One new intro line: "Local development and
contribution guide for techmap." No content is reworded — only relocated —
so none of the documented env var / schema behavior can drift from what's
actually true.

### `README.md` (rewritten)

Awesome-list-style showcase, no install/run instructions:

1. Title + one-line tagline.
2. A prominent link to the live site: `https://haggaishachar.github.io/techmap/`.
3. Short pitch (2–3 sentences): interactive, zoomable treemaps of
   open-source tool ecosystems; box size reflects adoption; click any tool
   for a detail panel with description + GitHub/site links.
4. **Maps** section: a table of every live map, one row per `data/*.json`
   file — name, description, link (`<site>/<slug>/`). Today this is one row
   (Data Science); the table format is chosen because it scales as more
   domains ship (Web Dev, DevOps, Security, Mobile are already spec'd in
   `docs/superpowers/specs/2026-08-07-new-domain-content-design.md`).
   This table is maintained by hand alongside `data/*.json`, same as any
   awesome-list — no new tooling to keep it in sync.
5. **How it works**: 3 short bullets — curated & weighted dataset,
   drill-down zoom, click-through detail panel.
6. **Contributing**: one line linking to `CONTRIBUTING.md`.

### Landing page hero

`renderLandingPage` in `scripts/render-page.mjs` gains a `<header
class="hero">` above the existing `.map-grid`:

- `<h1>` techmap
- One-line tagline (reusing the same copy as the README pitch, kept short)
- A decorative motif: a handful of absolutely-positioned `<div>`s (or one
  inline `<svg>`) rendering overlapping rounded rectangles in accent-color
  tints behind/around the hero text — evokes the treemap visualization
  itself. Pure CSS/markup, no image asset, so it costs nothing to load and
  needs no new build step.

The existing map-card grid is unchanged in structure, only restyled (see
below).

### Stylesheet refresh (`app/shared/treemap.css`)

- Introduce CSS custom properties on `:root` for the palette (background,
  surface, text, accent = `#2b5fad`, shadow), so light/dark variants are a
  matter of overriding the variables, not duplicating rules.
- Modernize spacing and type scale on the landing page elements (`.hero`,
  `.map-index`, `.map-grid`, `.map-card`) and give cards a hover-lift
  (`transform` + shadow transition).
- Add `@media (prefers-color-scheme: dark)` overrides for the custom
  properties. Because `treemap.css` is shared by domain pages and the
  detail panel too, dark mode applies there as well — that's intentional
  (one shared file, one consistent theme) and not a scope increase, since
  it's the same variables driving every surface.
- No changes to treemap box/zoom/breadcrumb *layout* rules (`.treemap-box`,
  `.treemap-category`, `.treemap-leaf`, positioning) — only their colors
  move to the new custom properties so dark mode reaches them too.

## Testing

- `npm test` and `npm run generate` still pass (existing generator tests
  don't assert on exact HTML/CSS content, only structure/schema, per
  current test suite — verify this holds after the edit).
- Manual check: `npm run dev`, view landing page and one domain page in
  both light and dark OS theme.
