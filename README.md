# techmap

Turns a tree of categories and tools into an interactive, zoomable
treemap.

## Develop

    npm install
    npm run dev

Opens a static server at http://localhost:5000. Note: this doesn't apply
the clean-URL rewrite (see below) — use the Firebase emulator for that.

## Test

    npm test

## Preview with clean URLs (matches production routing)

    npx firebase-tools emulators:start --only hosting

## Deploy

Replace the placeholder project ID in `.firebaserc` with your real Firebase
project ID, then:

    npx firebase-tools deploy --only hosting

## Adding a new map

Add a folder under `public/data/<slug>/` containing:

- `data.json` — the category tree (see `public/data/data-science/data.json`
  for the schema). Each node has an `id`, `name`, and `children`; leaf
  entries in `children` are bare tool-id strings that key into `tools.json`.
- `tools.json` — the leaf records (see
  `public/data/data-science/tools.json` for the shape), mapping each tool
  id referenced in `data.json` to an object with `gh`, `image`, `link`,
  `name`, `desc`, and `weight`.
- an `images/` folder holding the image files referenced by each tool's
  `image` field.

Then register the map by adding an entry (`slug`, `name`, `description`) to
`public/data/maps.json`, which powers the landing page's map index.
