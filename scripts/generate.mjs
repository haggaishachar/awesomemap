#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, cpSync } from "node:fs";
import { buildTree } from "./build-tree.mjs";
import { renderDomainPage, renderLandingPage, renderRisingPage, renderTagsIndexPage, renderTagPage, renderProjectPage, renderComparePage, renderSearchPage, renderSubmitPage, renderMethodologyPage, renderContactPage, tagSlug } from "./render-page.mjs";
import { buildCompareRecord, buildCompareIndex } from "./compare-index.mjs";
import { explainSignal } from "./signal.mjs";
import { sortedHistory } from "../app/shared/star-history.js";
import { sortedEvents } from "./project-events.mjs";
import { computeProjectSizing, findInvalidSizes, RISING_WINDOWS_DAYS } from "./velocity.mjs";
import { computeLeaderboard } from "./leaderboard.mjs";
import { computeGroupGrowth, rankGroups } from "./group-growth.mjs";
import { buildTagGroups, computeTopTags, computeRisingTags } from "./tag-growth.mjs";
import { pickThisWeeksSignals } from "./this-weeks-signals.mjs";
import { buildSitemap, buildRobots } from "./seo.mjs";
import { loadAllDomains, loadAllProjectEntities, joinDomainProjects } from "./data-store.mjs";

const DIST_DIR = "dist";
const APP_DIR = "app";
const LEADERBOARD_LIMIT = 20;
const TEASER_LIMIT = 5;
const TAG_WIDGET_LIMIT = 8;
const TAGS_INDEX_LIMIT = 30;
const TEASER_WINDOW_DAYS = RISING_WINDOWS_DAYS[0];

// The window the landing page's domain-momentum line and each domain page's
// category momentum report. Deliberately the same as the teaser window, so
// every headline number on a page describes the same period.
const MOMENTUM_WINDOW_DAYS = TEASER_WINDOW_DAYS;

// Empty string defaults to serving from the domain root, matching local
// `npm run dev`/`npm run generate` usage. Production deploys (GitHub Pages
// project sites are served under `/<repo>/`, not the domain root) set this
// via the BASE_PATH env var — see .github/workflows/deploy.yml.
const BASE_PATH = process.env.BASE_PATH ?? "";

// Absolute site origin, used to build absolute URLs (og:image, og:url) that
// link-preview scrapers require. When unset, falls back to a relative path
// — not spec-compliant, but better than failing the build outright.
const SITE_URL = process.env.SITE_URL ?? "";

// When set, writes a GitHub Pages CNAME file into the build output so the
// custom domain survives every deploy (Actions-based Pages publishing does
// not persist it any other way — see .github/workflows/deploy.yml).
const CNAME = process.env.CNAME ?? "";

const DEFAULT_OG_IMAGE = `${SITE_URL}${BASE_PATH}/og-default.png`;

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

// Pass 1: load every domain + project entity (data-store.mjs), validate,
// join, and size every domain's projects. Collects the full set of domains
// before any page is rendered — the Rising page's global leaderboard (Pass
// 2) spans every domain, so it can't be computed incrementally inside a
// single per-domain loop the way sizing can.
const rawDomains = loadAllDomains();
const projectEntities = loadAllProjectEntities();

const parsedDomains = [];
const seenSlugs = new Set();

for (const domain of rawDomains) {
  const domainPath = `data/domains/${domain.slug}.json`;
  const slug = domain.slug;

  if (typeof slug !== "string" || slug.length === 0 || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`${domainPath}: "slug" must be a non-empty string matching /^[a-z0-9-]+$/, got ${JSON.stringify(slug)}`);
  }
  if (seenSlugs.has(slug)) {
    throw new Error(`${domainPath}: duplicate slug "${slug}"`);
  }
  seenSlugs.add(slug);

  if (!Array.isArray(domain.projects)) {
    throw new Error(`${domainPath}: "projects" must be an array`);
  }
  for (const project of domain.projects) {
    if (!project.id || !Array.isArray(project.path)) {
      throw new Error(`${domainPath}: project missing "id" or non-array "path": ${JSON.stringify(project)}`);
    }
  }

  const joined = joinDomainProjects(domain, projectEntities); // throws on a dangling id reference (no data/projects/ entity file)

  const sizedProjects = joined.map((project) => {
    const { sizes, hasEnoughHistory, growth } = computeProjectSizing(project, project.history ?? []);
    return { ...project, sizes, hasEnoughHistory, growth };
  });

  const invalidSizeIds = findInvalidSizes(sizedProjects);
  if (invalidSizeIds.length > 0) {
    throw new Error(`${domainPath}: invalid computed size(s) for project id(s): ${invalidSizeIds.join(", ")}`);
  }

  // Project `image` values (when present) are already direct URLs into the
  // project's source repo — set by `enrich-domain.mjs` — so no local
  // resolution or copying is needed here.
  parsedDomains.push({ ...domain, projects: sizedProjects });
}

