# awesomemap: wire the "Suggest a project" issue trigger (Part B, gap 3)

## Context

[Part A](2026-09-04-awesomemap-data-api-wiring-design.md) split this
repo's data pipeline into the private `awesomemap-data` repo and pointed
the build at its read API, disabling four now-redundant/broken workflows
in the process. It explicitly deferred **gap 3** — closing the loop on
"Suggest a project" issues — because it needs a cross-repo auth design
Part A's changes didn't produce on their own.

`awesomemap-data` already has a fully working, HTTP-wired
`scripts/process-submission.mjs`: given `--issue <n>` (and an optional
`--repo owner/repo`), it parses the issue body, checks the quality bar,
classifies it against a domain via OpenRouter, writes the result to D1
via `data-store.mjs`, and always closes the issue with an explanatory
comment via `gh`. Its own file comment says the only missing piece is a
trigger: *"this still assumes `gh` is authenticated against whichever
repo the issue lives in... the real trigger for this script will
eventually live [in the frontend repo] too (or call across repos with a
`--repo` flag / a token scoped to both)."*

This repo's [submit-project.yml](../../.github/workflows/submit-project.yml)
is the disabled placeholder from Part A: `workflow_dispatch`-only, gated
on the `discovery` label, and its last step still tries to `git commit`
`data/domains`/`data/projects` — a directory that no longer exists here.

## Goals

- Opening a `discovery`-labeled "Suggest a project" issue in this repo
  automatically runs `awesomemap-data`'s `process-submission.mjs` against
  it, end to end, no maintainer step — restoring the behavior the issue
  template already promises contributors.
- No new standing write-access grant beyond what's strictly needed: the
  issue close/comment must not require a new PAT.
- Manual re-processing (e.g. a submission that failed transiently) stays
  possible via `workflow_dispatch`.

## Non-goals

- Any change inside `awesomemap-data` (`process-submission.mjs` is used
  as-is).
- Re-enabling `discovery.yml`, `snapshot-history.yml`, or
  `social-digest.yml` — out of scope for this gap; `discovery.yml` and
  `snapshot-history.yml` are fully superseded by `awesomemap-data`'s own
  copies (verified running on schedule), and `social-digest.yml`'s
  gap (README-risers sync) was retired, not deferred, per
  `awesomemap-data`'s README.
- A public data-correction path (Part A's "Risks" note) — separate gap.

## Design

### Approach: run inside this repo's own workflow, not `repository_dispatch`

Two ways to close this gap were on the table:

1. **`repository_dispatch`**: this repo's workflow fires a
   `repository_dispatch` event at `awesomemap-data`, which runs the
   script itself. Needs *two* new PATs: one scoped to `awesomemap-data`
   (`actions:write`) stored here to fire the dispatch, and one scoped to
   *this* repo (`issues:write`) stored in `awesomemap-data` so the script
   can close/comment on an issue that isn't its own repo.
2. **Checkout-and-run** (chosen): this repo's workflow checks out
   `awesomemap-data` into a subdirectory and runs the script from there,
   passing `--repo haggaishachar/awesomemap` explicitly.

(2) needs only *one* new credential — a **read-only** PAT to check out
`awesomemap-data`'s source — because the workflow is already running in
`awesomemap`'s own Actions context: its default `GITHUB_TOKEN` is already
correctly scoped for `gh issue close`/`comment` on this repo, regardless
of which subdirectory the Node process's cwd happens to be. The script's
existing `--repo` flag exists for exactly this case. No write-scoped PAT
crosses a repo boundary in either direction.

### 1. New secret: `AWESOMEMAP_DATA_CHECKOUT_TOKEN`

A fine-grained PAT, repository `awesomemap-data`, permission **Contents:
Read-only**. Created manually (GitHub doesn't expose PAT creation over
`gh`/API), stored as a secret on `awesomemap` only. Used solely by
`actions/checkout`'s `token:` input — never passed to any script.

### 2. Existing secret gap: `AWESOMEMAP_DATA_INTERNAL_TOKEN`

Part A's spec assumed this was already set on `awesomemap` (it isn't —
only `awesomemap-data` has it; `deploy.yml` never noticed because
`AWESOMEMAP_DATA_API_URL`'s absence is masked by `data-store.mjs`'s
hardcoded default, and `AWESOMEMAP_DATA_INTERNAL_TOKEN` is only read by
write calls deploy.yml never makes). `process-submission.mjs`'s
`saveProjectEntity`/`saveDomain` calls need it, with no safe fallback.

