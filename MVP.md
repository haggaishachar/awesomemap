# MVP

The current, curated slice of [`product.md`](product.md)'s backlog: the
three items judged most important to ship next, in priority order. Unlike
`product.md` — an ongoing, non-committal idea list — this file is a
commitment-shaped shortlist; when an item ships, move it to `product.md`'s
Shipped section and drop it from here rather than checking it off in place.

1. **[ ] Signals per domain.** The global "This week's signals" module
   only runs on the homepage — each domain page keeps its own plain
   Rising-rows teaser instead. Reuse the same mover/heating-up/watch
   selection (`pickThisWeeksSignals`) scoped to one domain's projects, so
   every domain page gets its own signals module, not just a generic
   leaderboard slice.

2. **[ ] Top rising domains.** `generate.mjs` already computes each
   domain's own growth per window (`domainGrowthByWindow`, via
   `computeGroupGrowth`) and threads it onto that domain's landing-page
   card, and `group-growth.mjs`'s `rankGroups` already ranks tags and
   categories the same way — but nothing ranks domains against each other.
   Add a domain-level leaderboard ("which ecosystem is growing fastest this
   week") using math the codebase already has, surfaced on the homepage
   alongside "This week's signals," so a visitor can answer "what's hot"
   at the ecosystem level, not just the single-project level.

3. **[ ] Project page: add forks, issues, etc.** `buildSnapshotEntry`
   (`scripts/snapshot-history.mjs`) already captures `forks` and
   `openIssues` in every daily snapshot, and the compare view already
   displays them (`compare.js`'s "Forks"/"Open issues" stat rows) — but
   `renderProjectPage` itself, the canonical per-project page, still only
   shows star count and momentum chips. Add the same forks/open-issues
   stats (and any other already-captured-but-unsurfaced fields, e.g.
   GitHub's own name/description for drift detection) to the project page,
   reusing `compare-format.js`'s `formatCount` rather than a new formatter.
