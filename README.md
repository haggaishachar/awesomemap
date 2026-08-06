# techmap

Turns a curated list of open-source tools into an interactive, zoomable
treemap — generated as static HTML and deployed to GitHub Pages.

## Develop

    npm install
    npm run dev

Generates `dist/` from `data/*.json` and serves it at
http://localhost:5000. Re-run `npm run dev` (or just `npm run generate`)
after editing any data file to regenerate.

## Test

    npm test

## Deploy

Deployment is automatic: pushing to `master` triggers
`.github/workflows/deploy.yml`, which runs the generator and publishes
`dist/` to GitHub Pages. The repository's Pages source must be set to
"GitHub Actions" in Settings → Pages (one-time setup, not part of the
workflow file).

## Adding a new map

Add `data/<slug>.json`:

    {
      "slug": "<slug>",
      "name": "Display Name",
      "description": "One-line description shown on the landing page.",
      "tools": [
        {
          "id": "some-tool",
          "path": ["Category Name"],
          "name": "Some Tool",
          "gh": "https://github.com/owner/repo",
          "link": "https://example.com",
          "desc": "What it does.",
          "weight": 1000
        }
      ]
    }

- `id` and `path` are required on every tool. `path` is the breadcrumb of
  category names from root to the tool (a single-level category is a
  one-element array; deeper nesting is a longer array).
- `name`, `desc`, `link`, `gh`, and `weight` may be omitted.
- Add a logo at `data/<slug>/images/<id>.<any extension>` — it's matched
  to the tool by id automatically, whatever format it's in.

Run `npm run generate` to confirm it builds before opening a PR.