Rather than surface the existing value, rotate it: generate a new random
token, `wrangler secret put INTERNAL_API_TOKEN` on the deployed Worker,
then `gh secret set AWESOMEMAP_DATA_INTERNAL_TOKEN` with the same value on
both repos. Same mechanism, new value, no functional change to the Worker.
`AWESOMEMAP_DATA_API_URL` gets added to `awesomemap` too, for parity with
`deploy.yml`'s existing pattern (explicit over relying on the hardcoded
default).

### 3. `submit-project.yml` rewrite

```yaml
on:
  issues:
    types: [opened]
  workflow_dispatch:
    inputs:
      issue:
        description: "Issue number to (re)process"
        required: true

concurrency:
  group: submission-${{ github.event.inputs.issue || github.event.issue.number }}
  cancel-in-progress: false

jobs:
  process:
    if: github.event_name == 'workflow_dispatch' || contains(github.event.issue.labels.*.name, 'discovery')
    runs-on: ubuntu-latest
    permissions:
      issues: write
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      AWESOMEMAP_DATA_API_URL: ${{ secrets.AWESOMEMAP_DATA_API_URL }}
      AWESOMEMAP_DATA_INTERNAL_TOKEN: ${{ secrets.AWESOMEMAP_DATA_INTERNAL_TOKEN }}
    steps:
      - uses: actions/checkout@v4
        with:
          repository: haggaishachar/awesomemap-data
          token: ${{ secrets.AWESOMEMAP_DATA_CHECKOUT_TOKEN }}
          path: awesomemap-data
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - working-directory: awesomemap-data
        run: npm ci
      - working-directory: awesomemap-data
        run: |
          node scripts/process-submission.mjs \
            --issue "${{ github.event.inputs.issue || github.event.issue.number }}" \
            --repo haggaishachar/awesomemap
```

No commit/push step — `process-submission.mjs` persists via HTTP, nothing
lands on disk to commit. `permissions: issues: write` is added explicitly
(the repo default may be read-only); `contents: write` is dropped
entirely — this job never touches this repo's git history.

`concurrency.group` covers both trigger shapes so two runs against the
same issue (e.g. an accidental double-dispatch) can't race.

## Testing

- Manually `gh workflow run submit-project.yml -f issue=58` against the
  real open submission (haggaishachar/awesomemap#58) once deployed;
  confirm the run succeeds, the issue is closed with an outcome comment,
  and (if committed) the project is queryable from the live API
  (`GET /projects` on the deployed Worker).
- Open a fresh throwaway `discovery`-labeled test issue and confirm the
  `issues: opened` trigger fires without manual dispatch, end to end.
- Confirm a non-`discovery` issue (e.g. this repo's own bug-report
  template) opened during testing does *not* trigger the job.

## Risks / follow-ups

- The checkout PAT is a standing credential with read access to a private
  repo's full source (not just `scripts/`) — accepted for now given fine-
  grained PATs can't scope below "whole repo," same tradeoff Part A's
  design implicitly accepts for `AWESOMEMAP_DATA_INTERNAL_TOKEN`.
- `npm ci` installs `awesomemap-data`'s full `devDependencies` (`wrangler`)
  just to run one script — slower than strictly necessary but not worth a
  second package.json for one workflow.
