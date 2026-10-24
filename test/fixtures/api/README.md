# awesomemap-data API fixture

Saved responses for every awesomemap-data API route the site build reads,
one file per route (`<route>.json`):

- `domains.json` — `GET /domains`
- `projects.json` — `GET /projects`
- `leaderboard-snapshots.json` — `GET /leaderboard-snapshots`
- `leaderboard-snapshots/<isoWeek>.json` — `GET /leaderboard-snapshots/:isoWeek`

Used when `AWESOMEMAP_DATA_FIXTURE_DIR` points here (see
`scripts/data-store.mjs`): `pr-check.yml` builds this way, and so can you,
offline:

    AWESOMEMAP_DATA_FIXTURE_DIR=test/fixtures/api node scripts/generate.mjs

The data is sample data (two domains, seven projects), not a copy of
production. It was written through the awesomemap-data Worker's own write
routes into a local D1 and read back through its read routes, so the shapes
match what the live API returns. Project history and event dates are
shifted at load time so the newest history date is today.

When the API adds a field the build depends on, add it here too, or the PR
check won't exercise it.
