#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, cpSync } from "node:fs";
import { buildTree } from "./build-tree.mjs";
import { renderDomainPage, renderLandingPage } from "./render-page.mjs";

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

  if (!Array.isArray(domain.tools)) {
    throw new Error(`${domainPath}: "tools" must be an array`);
  }

  for (const tool of domain.tools) {
    if (!tool.id || !Array.isArray(tool.path)) {
      throw new Error(`${domainPath}: tool missing "id" or non-array "path": ${JSON.stringify(tool)}`);
    }
  }

  // Tool `image` values (when present) are already direct URLs into the
  // tool's source repo — set by `enrich-domain.mjs` — so no local
  // resolution or copying is needed here.
  const tree = buildTree(domain.tools, { id: slug, name: domain.name });

  mkdirSync(`${DIST_DIR}/${slug}`, { recursive: true });
  mkdirSync(`${DIST_DIR}/embed/${slug}`, { recursive: true });

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

console.log(`Generated ${domains.length} domain(s) into ${DIST_DIR}/`);
