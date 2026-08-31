# MVP

The current, curated slice of [`product.md`](product.md)'s backlog: the
seven items judged most important to ship next, in priority order. Unlike
`product.md` — an ongoing, non-committal idea list — this file is a
commitment-shaped shortlist; when an item ships, move it to `product.md`'s
Shipped section and drop it from here rather than checking it off in place.

1. **[ ] Data structure refactor.** The project/domain shape (`data/<slug>.json`:
   `slug`/`name`/`shortName`/`description`/`projects[]`) predates tags,
   project pages, compare, and today's-signals, and each of those landed as
   its own build-time projection (`tag-growth.mjs`, `compare-index.mjs`,
   `todays-signals.mjs`) rather than a schema change — so the same project's
   data is re-derived into a slightly different shape by every consumer, and
   `data/history/<slug>.json` entries (`buildSnapshotEntry` in
   `scripts/snapshot-history.mjs`) have grown ad hoc alongside them (stars →
   stars+forks+openIssues+name+desc, with no versioning). Foundation for the
   rest of this list, especially #5 and #7, which need domain- and
   project-level stats read consistently rather than re-assembled per script.
   Needs its own design pass to settle the target shape before migrating.

2. **[ ] "+ Compare" everywhere.** Already on the detail panel
   (`app/shared/detail-panel.js`), project pages (`renderProjectPage`),
   Rising rows (`renderRisingRow` — homepage teaser, `/rising/`, each
   domain's own teaser), and tag-page rows (`renderTagProjectRow`). Still
   missing from the today's-signals cards (`renderSignalCard` /
   `renderTodaysSignals`, no `compare-toggle`) and from the new top-tags and
   top-rising-domains surfaces (#6). Close the gap so every place a project
   id appears in list form carries the same toggle, wired to the existing
   `compare-cart` localStorage logic.

3. **[ ] Rename to "This week's signals."** The homepage module is
   currently headed "Today's signals" (`renderTodaysSignals`,
   `.todays-signals-heading`, fed by `scripts/todays-signals.mjs`), but its
   own card copy already says "this week" (e.g. "+643 stars (+0.4%) this
   week"), and the README's equivalent feature is literally titled "This
   week's biggest risers." Rename the heading, CSS classes, and module
   (`todays-signals.mjs` → `this-weeks-signals.mjs`, `pickTodaysSignals` →
   `pickThisWeeksSignals`) for one consistent name, as the first slice of
   `product.md`'s broader "site-wide copy pass toward heat/momentum
   language" item.

4. **[ ] Signals per domain.** The global "This week's signals" module
   (#3) only runs on the homepage — each domain page keeps its own plain
   Rising-rows teaser instead. Reuse the same mover/heating-up/watch
   selection (`pickTodaysSignals`, to become `pickThisWeeksSignals`) scoped
   to one domain's projects, so every domain page gets its own signals
   module, not just a generic leaderboard slice.

5. **[ ] Top rising domains.** `generate.mjs` already computes each
   domain's own growth per window (`domainGrowthByWindow`, via
   `computeGroupGrowth`) and threads it onto that domain's landing-page
   card, and `group-growth.mjs`'s `rankGroups` already ranks tags and
   categories the same way — but nothing ranks domains against each other.
   Add a domain-level leaderboard ("which ecosystem is growing fastest this
   week") using math the codebase already has, surfaced on the homepage
   alongside "This week's signals," so a visitor can answer "what's hot"
   at the ecosystem level, not just the single-project level.

6. **[ ] Improve compare side-by-side.** `app/shared/compare.js` currently
   renders one full vertical stat card per project, laid out as sibling
   columns that each repeat the same Stars/7d/30d/90d-growth/Forks/Open-issues
   sequence — not a genuine row-aligned table, so there's no way to scan
   "who's winning on 30d growth" across projects at a glance, and no
   highlighting of the best value per stat. Restructure into a real
   row-per-stat grid with a winner highlight, and tighten the layout for
   narrow viewports, building on the compare-index.json/compare-cart
   plumbing that already shipped.

7. **[ ] Project page: add forks, issues, etc.** `buildSnapshotEntry`
   (`scripts/snapshot-history.mjs`) already captures `forks` and
   `openIssues` in every daily snapshot, and the compare view already
   displays them (`compare.js`'s "Forks"/"Open issues" stat rows) — but
   `renderProjectPage` itself, the canonical per-project page, still only
   shows star count and momentum chips. Add the same forks/open-issues
   stats (and any other already-captured-but-unsurfaced fields, e.g.
   GitHub's own name/description for drift detection) to the project page,
   reusing `compare-format.js`'s `formatCount` rather than a new formatter.