// Pass 2: compute every window's leaderboard (global + one per domain) from
// the complete set of domains and history — this powers both the dedicated
// /rising/ page and every teaser below.
const leaderboardsByWindow = {};
for (const windowDays of RISING_WINDOWS_DAYS) {
  const byScope = {
    global: computeLeaderboard(parsedDomains, { scope: "global", windowDays, limit: LEADERBOARD_LIMIT }),
  };
  for (const domain of parsedDomains) {
    byScope[domain.slug] = computeLeaderboard(parsedDomains, { scope: domain.slug, windowDays, limit: LEADERBOARD_LIMIT });
  }
  leaderboardsByWindow[windowDays] = byScope;
}

// Pass 2b: aggregate growth at the two grouping levels above a single project
// — the whole domain, and each category within a domain. This is the axis
// GitHub Trending doesn't have: a leaderboard answers "which project is
// rising", these answer "which ecosystem, and where inside it".
const domainGrowthByWindow = {};
for (const windowDays of RISING_WINDOWS_DAYS) {
  const bySlug = {};
  for (const domain of parsedDomains) {
    bySlug[domain.slug] = computeGroupGrowth(domain.projects, windowDays);
  }
  domainGrowthByWindow[windowDays] = bySlug;
}

// Categories are grouped by `path[0]`, the top-level category, which is
// uniform across domains — only artificial-intelligence nests deeper, and its
// `path[0]` is still its top-level category.
const categoryGrowthBySlug = {};
for (const domain of parsedDomains) {
  const byCategory = new Map();
  for (const project of domain.projects) {
    const category = project.path[0];
    if (category === undefined) continue;
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(project);
  }
  const groups = [...byCategory].map(([category, projects]) => ({
    key: category,
    growth: computeGroupGrowth(projects, MOMENTUM_WINDOW_DAYS),
  }));
  categoryGrowthBySlug[domain.slug] = rankGroups(groups);
}

// Precomputes each project's "unexpected breakout" number — how many times
// faster it grew (7d) than its own category did over the same window —
// reusing signal.mjs's explainSignal, the exact math a project's own detail
// page already surfaces (Pass 4, below). Doing it here (right after
// categoryGrowthBySlug, its only input besides each project's own growth)
// lets the this-week's-signals pools below join it on by id, instead of
// duplicating the category-relative math. A project curated into more than
// one domain is attributed to whichever domain's category classification
// this loop visits last — the same last-write-wins rule allProjectsWithDomain
// uses below, so a project's breakout number always matches the category its
// own /projects/ page names.
const breakoutInfoById = new Map();
for (const domain of parsedDomains) {
  for (const project of domain.projects) {
    const categoryEntry = categoryGrowthBySlug[domain.slug]?.find((category) => category.key === project.path[0]);
    const { relativeMultiple } = explainSignal({
      growthByWindow: project.growth,
      hasEnoughHistory: project.hasEnoughHistory,
      categoryGrowth7d: categoryEntry?.growth,
      categoryName: categoryEntry?.key,
    });
    if (relativeMultiple !== null) breakoutInfoById.set(project.id, { relativeMultiple, categoryName: categoryEntry.key });
  }
}

/** Joins each candidate's precomputed breakout number (if any) onto a computeLeaderboard pool, for pickThisWeeksSignals' `breakout` pick. */
function withBreakoutInfo(pool) {
  return pool.map((candidate) => ({ ...candidate, ...breakoutInfoById.get(candidate.id) }));
}

