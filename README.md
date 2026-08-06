# techmap

Turns a `data.json` tree of categories and tools into an interactive,
zoomable treemap.

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

Add a folder under `public/data/<slug>/` with a `data.json` (see
`public/data/data-science/data.json` for the schema) and an `images/`
folder, then link to it from `public/shared/main.js`'s map index.
