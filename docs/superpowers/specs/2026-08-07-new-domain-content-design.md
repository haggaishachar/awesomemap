# New domain content: Web Dev, DevOps & Infra, Security, Mobile Dev

## Goal

Add four new domain maps to techmap, matching the existing `data-science`
map's density and structure:

- `web-dev` — "Best Web Development Open Source Tools"
- `devops-infra` — "Best DevOps & Infrastructure Open Source Tools"
- `security` — "Best Security Open Source Tools"
- `mobile-dev` — "Best Mobile Development Open Source Tools"

No code changes are required — the generator already auto-discovers every
`data/*.json` file and renders it as a domain page + landing page card.
This is purely a content addition.

## Scope per domain

- ~8-10 categories, ~4-6 tools per category (~40-50 tools per domain,
  ~160-200 tools total across the four domains).
- Only real, notable open-source projects with a public GitHub repo —
  no invented or placeholder tools.
- Each tool entry follows the existing schema (`id`, `path`, `name`,
  `gh`, `link`, `desc`, `weight`), per the README's "Adding a new map"
  section.

## Data fields

- `id`: unique within the domain, matches the tool's common name (same
  convention as `data-science.json`, e.g. `scikit-learn`, `PyTorch`).
- `path`: single-element array with the category name (flat one level
  deep, matching `data-science.json`'s pattern — no sub-categories).
- `name`, `desc`, `link`, `gh`: as documented in the README.
- `weight`: the tool's real, current GitHub star count (integer), fetched
  live via `gh api repos/<owner>/<repo>` — not estimated or guessed.

## Logo sourcing

Logos are optional (`app/shared/treemap.js` and `detail-panel.js` already
render a fallback icon when a leaf has no `image`), so this is
best-effort, not required for every tool.

For each tool with a `gh` repo, probe a fixed list of common in-repo logo
paths using `gh api repos/<owner>/<repo>/contents/<path>` (the
authenticated `gh` CLI gives 5000 req/hr, enough headroom for ~200 tools
× ~10 candidate paths + 1 star-count call each):

```
logo.svg, logo.png
assets/logo.svg, assets/logo.png
docs/logo.svg, docs/logo.png
docs/assets/logo.svg, docs/assets/logo.png
.github/logo.svg, .github/logo.png
brand/logo.svg, brand/logo.png
```

First match found is downloaded as-is to
`data/<slug>/images/<id>.<ext>` (extension taken from the source file).
If no candidate path exists in the repo, the tool ships with no image
and the generator's fallback icon applies — no substitute icon is
sourced from anywhere else (e.g. icon packs, favicon services), since
the requirement is specifically "from the repo, if it exists."

## Process

1. **Curate** — one agent per domain, run in parallel, each producing a
   draft tool list (id/name/category path/gh/link/desc, no
   weight/image yet) for its domain, following the scope above.
2. **Enrich** — a script (`gh api`-based) walks every curated tool and
   fills in `weight` (live star count) and attempts logo download per
   the rules above.
3. **Assemble & validate** — write the four `data/<slug>.json` files,
   run `npm run generate` and `npm test`, and spot-check the generated
   `dist/` pages for the new domains.

## Review checkpoint

One review at the end: all four domains fully drafted, enriched, and
built before the user reviews the finished JSON and generated site.

## Out of scope

- Sub-categories / nested `path` depth beyond one level (matching
  `data-science.json`'s existing flat style).
- Logos sourced from anywhere other than the tool's own GitHub repo.
- Any change to generator code, schema, or landing page — existing
  auto-discovery already covers new `data/*.json` files.