// Pass 2c: group projects by shared tag (GitHub topics), then rank those
// groups by popularity and by growth — the same "how did this slice of the
// ecosystem move" question Pass 2b already answers for categories and
// domains, just grouped a third way. `tag-growth.mjs` owns every
// filtering/ranking rule; this pass only calls it and stores results for
// Pass 3's domain widget and the /tags/ pages built after the domain loop.
const domainTopTagsBySlug = {};
const domainRisingTagsBySlug = {};
for (const domain of parsedDomains) {
  const tagGroups = buildTagGroups(domain.projects);
  domainTopTagsBySlug[domain.slug] = computeTopTags(tagGroups, { limit: TAG_WIDGET_LIMIT });
  domainRisingTagsBySlug[domain.slug] = computeRisingTags(tagGroups, MOMENTUM_WINDOW_DAYS, { limit: TAG_WIDGET_LIMIT });
}

// Global tag groups additionally carry each project's originating domain
// (short name + slug) — a project's own record doesn't know that on its
// own, and a per-tag page needs it since tags cross domains.
// Dedupe by id: a project curated into more than one domain would otherwise
// be double-counted in every global tag group it lands in — fabricating
// tag pages that only clear MIN_PROJECTS_PER_TAG via the duplicate, and
// doubling totalStars/growth on every group containing one. Each project
// entity has exactly one `history` regardless of which domain(s) reference
// it (data-store.mjs's join), so unlike before the refactor there's no
// separate history map to merge here — last-write-wins only applies to the
// (identical) entity fields themselves on the rare id collision.
const allProjectsWithDomain = [
  ...new Map(
    parsedDomains.flatMap((domain) =>
      domain.projects.map((project) => [project.id, { ...project, domainSlug: domain.slug, domainShort: domain.shortName ?? domain.name }])
    )
  ).values(),
];
const globalTagGroups = buildTagGroups(allProjectsWithDomain);
const globalTopTags = computeTopTags(globalTagGroups, { limit: TAGS_INDEX_LIMIT });
const globalRisingTagsByWindow = {};
for (const windowDays of RISING_WINDOWS_DAYS) {
  globalRisingTagsByWindow[windowDays] = computeRisingTags(globalTagGroups, windowDays, { limit: TAGS_INDEX_LIMIT });
}

// Pass 3: render every domain's full page, embed page, and history.json,
// now that its teaser (the top of its own 7-day leaderboard) is available.
const domains = [];

