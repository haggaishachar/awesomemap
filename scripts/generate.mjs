#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, cpSync } from "node:fs";
import { buildTree } from "./build-tree.mjs";
import { resolveImage } from "./resolve-image.mjs";
import { renderDomainPage, renderLandingPage } from "./render-page.mjs";

const DATA_DIR = "data";
const DIST_DIR = "dist";
const APP_DIR = "app";
const DEFAULT_OG_IMAGE = "/og-default.png";

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

const domainFiles = readdirSync(DATA_DIR).filter((name) => name.endsWith(".json"));
const domains = [];

for (const file of domainFiles) {
  const domainPath = `${DATA_DIR}/${file}`;
  const domain = JSON.parse(readFileSync(domainPath, "utf8"));
  const slug = domain.slug;

  if (!Array.isArray(domain.tools)) {
    throw new Error(`${domainPath}: "tools" must be an array`);
  }

  const imagesDir = `${DATA_DIR}/${slug}/images`;
  let imageFilenames = [];
  try {
    imageFilenames = readdirSync(imagesDir);
  } catch {
    imageFilenames = [];
  }

  const resolvedTools = domain.tools.map((tool) => {
    if (!tool.id || !Array.isArray(tool.path)) {
      throw new Error(`${domainPath}: tool missing "id" or non-array "path": ${JSON.stringify(tool)}`);
    }
    const image = resolveImage(tool.id, imageFilenames);
    return image ? { ...tool, image } : tool;
  });

  const tree = buildTree(resolvedTools, { id: slug, name: domain.name });

  mkdirSync(`${DIST_DIR}/${slug}/images`, { recursive: true });
  mkdirSync(`${DIST_DIR}/embed/${slug}`, { recursive: true });

  writeFileSync(
    `${DIST_DIR}/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: false, defaultOgImage: DEFAULT_OG_IMAGE })
  );
  writeFileSync(
    `${DIST_DIR}/embed/${slug}/index.html`,
    renderDomainPage(domain, tree, { embed: true, defaultOgImage: DEFAULT_OG_IMAGE })
  );

  for (const filename of imageFilenames) {
    copyFileSync(`${imagesDir}/${filename}`, `${DIST_DIR}/${slug}/images/${filename}`);
  }

  domains.push({ slug, name: domain.name, description: domain.description ?? "" });
}

writeFileSync(`${DIST_DIR}/index.html`, renderLandingPage(domains, { defaultOgImage: DEFAULT_OG_IMAGE }));

cpSync(`${APP_DIR}/shared`, `${DIST_DIR}/shared`, { recursive: true });
cpSync(`${APP_DIR}/vendor`, `${DIST_DIR}/vendor`, { recursive: true });
copyFileSync(`${APP_DIR}/og-default.png`, `${DIST_DIR}/og-default.png`);

console.log(`Generated ${domains.length} domain(s) into ${DIST_DIR}/`);
