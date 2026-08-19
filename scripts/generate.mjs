#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, cpSync, existsSync } from "node:fs";
import { buildTree } from "./build-tree.mjs";
import { renderDomainPage, renderLandingPage, renderRisingPage } from "./render-page.mjs";
import { computeProjectSizing, findInvalidSizes, RISING_WINDOWS_DAYS } from "./velocity.mjs";
import { computeLeaderboard } from "./leaderboard.mjs";
import { buildSitemap, buildRobots } from "./seo.mjs";

const DATA_DIR = "data";
const DIST_DIR = "dist";
const APP_DIR = "app";
const LEADERBOARD_LIMIT = 20;
const TEASER_LIMIT = 5;
const TEASER_WINDOW_DAYS = RISING_WINDOWS_DAYS[0];

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

const domainFiles = readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"));

// Pass 1: parse, validate, and size every domain. Collects the full set of
// domains + history before any page is rendered — the Rising page's global
// leaderboard (Pass 2) spans every domain, so it can't be computed
// incrementally inside a single per-domain loop the way sizing can.
const parsedDomains = [];
const historyBySlug = {};
const seenSlugs = new Map();

for (const file of domainFiles) {
  const domainPath = `${DATA_DIR}/${file}`;
  let domain;
  try {
    domain = JSON.parse(readFileSync(domainPath, "utf8"));
  } catch (err) {
    throw new Error(`${domainPath}: invalid JSON — ${err.message}`);
  }
  const slug = domain.slug;

  if (typeof slug !== "string" || slug.length === 0 || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`${domainPath}: "slug" must be a non-empty string matching /^[a-z0-9-]+$/, got ${JSON.stringify(slug)}`);
  }
  if (seenSlugs.has(slug)) {
    throw new Error(`${domainPath}: duplicate slug "${slug}" (already used by ${seenSlugs.get(slug)})`);
  }
  seenSlugs.set(slug, domainPath);

  if (!Array.isArray(domain.projects)) {
    throw new Error(`${domainPath}: "projects" must be an array`);
  }

  for (const project of domain.projects) {
    if (!project.id || !Array.isArray(project.path)) {
      throw new Error(`${domainPath}: project missing "id" or non-array "path": ${JSON.stringify(project)}`);
    }
  }

  const historyPath = `${DATA_DIR}/history/${slug}.json`;
  const projectHistory = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : {};
  historyBySlug[slug] = projectHistory;

  const sizedProjects = domain.projects.map((project) => {
    const { sizes, hasEnoughHistory, growth } = computeProjectSizing(project, projectHistory[project.id] ?? []);
    return { ...project, sizes, hasEnoughHistory, growth };
  });

  const invalidSizeIds = findInvalidSizes(sizedProjects);
  if (invalidSizeIds.length > 0) {
    throw new Error(`${domainPath}: invalid computed size(s) for project id(s): ${invalidSizeIds.join(", ")}`);
  }

  // Project `image` values (when present) are already direct URLs into the
  // project's source repo — set by `enrich-domain.mjs` — so no local
  // resolution or copying is needed here.
  parsedDomains.push({ ...domain, projects: sizedProjects, historyPath });
}

// Pass 2: compute every window's leaderboard (global + one per domain) from
// the complete set of domains and history — this powers both the dedicated
// /rising/ page and every teaser below.
const leaderboardsByWindow = {};
for (const windowDays of RISING_WINDOWS_DAYS) {
  const byScope = {
    global: computeLeaderboard(parsedDomains, historyBySlug, { scope: "global", windowDays, limit: LEADERBOARD_LIMIT }),
  };
  for (const domain of parsedDomains) {
    byScope[domain.slug] = computeLeaderboard(parsedDomains, historyBySlug, { scope: domain.slug, windowDays, limit: LEADERBOARD_LIMIT });
  }
  leaderboardsByWindow[windowDays] = byScope;
}

// Pass 3: render every domain's full page, embed page, and history.json,
// now that its teaser (the top of its own 7-day leaderboard) is available.
const domains = [];

for (const domain of parsedDomains) {
  const { slug, historyPath } = domain;
  const tree = buildTree(domain.projects, { id: slug, name: domain.name });
  const teaser = leaderboardsByWindow[TEASER_WINDOW_DAYS][slug].slice(0, TEASER_LIMIT);

  mkdirSync(`${DIST_DIR}/${slug}`, { recursive: true });
  mkdirSync(`${DIST_DIR}/embed/${slug}`, { recursive: true });

  // Ships the raw per-repo history (already loaded in Pass 1) to the
  // client as-is, so the detail panel can fetch it on demand to draw a
  // leaf's star-history sparkline. Skipped when the domain has no history
  // file yet — the panel's fetch fails gracefully in that case (see
  // render-page.mjs).
  if (existsSync(historyPath)) {
    copyFileSync(historyPath, `${DIST_DIR}/${slug}/history.json`);
  }

  writeFileSync(
    `${DIST_DIR}/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: false, defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH, teaser })
  );
  writeFileSync(
    `${DIST_DIR}/embed/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: true, defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
  );

  domains.push({ slug, name: domain.name, description: domain.description ?? "" });
}

const globalTeaser = leaderboardsByWindow[TEASER_WINDOW_DAYS].global.slice(0, TEASER_LIMIT);
writeFileSync(
  `${DIST_DIR}/index.html`,
  renderLandingPage(domains, { defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH, teaser: globalTeaser })
);

mkdirSync(`${DIST_DIR}/rising`, { recursive: true });
writeFileSync(
  `${DIST_DIR}/rising/index.html`,
  renderRisingPage(domains, leaderboardsByWindow, { defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
);

cpSync(`${APP_DIR}/shared`, `${DIST_DIR}/shared`, { recursive: true });
cpSync(`${APP_DIR}/vendor`, `${DIST_DIR}/vendor`, { recursive: true });
copyFileSync(`${APP_DIR}/og-default.png`, `${DIST_DIR}/og-default.png`);
if (CNAME) writeFileSync(`${DIST_DIR}/CNAME`, `${CNAME}\n`);

const sitemap = buildSitemap(domains.map((d) => d.slug), { siteUrl: SITE_URL, basePath: BASE_PATH });
if (sitemap) writeFileSync(`${DIST_DIR}/sitemap.xml`, sitemap);
writeFileSync(`${DIST_DIR}/robots.txt`, buildRobots({ siteUrl: SITE_URL, basePath: BASE_PATH }));

console.log(`Generated ${domains.length} domain(s) into ${DIST_DIR}/`);