for (const domain of parsedDomains) {
  const { slug } = domain;

  // Each project's rank on its own domain's leaderboard, per window — the
  // "#3 rising in AI" context the detail panel shows. Stored per window (not
  // just the headline one) so it stays correct when the visitor switches
  // windows, matching the shape of the `growth` object already on each leaf.
  const rankedProjects = domain.projects.map((project) => {
    const domainRank = {};
    for (const windowDays of RISING_WINDOWS_DAYS) {
      const entry = leaderboardsByWindow[windowDays][slug].find((row) => row.id === project.id);
      domainRank[`rising${windowDays}`] = entry ? entry.rank : null;
    }
    // `history` is dropped here rather than carried onto the leaf — it's a
    // per-day series that can run to ~120 entries, and this object is what
    // buildTree embeds directly into the domain page's `<script
    // id="map-data">` payload (see render-page.mjs). It ships separately as
    // this domain's history.json (below), fetched lazily by the detail
    // panel instead of bloating every page load.
    const { history, ...rest } = project;
    // The short domain name rides along on the leaf so the detail panel can
    // name the domain a project ranks in without needing the domain record.
    return { ...rest, domainRank, domainShort: domain.shortName ?? domain.name };
  });

  const tree = buildTree(rankedProjects, { id: slug, name: domain.name });
  const teaser = leaderboardsByWindow[TEASER_WINDOW_DAYS][slug].slice(0, TEASER_LIMIT);

  mkdirSync(`${DIST_DIR}/${slug}`, { recursive: true });
  mkdirSync(`${DIST_DIR}/embed/${slug}`, { recursive: true });

  // Ships each project's own raw history (already loaded in Pass 1) to the
  // client, keyed by id — the same shape a pre-refactor
  // data/history/<slug>.json had — so the detail panel can fetch it on
  // demand to draw a leaf's star-history sparkline, unchanged.
  const historyBlob = {};
  for (const project of domain.projects) historyBlob[project.id] = project.history ?? [];
  writeFileSync(`${DIST_DIR}/${slug}/history.json`, JSON.stringify(historyBlob));

  writeFileSync(
    `${DIST_DIR}/${slug}/index.html`,
    renderDomainPage(domain, tree, {
      embed: false,
      defaultOgImage: DEFAULT_OG_IMAGE,
      siteUrl: SITE_URL,
      basePath: BASE_PATH,
      teaser,
      categoryGrowth: categoryGrowthBySlug[slug],
      momentumWindowDays: MOMENTUM_WINDOW_DAYS,
      topTags: domainTopTagsBySlug[slug],
      risingTags: domainRisingTagsBySlug[slug],
    })
  );
  writeFileSync(
    `${DIST_DIR}/embed/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: true, defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
  );

  domains.push({
    slug,
    name: domain.name,
    shortName: domain.shortName ?? domain.name,
    description: domain.description ?? "",
    growth: domainGrowthByWindow[MOMENTUM_WINDOW_DAYS][slug],
  });
}

// This-week's-signals' "one to watch" and "heating up" need to compare
// percentDelta across every eligible project, not just the top
// LEADERBOARD_LIMIT by score — a small, fast-growing project can rank well
// outside the top 20 on score (which favors absolute gains) while still
// being the best percentDelta overall. A fresh, uncapped call is cheap at
// this repo's scale and keeps LEADERBOARD_LIMIT (the /rising/ page's own
// per-section row count) untouched.
const globalSignalsPool = withBreakoutInfo(computeLeaderboard(parsedDomains, { scope: "global", windowDays: TEASER_WINDOW_DAYS, limit: Infinity }));
const thisWeeksSignals = pickThisWeeksSignals(globalSignalsPool);

// One more signals pick per domain, scoped the same uncapped way, so the
// homepage's domain filter can swap to "just this domain's mover/heating
// up/one to watch/breakout" without leaving the page — same show/hide-by-scope
// pattern /rising/'s own domain filter already uses.
const thisWeeksSignalsByDomain = {};
for (const domain of parsedDomains) {
  const domainSignalsPool = withBreakoutInfo(computeLeaderboard(parsedDomains, { scope: domain.slug, windowDays: TEASER_WINDOW_DAYS, limit: Infinity }));
  thisWeeksSignalsByDomain[domain.slug] = pickThisWeeksSignals(domainSignalsPool);
}

writeFileSync(
  `${DIST_DIR}/index.html`,
  renderLandingPage(domains, {
    defaultOgImage: DEFAULT_OG_IMAGE,
    siteUrl: SITE_URL,
    basePath: BASE_PATH,
    signals: thisWeeksSignals,
    signalsByDomain: thisWeeksSignalsByDomain,
    momentumWindowDays: MOMENTUM_WINDOW_DAYS,
  })
);

mkdirSync(`${DIST_DIR}/rising`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/rising/index.html`,
  renderRisingPage(domains, leaderboardsByWindow, {
    defaultOgImage: DEFAULT_OG_IMAGE,
    siteUrl: SITE_URL,
    basePath: BASE_PATH,
  })
);

mkdirSync(`${DIST_DIR}/tags`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/tags/index.html`,
  renderTagsIndexPage(globalTopTags, globalRisingTagsByWindow, {
    defaultOgImage: DEFAULT_OG_IMAGE,
    siteUrl: SITE_URL,
    basePath: BASE_PATH,
  })
);

// One page per qualifying global tag (~600 at current data volume),
// sorted by stars descending — the same ranking `computeTopTags` uses,
// just applied here to one tag's own project list rather than across tags.
const tagPagePaths = [];
for (const { tag, projects } of globalTagGroups) {
  const sortedProjects = [...projects].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const tagGrowth = computeGroupGrowth(sortedProjects, MOMENTUM_WINDOW_DAYS);
  const slug = tagSlug(tag);
  mkdirSync(`${DIST_DIR}/tags/${slug}`, { recursive: true });
  writeFileSync(
    `${DIST_DIR}/tags/${slug}/index.html`,
    renderTagPage(tag, sortedProjects, tagGrowth, {
      defaultOgImage: DEFAULT_OG_IMAGE,
      siteUrl: SITE_URL,
      basePath: BASE_PATH,
      windowDays: MOMENTUM_WINDOW_DAYS,
    })
  );
  tagPagePaths.push(`/tags/${slug}/`);
}

// Pass 4: render one canonical page per project — see the project-pages
// design spec. Reuses the same last-write-wins dedup already computed
// above for global tag groups (`allProjectsWithDomain`), so a project
// curated into more than one domain gets exactly one page, attributed to
// whichever domain won that dedup.
mkdirSync(`${DIST_DIR}/projects`, { recursive: true });
const projectPagePaths = [];
const compareRecords = [];
for (const project of allProjectsWithDomain) {
  const idParts = project.id.split("/");
  if (idParts.length !== 2 || idParts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error(`project "${project.id}": "id" must be a GitHub "owner/repo" shorthand to build its /projects/ page`);
  }

  const categoryEntry = categoryGrowthBySlug[project.domainSlug]?.find((category) => category.key === project.path[0]);
  const signal = explainSignal({
    growthByWindow: project.growth,
    hasEnoughHistory: project.hasEnoughHistory,
    categoryGrowth7d: categoryEntry?.growth,
    categoryName: categoryEntry?.key,
  });
  const historySeries = sortedHistory(project.history);
  const eventsSeries = sortedEvents(project.events);
  compareRecords.push(buildCompareRecord(project, { historySeries, signalHeadline: signal.headline }));

  // `allProjectsWithDomain` already carries `domainSlug`/`domainShort`
  // (see the dedup pass above) — `domainShort` is already `domain.shortName
  // ?? domain.name`, so there's no need to look the domain back up in
  // `domains` just to re-derive the same fallback.
  mkdirSync(`${DIST_DIR}/projects/${project.id}`, { recursive: true });
  writeFileSync(
    `${DIST_DIR}/projects/${project.id}/index.html`,
    renderProjectPage(project, {
      domain: { slug: project.domainSlug, shortName: project.domainShort },
      signal,
      historySeries,
      eventsSeries,
      defaultOgImage: DEFAULT_OG_IMAGE,
      siteUrl: SITE_URL,
      basePath: BASE_PATH,
    })
  );
  projectPagePaths.push(`/projects/${project.id}/`);
}

// Cross-domain lookup index for the /compare/ page — one file for the
// whole site, built from data already collected during Pass 4 above (see
// compare-index.mjs).
writeFileSync(`${DIST_DIR}/compare-index.json`, JSON.stringify(buildCompareIndex(compareRecords)));

mkdirSync(`${DIST_DIR}/compare`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/compare/index.html`,
  renderComparePage({ defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
);

mkdirSync(`${DIST_DIR}/search`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/search/index.html`,
  renderSearchPage({ defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
);

mkdirSync(`${DIST_DIR}/submit`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/submit/index.html`,
  renderSubmitPage({ domains, defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
);

mkdirSync(`${DIST_DIR}/methodology`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/methodology/index.html`,
  renderMethodologyPage({ defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
);

mkdirSync(`${DIST_DIR}/contact`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/contact/index.html`,
  renderContactPage({ defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
);

cpSync(`${APP_DIR}/shared`, `${DIST_DIR}/shared`, { recursive: true });
cpSync(`${APP_DIR}/vendor`, `${DIST_DIR}/vendor`, { recursive: true });
copyFileSync(`${APP_DIR}/og-default.png`, `${DIST_DIR}/og-default.png`);
copyFileSync(`${APP_DIR}/favicon.svg`, `${DIST_DIR}/favicon.svg`);
copyFileSync(`${APP_DIR}/favicon-32.png`, `${DIST_DIR}/favicon-32.png`);
copyFileSync(`${APP_DIR}/apple-touch-icon.png`, `${DIST_DIR}/apple-touch-icon.png`);
if (CNAME) writeFileSync(`${DIST_DIR}/CNAME`, `${CNAME}\n`);

const sitemap = buildSitemap(domains.map((d) => d.slug), {
  siteUrl: SITE_URL,
  basePath: BASE_PATH,
  extraPaths: ["/tags/", "/compare/", "/search/", "/submit/", "/methodology/", "/contact/", ...tagPagePaths, ...projectPagePaths],
});
if (sitemap) writeFileSync(`${DIST_DIR}/sitemap.xml`, sitemap);
writeFileSync(`${DIST_DIR}/robots.txt`, buildRobots({ siteUrl: SITE_URL, basePath: BASE_PATH }));

console.log(`Generated ${domains.length} domain(s) into ${DIST_DIR}/`);
