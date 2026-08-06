# Static Site Generation, Flat Data Model & GitHub Pages — Design

Status: Approved
Date: 2026-08-06

## Context

`techmap` is a treemap visualizer for curated open-source tech. Spec #1
(just completed:
[2026-08-06-data-model-migration-and-landing-page-design.md](2026-08-06-data-model-migration-and-landing-page-design.md))
migrated each domain's data to a two-file model (`data.json` tree +
`tools.json` leaf records) served as static JSON, fetched and hydrated
client-side by a single-page app on Firebase Hosting.

This spec **supersedes that rendering and hosting architecture**. It moves
to a flat, one-file-per-domain data model; static HTML generation via a
hand-rolled Node script run by a GitHub Action; and deployment to GitHub
Pages — while preserving the existing interactive treemap (zoom,
breadcrumb, detail panel) via client-side hydration on top of the
generated HTML, not by discarding it.

Motivations, established through discussion:

- **Minimal owner maintenance / community self-service** (the standing
  project goal recorded in spec #1's context) benefits from build-time
  automation — this spec's generator is what a future automation spec
  (weekly star refresh, PR auto-merge) builds on top of, rather than
  duplicating.
- **Shareability**: real per-domain HTML pages with Open Graph tags, so a
  shared link gets a proper preview instead of a blank SPA shell.
- **Embeddability**: a domain's interactive map can be `<iframe>`'d into
  another site.
- **Simplification**: flatten the per-domain schema (tools tagged with a
  category `path` instead of nested category objects), drop the `image`
  field (derived from the tool's id via a filesystem lookup at generation
  time), and drop the `maps.json` registry (the generator globs
  `data/*.json` directly instead of reading a hand-maintained index).

This spec sits between spec #1 (done) and the two sub-projects sketched in
spec #1's context: community contribution automation, and new-domain
content seeding. Both should build on this spec's generator rather than
duplicate it — e.g. a weekly star-refresh bot becomes "update `weight`
fields in `data/*.json`, then let the existing deploy workflow regenerate
and republish," not a separate pipeline.

## Goals

- Replace `public/data/<slug>/{data.json,tools.json}` with one flat,
  hand-authored file per domain, `data/<slug>.json` — tools listed flat,
  each tagged with a `path` (its place in the category tree).
- Drop the `image` field — logos resolved by tool id from a per-domain
  images folder at generation time, any file format.
- Drop `maps.json` — the generator discovers domains by globbing
  `data/*.json`.
- Add a hand-rolled Node static-site generator (`scripts/generate.mjs`)
  producing real, crawlable, Open-Graph-tagged HTML per domain, with the
  tree data inlined so each generated page is self-contained.
- Preserve the existing interactive treemap (zoom, breadcrumb, detail
  panel) — generated HTML is a pre-rendered shell that client-side JS
  hydrates into the same interactive experience as today.
- Add an embeddable-widget mode: `dist/embed/<slug>/index.html`, a
  chrome-free version of a domain's map suitable for `<iframe>` embedding
  elsewhere.
- Move hosting from Firebase Hosting to GitHub Pages, deployed by a GitHub
  Action that runs the generator and publishes its output on every push to
  `main` (plus manual dispatch).
- Remove `public/`, `firebase.json`, and `.firebaserc` from the repository
  entirely — the served site becomes a CI-time build artifact (`dist/`),
  never committed.

## Non-goals

- Per-tool embeddable cards/badges — only whole-domain-map embedding is in
  scope.
- The weekly GitHub-star-refresh bot, PR validation/auto-merge pipeline,
  and issue-form-to-PR flow — still the deferred community-automation
  spec, which should build on this spec's generator.
- New domain content — still the deferred content-seeding spec.
- Custom per-domain OG preview images — a single default banner image is
  used for every domain's `og:image` for now.
- Any account/backend system (unchanged standing constraint for the whole
  project).

## Architecture

### Data schema

One file per domain, e.g. `data/data-science.json`:

```json
{
  "slug": "data-science",
  "name": "Best Data Science Open Source Tools",
  "description": "Machine learning, deep learning, NLP, computer vision, and more.",
  "tools": [
    {
      "id": "scikit-learn",
      "path": ["Classic Machine Learning"],
      "name": "SciKit Learn",
      "gh": "https://github.com/scikit-learn/scikit-learn",
      "link": "https://scikit-learn.org/stable/",
      "desc": "Machine Learning in Python",
      "weight": 58000
    }
  ]
}
```

- `id` and `path` are required. `id` is the join key for images and (per
  the deferred automation spec) GitHub-API lookups. `path` is an array of
  category names from root to the tool — a single-level category is a
  one-element array, e.g. `["Classic Machine Learning"]`; deeper nesting
  is a longer array.
- `name`, `desc`, `link`, `weight` may be omitted. At generation time,
  `name` defaults to the tool's `id` and `desc` defaults to an empty
  string; `weight` defaults to `1` (unchanged fallback behavior from spec
  #1). A future automation spec may fill blank `name`/`desc`/`weight` from
  the GitHub API instead — this spec only defines the offline fallback.
- No `image` field. Logos live at `data/<slug>/images/<id>.<ext>` (any
  extension) and are resolved by matching `<id>.*` in that folder at
  generation time.
- The category tree is reconstructed by grouping tools on shared `path`
  prefixes, in first-appearance order — there is no separate
  category-object schema to hand-maintain.
- `data/maps.json` does not exist; the generator discovers every domain by
  globbing `data/*.json`.

### Generator (`scripts/generate.mjs`)

Pure helper modules (unit-tested, no I/O):

- **`scripts/build-tree.mjs`** — `buildTree(tools)`: groups a flat tool
  array by shared `path` prefixes into the nested `{id, name, children}`
  tree shape the existing renderer (`layout.js`, `treemap.js`) already
  expects. Replaces spec #1's `hydrateTree` (which merged two files) with
  a function that groups one flat list instead. Throws on structurally
  invalid input (a tool whose `path` is not an array).
- **`scripts/resolve-image.mjs`** — `resolveImage(id, filenames)`: given a
  tool id and a list of filenames (e.g. from `fs.readdirSync`), returns
  the matching filename (`<id>.<ext>`) or `null` if none exists. Pure —
  takes a filename list as a parameter rather than reading the filesystem
  itself, so it's testable without I/O. Matches on the full id followed by
  a dot, so `id: "ray"` does not false-match `raytracer.png`.
- **`scripts/render-page.mjs`** — builds the HTML string for a domain page
  or its embed variant: injects `<title>`, Open Graph and Twitter Card
  meta tags, and the tree data (as a JSON blob) into the shared
  `app/index.html.template`.

Orchestration (`scripts/generate.mjs`, thin I/O glue, not unit-tested —
verified manually per the Testing section):

1. Glob `data/*.json`. For each domain file:
   a. Read and validate its `tools` array (every entry has `id` and an
      array `path`) — fail the build with a clear file+id error if not.
   b. List `data/<slug>/images/`, resolve each tool's image via
      `resolveImage`.
   c. Build the nested tree via `buildTree`.
   d. Render `dist/<slug>/index.html` via `render-page.mjs` (full page:
      OG/Twitter tags, inlined tree JSON, links to the shared JS/CSS).
   e. Render `dist/embed/<slug>/index.html` (chrome-free variant, same
      inlined tree JSON).
   f. Copy each resolved image into `dist/<slug>/images/`.
2. Render `dist/index.html` (landing page) listing every discovered
   domain, reading `slug`/`name`/`description` directly from each domain
   file.
3. Copy `app/shared/*` and `app/vendor/*` into `dist/shared/` and
   `dist/vendor/` once — unchanged files, a straight copy, no bundling.

### Client-side rendering (mostly unchanged)

`layout.js`, `treemap.js`, and `detail-panel.js` carry over from spec #1
unchanged — they already consume a nested tree and don't care how it was
produced. The generated page's own small inline `<script type="module">`
(replacing `main.js`) reads the inlined
`<script type="application/json" id="map-data">` blob instead of fetching
`data.json`/`tools.json` over the network, then calls `mountTreemap`
exactly as before. `hydrate.js` and `router.js` are removed — there is no
client-side merge step left to do (the generator already produced the
full tree) and no slug-from-path parsing needed (every domain is a real
path the host serves directly).

### File layout

```
/data/
  data-science.json
  data-science/images/<id>.<ext>
/app/
  index.html.template          # shared HTML shell used by render-page.mjs
  shared/
    treemap.js / layout.js / detail-panel.js / treemap.css   # unchanged from spec #1
  vendor/
    d3-hierarchy/                # unchanged
/scripts/
  generate.mjs                   # orchestrator
  build-tree.mjs                  # NEW — pure, replaces hydrate.js
  resolve-image.mjs               # NEW — pure
  render-page.mjs                 # NEW — HTML templating
/.github/workflows/
  deploy.yml                     # NEW — generate + publish to GitHub Pages
/test/
  build-tree.test.js              # NEW — replaces hydrate.test.js
  resolve-image.test.js           # NEW
  layout.test.js                  # unchanged
/dist/                            # generated, gitignored, never committed
```

Removed entirely: `public/` (including `main.js`, `hydrate.js`,
`router.js`), `test/hydrate.test.js`, `test/router.test.js`,
`firebase.json`, `.firebaserc`, `public/data/maps.json`.

## Error handling

- A domain file with a structurally invalid tool (missing `id`, or `path`
  not an array) fails the generator build for that domain with a clear
  error naming the file and tool id — this is caught in CI and blocks
  deploy, rather than publishing broken output.
- A tool with no matching image file renders with the existing
  initial-letter fallback (unchanged visual behavior from spec #1), now
  decided at generation time — the generator already knows whether an
  image was found, rather than relying on an `<img onerror>` handler for a
  missing file.
- The generator failing entirely (e.g. malformed JSON in a domain file)
  fails the GitHub Action step, so a broken `data/*.json` change can't
  reach production. This spec's baseline is "the build fails loudly" —
  the richer offline validation (schema linting before merge) is still
  the deferred community-automation spec's job.

## Testing

- `build-tree.test.js`: flat single-level tools group correctly under
  their category; multi-level `path`s nest correctly; a tool with a
  non-array `path` throws; an empty `tools` array produces a childless
  root.
- `resolve-image.test.js`: matches `<id>.png` from a filename list;
  matches `<id>.jpg` (different extension in the same list); returns
  `null` when no match exists; does not false-match a different id that
  shares a prefix (e.g. `id: "ray"` must not match `raytracer.png`).
- `layout.test.js` carries over unchanged — the nested tree shape it
  operates on is unaffected by this schema change.
- `render-page.mjs` has no unit test — its output is HTML/meta-tag
  templating, verified by the manual OG/Twitter-tag check below rather
  than an automated assertion, consistent with this project's existing
  convention of manually verifying rendered/DOM-adjacent output.
- Manual verification: run `node scripts/generate.mjs && npx serve dist`,
  confirm each domain's page loads and is fully interactive (zoom,
  breadcrumb, detail panel — the same checks as spec #1's end-to-end
  verification task), confirm `/embed/<slug>/` renders chrome-free and
  works inside an actual test `<iframe>`, confirm Open Graph/Twitter tags
  are present (`curl | grep`), confirm a mixed-extension image set
  (`.png`, `.jpg`, `.jfif`) all resolve correctly.

## Deployment

- `.github/workflows/deploy.yml`: triggers on push to `main` and manual
  `workflow_dispatch`. Steps: checkout, Node setup, `node
  scripts/generate.mjs`, `actions/upload-pages-artifact` on `dist/`,
  `actions/deploy-pages`. Requires `pages: write` and `id-token: write`
  workflow permissions.
- One-time manual step, not automatable in a workflow file: set the
  repository's Pages source to "GitHub Actions" in repo settings.
- Local development: `node scripts/generate.mjs && npx serve dist` —
  serves the exact production output. There is no rewrite-config
  divergence between dev and production to work around, since every
  domain is a real file path on disk after generation (unlike spec #1's
  SPA, which needed the Firebase emulator specifically to test
  clean-URL routing).

## Migration

- A one-off script (scratchpad-only, not committed — same pattern as spec
  #1's data migration task) reads each existing
  `public/data/<slug>/{data.json,tools.json}` pair, flattens the tree into
  a `tools` array with `path` derived from each leaf's ancestor chain in
  the old tree, drops the `image` field, and writes `data/<slug>.json`. It
  also moves `public/data/<slug>/images/*` to `data/<slug>/images/*`
  unchanged — existing mixed extensions (`.png`, `.jpg`, `.jfif`) are
  fine, no re-encoding needed.
- After migration and verification, `public/`, `firebase.json`,
  `.firebaserc`, and the two now-superseded test files
  (`test/hydrate.test.js`, `test/router.test.js`) are deleted;
  `README.md` and `package.json` scripts are rewritten for the
  generate/serve flow.
