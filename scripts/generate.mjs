#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, cpSync, existsSync } from "node:fs";
import { buildTree } from "./build-tree.mjs";
import { renderDomainPage, renderLandingPage } from "./render-page.mjs";
import { computeProjectSizing, findInvalidSizes } from "./velocity.mjs";
import { buildSitemap, buildRobots } from "./seo.mjs";

const DATA_DIR = "data";
const DIST_DIR = "dist";
const APP_DIR = "app";

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
const domains = [];
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
  const tree = buildTree(sizedProjects, { id: slug, name: domain.name });

  mkdirSync(`${DIST_DIR}/${slug}`, { recursive: true });
  mkdirSync(`${DIST_DIR}/embed/${slug}`, { recursive: true });

  // Ships the raw per-repo history (already loaded above for
  // computeProjectSizing) to the client as-is, so the detail panel can
  // fetch it on demand to draw a leaf's star-history sparkline. Skipped
  // when the domain has no history file yet (e.g. a brand-new domain) —
  // the panel's fetch fails gracefully in that case (see render-page.mjs).
  if (existsSync(historyPath)) {
    copyFileSync(historyPath, `${DIST_DIR}/${slug}/history.json`);
  }

  writeFileSync(
    `${DIST_DIR}/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: false, defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
  );
  writeFileSync(
    `${DIST_DIR}/embed/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: true, defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
  );

  domains.push({ slug, name: domain.name, description: domain.description ?? "" });
}

writeFileSync(
  `${DIST_DIR}/index.html`,
  renderLandingPage(domains, { defaultOgImage: DEFAULT_OG_IMAGE, siteUrl: SITE_URL, basePath: BASE_PATH })
);

cpSync(`${APP_DIR}/shared`, `${DIST_DIR}/shared`, { recursive: true });
cpSync(`${APP_DIR}/vendor`, `${DIST_DIR}/vendor`, { recursive: true });
copyFileSync(`${APP_DIR}/og-default.png`, `${DIST_DIR}/og-default.png`);
if (CNAME) writeFileSync(`${DIST_DIR}/CNAME`, `${CNAME}\n`);

const sitemap = buildSitemap(domains.map((d) => d.slug), { siteUrl: SITE_URL, basePath: BASE_PATH });
if (sitemap) writeFileSync(`${DIST_DIR}/sitemap.xml`, sitemap);
writeFileSync(`${DIST_DIR}/robots.txt`, buildRobots({ siteUrl: SITE_URL, basePath: BASE_PATH }));

console.log(`Generated ${domains.length} domain(s) into ${DIST_DIR}/`);
