# Data Model Migration & Landing Page — Design

Status: Approved
Date: 2026-08-06

## Context

`techmap` currently renders one hand-curated dataset (`data-science/data.json`)
as a zoomable treemap (see
[2026-08-05-treemap-rendering-core-design.md](2026-08-05-treemap-rendering-core-design.md)).
That spec sketched a follow-on sequence built around user accounts and a
multi-tenant hosting platform. That direction has been superseded: the goal
is now **reach and popularity via an open-source, community-curated,
multi-domain map**, maintained through GitHub (pull requests and issue
forms) rather than accounts or a backend — the owner wants minimal ongoing
maintenance, with the community sustaining content quality on its own.

That goal decomposes into three sub-projects, each with its own spec, plan,
and implementation pass:

1. **This spec** — migrate the per-domain data schema to a two-file model,
   add a map registry, and redesign the landing page. This is the
   foundation the other two build on.
2. **Community contribution automation** (future spec) — validation + CI,
   a weekly GitHub-star refresh bot, an auto-merge pipeline for safe
   additions, and an issue-form → auto-PR flow so non-technical
   contributors can add tools without touching git or JSON.
3. **Content seeding** (future spec) — four new domain maps (Web
   Development, DevOps & Infrastructure, Security, Mobile Development),
   ~12–15 open-source tools each with real logos.

### Decisions already made for spec #2 (recorded here so they aren't lost)

- Auto-merge applies only to a narrow "safe diff shape": one new entry in
  `tools.json`, one new id added to an *existing* category's `children` in
  `data.json`, and optionally one new image file. Any other diff (edits,
  deletions, new categories/domains, non-content files) always requires
  manual review.
- Auto-merge additionally requires the added repo to have **≥1000 GitHub
  stars** (exact number tunable) at PR time. Below that, the PR is still
  valid — it just falls to manual review instead of being auto-merged or
  rejected.
- `npm run validate` is a pure, offline schema check (no network calls),
  runnable both in a sandboxed `pull_request` CI workflow and locally by
  contributors.
- The network-touching eligibility check (is the repo real/public/
  not archived/not a duplicate, does the diff match the safe shape) runs in
  a separate, minimal `pull_request_target` workflow that never executes
  code from the PR branch — it only inspects the diff and calls the GitHub
  API, then merges once the sandboxed CI check has also passed. This split
  avoids the "pwn request" class of Actions vulnerability.
- A weekly scheduled workflow refreshes every tool's `weight` (GitHub
  stars), always overwriting it; it fills `name`/`desc`/`link` only if a
  contributor left them blank, and commits directly to `main`. A `gh` URL
  that 404s or gets renamed is flagged (opens an issue) rather than
  silently kept.
- A GitHub issue form ("➕ Add a tool") lets non-technical contributors
  submit via a form instead of git; a workflow turns a submission into the
  same safe-shape PR, which then flows through the same auto-merge check.

## Goals

- Migrate each domain's data from one file of embedded objects to two
  files: `data.json` (pure category tree + tool-id references) and
  `tools.json` (leaf tool records) — the foundation spec #2's automation
  and spec #3's content depend on.
- Add `public/data/maps.json` as the single source of truth for which
  domains exist.
- Redesign the landing page (currently a hardcoded single link) to list
  every registered domain from that registry.
- Preserve the existing rendering engine (`layout.js`, `treemap.js`,
  `detail-panel.js`) unchanged — only the loading/hydration step changes.

## Non-goals

- No new domain content in this spec — `data-science` is migrated in
  place; new domains are spec #3.
- No CI, validation, or bot automation in this spec — that's spec #2.
- No accounts, backend, login, or in-site submission UI (ruled out for the
  whole project).
- No auto-derivation of logos from any source.

## Architecture

### Data schema

`public/data/<slug>/data.json` — pure category tree. A `children` entry
that's a plain string is a tool-id reference (leaf); an object is a nested
category. (`name1` is renamed to `name` while the schema is already
changing.)

```json
{
  "id": "root", "name": "Best Data Science Open Source Tools",
  "children": [
    { "id": "ML", "name": "Classic Machine Learning",
      "children": ["scikit-learn", "xgboost", "accord-net"] }
  ]
}
```

`public/data/<slug>/tools.json` — dictionary keyed by tool id:

```json
{
  "scikit-learn": {
    "gh": "https://github.com/scikit-learn/scikit-learn",
    "image": "scikitlearn.png",
    "link": "https://scikit-learn.org/stable/",
    "name": "SciKit Learn",
    "desc": "Machine Learning in Python",
    "weight": 58000
  }
}
```

`gh` is the only field a spec-#2 auto-merged contribution must supply —
`name`/`desc`/`link`/`weight` can be filled in later by the refresh bot.
For this spec, all fields are populated by hand-migrating the existing
`data-science` data (no bot exists yet).

### Loader / hydration

- `main.js`'s `loadMap(slug)` fetches both `/data/<slug>/data.json` and
  `/data/<slug>/tools.json`.
- A new pure function `hydrateTree(tree, tools)`, in a new module
  `shared/hydrate.js`, walks the tree and replaces every string leaf-id
  with `{ id, ...tools[id] }`. A referenced id missing from `tools.json`
  is treated as malformed data (see Error handling).
- The hydrated tree is passed to `mountTreemap` exactly as today —
  `layout.js`, `treemap.js`, and `detail-panel.js` are unchanged, aside
  from updating their `name1` field references to `name`.

### Registry & landing page

- New `public/data/maps.json`:
  `[{ "slug": "data-science", "name": "...", "description": "..." }]`.
- `main.js`'s `renderMapIndex()` fetches `maps.json` and renders a card per
  entry (name, description, link to `/slug`) instead of the current
  hardcoded `<ul><li>`.
- `treemap.css` gains styling for the new landing grid.

### File layout changes

```
/public/
  data/
    maps.json                  # NEW — registry
    data-science/
      data.json                # CHANGED — tree only, string leaf refs, name1->name
      tools.json                # NEW — leaf records
      images/                   # unchanged
  shared/
    hydrate.js                  # NEW — tree + tools -> hydrated tree
    main.js                     # CHANGED — fetch both files, hydrate, registry-based index
    treemap.js                  # CHANGED — name1 -> name (box label)
    detail-panel.js             # CHANGED — name1 -> name (title, image alt)
    layout.js / router.js       # unchanged
```

## Error handling

- Registry (`maps.json`) fetch fails or is malformed → landing page shows
  an error state instead of a blank page (mirrors the existing "map not
  found" pattern).
- A `data.json` leaf id missing from `tools.json` → treated like today's
  malformed-`data.json` case: console error plus the "map not found"-style
  fallback.
- Existing per-leaf fallbacks (missing `weight` defaults to `1`,
  missing/broken image falls back to an initial-letter placeholder) are
  unchanged.

## Testing

- New unit tests (`node:test`) for `hydrate.js`: merges a tree + tools
  dictionary correctly; category nodes pass through unchanged; a leaf id
  missing from `tools.json` is detectable by the caller.
- Existing `layout.test.js` and `router.test.js` are unaffected by this
  change (neither touches `name1`/tool-object shape) and continue to pass
  unmodified.
- Manual verification: after migrating `data-science`'s data, `npm run
  dev` and confirm the site renders identically to before the migration
  (same boxes, sizes, labels, images, zoom, detail panel).

## Deployment

- No change to `firebase.json` or `.firebaserc` — same static-hosting
  setup as today.
