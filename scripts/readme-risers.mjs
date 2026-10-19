// Keeps README.md's "Top risers this week" section in sync with the same
// 7-day Rising score / rank-diff math the site's own /rising/ leaderboard
// and homepage teaser already use (`leaderboard.mjs`'s `computeLeaderboard`).
// A cross-repo README sync like this used to exist (the pre-split repo's
// `social-digest.mjs`) and was retired when the data pipeline moved to
// awesomemap-data — see docs/superpowers/specs/2026-09-04-awesomemap-data-api-wiring-design.md's
// "Known gaps" / Part B note. It didn't need reviving as a cross-repo job,
// though: `data-store.mjs` already reads awesomemap-data's public,
// unauthenticated read API from this repo (Part A), so this script can
// compute the leaderboard and rewrite this repo's own README.md in one
// place, using nothing but this repo's own `GITHUB_TOKEN` to commit it —
// no cross-repo auth needed at all.
import { readFileSync, writeFileSync } from "node:fs";
import { loadAllDomains, loadAllProjectEntities, joinDomainProjects } from "./data-store.mjs";
import { computeLeaderboard } from "./leaderboard.mjs";
import { pickReasonEvent } from "./project-events.mjs";
import { MS_PER_DAY } from "./velocity.mjs";

/** Growth window backing the README list — 7 days so rank arrows actually move between daily runs (30/90-day ranks barely shift day to day). */
export const README_RISERS_WINDOW_DAYS = 7;

/** How many projects the README list holds — a curated top slice, not the full ~1,300-project catalog (which lives on the site's own /rising/ leaderboard instead). */
export const README_RISERS_LIMIT = 100;

/** How many of those render open; the rest sit in a collapsed <details> block so the README isn't a 100-entry wall. */
export const README_RISERS_VISIBLE = 15;

// Bracket this section in an HTML comment pair so `updateReadme` can find
// and replace exactly its content on every run, the same marker-diffing
// approach the old (retired) social-digest.mjs used for this same section.
export const RISERS_START_MARKER = "<!-- RISERS:START -->";
export const RISERS_END_MARKER = "<!-- RISERS:END -->";

const SITE_URL = "https://awesomemap.dev";

// GitHub's Markdown sanitizer strips `style` attributes from rendered HTML,
// so a plain ▲/▼ character can't be colored with CSS the way the site's own
// rising-row-up/-down classes do (treemap.css). Two tiny repo-local SVGs,
// referenced the same repo-relative way README.md's demo.gif already is,
// give the README real green-up/red-down arrows instead — colors matched to
// treemap.css's light-mode --color-rising-up/--color-rising-down.
const ARROW_UP_SRC = "docs/media/arrow-up.svg";
const ARROW_DOWN_SRC = "docs/media/arrow-down.svg";

// Short phrase per event type, reused from render-page.mjs's own
// EVENT_REASON_PHRASES so the README's "why" wording matches the site's —
// kept as its own copy rather than an import since render-page.mjs's
// version is a private (unexported) constant.
const EVENT_REASON_PHRASES = {
  hn: "Featured on Hacker News",
  reddit: "Trending on Reddit",
  producthunt: "Launched on Product Hunt",
  blog: "Covered in the press",
};

/** Longest a project's `desc` is allowed to render before truncating with an ellipsis — it sits on the entry's small second line, which should stay one line. */
const MAX_DESC_LENGTH = 90;

/** Cells in each entry's Rising-score bar — filled in proportion to the #1 entry's score. */
const SCORE_BAR_CELLS = 8;

// One emoji per domain (by slug), so the second line is scannable by domain
// at a glance; an unmapped (newly added) domain just shows its name alone.
const DOMAIN_EMOJI = {
  "artificial-intelligence": "🤖",
  automation: "⚙️",
  "data-science": "📊",
  databases: "🗄️",
  "devops-infra": "☁️",
  "mobile-dev": "📱",
  security: "🛡️",
  "smart-home": "🏠",
  utilities: "🧰",
  "web-dev": "🌐",
};

