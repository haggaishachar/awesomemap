## What kind of change is this?

- [ ] Add project(s) to an existing map
- [ ] Fix/update existing project data (name, description, link, category)
- [ ] Add a brand-new domain map
- [ ] Something else (code, docs, CI)

If this adds a **brand-new domain**, please link the domain-proposal issue
this follows up on: `Closes #`
(see [`New domain proposal`](../ISSUE_TEMPLATE/new-domain-proposal.md) —
new domains go through a quick scope check before a PR, existing-domain
additions don't need one).

## Checklist

- [ ] `npm run generate` builds locally with no errors
- [ ] `npm test` passes locally
- [ ] Every added/edited project has `id` (as `owner/repo` for a GitHub
      project) and `path` (its category breadcrumb)
- [ ] I did not hand-set `weight` or `image` for a GitHub project — those
      are filled in automatically by `enrich-domain.mjs` after merge
- [ ] No duplicate project inside the same map

## Description

<!-- What's being added/changed and why. A couple of sentences is plenty. -->