/** Escapes the handful of characters that would otherwise break Markdown link/emphasis syntax inside plain interpolated text. */
function escapeMdText(text) {
  return String(text).replace(/[[\]*_`]/g, (char) => `\\${char}`);
}

/** Truncates `text` to `MAX_DESC_LENGTH`, breaking on the last whole word rather than mid-word, or "" for a missing description. */
function truncateDesc(text) {
  if (!text) return "";
  if (text.length <= MAX_DESC_LENGTH) return text;
  return `${text.slice(0, MAX_DESC_LENGTH).replace(/\s+\S*$/, "")}…`;
}

/** Formats a star count compactly — 950, 31.0k, 1.2M — so the stats line stays short. */
export function formatCompact(count) {
  const abs = Math.abs(count);
  if (abs >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/** Renders `score` as a ▰▱ bar relative to `topScore` (the #1 entry's), never fully empty for a listed entry. */
export function renderScoreBar(score, topScore) {
  const filled = topScore > 0 ? Math.min(SCORE_BAR_CELLS, Math.max(1, Math.round((score / topScore) * SCORE_BAR_CELLS))) : 1;
  return "▰".repeat(filled) + "▱".repeat(SCORE_BAR_CELLS - filled);
}

/**
 * Joins each leaderboard candidate's most notable in-window event (if any)
 * onto it, mirroring generate.mjs's own `withEventReason` — this script
 * has its own copy since it doesn't share generate.mjs's module scope.
 * `entitiesById` is a `loadAllProjectEntities()` result (id -> full entity,
 * `events` included); `cutoffDateStr` is the window's start date.
 */
export function withEventReason(pool, entitiesById, cutoffDateStr) {
  return pool.map((candidate) => {
    const reason = pickReasonEvent(entitiesById.get(candidate.id)?.events, cutoffDateStr);
    return reason ? { ...candidate, eventReason: reason } : candidate;
  });
}

/**
 * Renders one leaderboard entry as a two-line Markdown paragraph (one
 * source line, split by a `<br>` so no renderer adds a second break). Line one
 * is the headline: rank, icon, name (linked to its awesomemap.dev project
 * page), rank-movement arrow (only when it moved), this week's percent
 * growth, a Rising-score bar relative to `topScore`, and stars with this
 * week's gain. Line two, in small text, is the detail: domain, truncated
 * description, and — when `pickReasonEvent` found one — a link to the
 * external mention that explains the spike.
 */
export function renderRisersEntry(entry, { topScore = entry.score } = {}) {
  const movedBy = Math.abs(entry.rankDelta);
  const arrow =
    entry.rankDelta > 0
      ? ` <img src="${ARROW_UP_SRC}" width="10" height="10" alt="up" align="absmiddle">${movedBy}`
      : entry.rankDelta < 0
        ? ` <img src="${ARROW_DOWN_SRC}" width="10" height="10" alt="down" align="absmiddle">${movedBy}`
        : "";
  // Fall back to the owner's GitHub avatar so every entry starts with an
  // icon and the names line up down the list.
  const iconSrc = entry.image ?? `https://github.com/${entry.id.split("/")[0]}.png?size=40`;
  const icon = `<img src="${iconSrc}" width="20" height="20" alt="" align="absmiddle">`;
  const name = escapeMdText(entry.name);
  const projectUrl = `${SITE_URL}/projects/${entry.id}/`;
  const sign = entry.starDelta > 0 ? "+" : "";
  const growth = `\`${sign}${entry.percentDelta.toFixed(1)}%\``;
  const bar = renderScoreBar(entry.score, topScore);
  const stars = `★ ${formatCompact(entry.currentStars)} (${sign}${formatCompact(entry.starDelta)})`;

  const domain = escapeMdText(entry.domainShort ?? entry.domain);
  const emoji = DOMAIN_EMOJI[entry.domainSlug];
  const desc = truncateDesc(entry.desc);
  const details = [emoji ? `${emoji} ${domain}` : domain];
  if (desc) details.push(escapeMdText(desc));
  if (entry.eventReason) {
    details.push(`[📰 ${escapeMdText(EVENT_REASON_PHRASES[entry.eventReason.type] ?? entry.eventReason.title)}](${entry.eventReason.url})`);
  }

  return `**${entry.rank}.** ${icon} **[${name}](${projectUrl})**${arrow} &nbsp; ${growth} ${bar} ${stars}<br><sub>${details.join(" · ")}</sub>`;
}

/**
 * Renders the full README list — the first `README_RISERS_VISIBLE` entries
 * open, the rest inside a collapsed <details> block, each entry its own
 * blank-line-separated paragraph — or a placeholder when the leaderboard is
 * empty (e.g. too early in the dataset's life for a full 7-day window
 * everywhere). Score bars are all relative to the #1 entry.
 */
export function renderRisersList(entries) {
  if (entries.length === 0) {
    return "_Not enough star-history yet to rank this week's risers._";
  }
  const topScore = entries[0].score;
  const render = (entry) => renderRisersEntry(entry, { topScore });
  const visible = entries.slice(0, README_RISERS_VISIBLE).map(render).join("\n\n");
  const rest = entries.slice(README_RISERS_VISIBLE);
  if (rest.length === 0) return visible;
  const summary = `<summary><b>Show ranks ${rest[0].rank}–${rest[rest.length - 1].rank}</b></summary>`;
  return `${visible}\n\n<details>\n${summary}\n\n${rest.map(render).join("\n\n")}\n\n</details>`;
}

/**
 * Replaces the content between `RISERS_START_MARKER`/`RISERS_END_MARKER` in
 * `readmeContent` with `listMarkdown`, leaving everything else untouched.
 * Pure — throws (rather than silently no-op'ing) when a marker is missing,
 * matching this project's "fail loudly on bad data" convention, since a
 * missing marker means the README was edited in a way this script can no
 * longer locate its own section in.
 */
export function updateReadme(readmeContent, listMarkdown) {
  const startIndex = readmeContent.indexOf(RISERS_START_MARKER);
  const endIndex = readmeContent.indexOf(RISERS_END_MARKER);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`README.md is missing a valid ${RISERS_START_MARKER} / ${RISERS_END_MARKER} marker pair`);
  }
  const before = readmeContent.slice(0, startIndex + RISERS_START_MARKER.length);
  const after = readmeContent.slice(endIndex);
  return `${before}\n${listMarkdown}\n${after}`;
}

async function main() {
  const rawDomains = await loadAllDomains();
  const entitiesById = await loadAllProjectEntities();
  const domains = rawDomains.map((domain) => ({ ...domain, projects: joinDomainProjects(domain, entitiesById) }));

  const cutoffDateStr = new Date(Date.now() - README_RISERS_WINDOW_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
  const leaderboard = computeLeaderboard(domains, { scope: "global", windowDays: README_RISERS_WINDOW_DAYS, limit: README_RISERS_LIMIT });
  const entries = withEventReason(leaderboard, entitiesById, cutoffDateStr);

  const readmePath = new URL("../README.md", import.meta.url);
  const readmeContent = readFileSync(readmePath, "utf8");
  const updated = updateReadme(readmeContent, renderRisersList(entries));

  if (updated === readmeContent) {
    console.log("README.md risers section unchanged.");
    return;
  }
  writeFileSync(readmePath, updated);
  console.log(`README.md risers section updated (${entries.length} projects).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
