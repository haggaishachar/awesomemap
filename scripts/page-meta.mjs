import { isoWeekBounds } from "./iso-week.mjs";

/**
 * `<title>`/meta-description builders for the long-tail pages — tags,
 * categories, projects, and the Rising/archive lists. Titles are phrased
 * the way people search ("Top MCP open-source projects (2026)",
 * "opencode: GitHub star history & growth") rather than as bare labels
 * ("MCP — awesomemap"), and descriptions name real projects and numbers so
 * a search snippet says something on its own. Pure string-building, kept
 * apart from render-page.mjs so the exact wording is unit-testable.
 *
 * Search engines show roughly 155 characters of a description, so every
 * description goes through `clampDescription`.
 */

const MAX_DESCRIPTION = 155;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Trims `text` to `max` (default MAX_DESCRIPTION) characters at a word boundary, with an ellipsis when cut. */
export function clampDescription(text, max = MAX_DESCRIPTION) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

/** "opencode, Superpowers and firecrawl" — the first `limit` names, joined for prose. */
function listNames(names, limit = 3) {
  const picked = names.filter(Boolean).slice(0, limit);
  if (picked.length <= 1) return picked.join("");
  return `${picked.slice(0, -1).join(", ")} and ${picked.at(-1)}`;
}

function projectWord(count) {
  return `project${count === 1 ? "" : "s"}`;
}

/**
 * A tag page. `projects` is the tag's list, already sorted by stars (the
 * page's own order), so its first names are the ones worth naming.
 */
export function tagPageMeta(tag, projects, { year }) {
  const top = listNames(projects.map((project) => project.name ?? project.id));
  return {
    title: `Top ${tag} open-source projects (${year}) — awesomemap`,
    description: clampDescription(
      `${projects.length} open-source ${tag} ${projectWord(projects.length)} ranked by GitHub stars, with 7-day star growth${top ? `, including ${top}` : ""}. Updated daily.`
    ),
  };
}

/**
 * A category page (a domain's treemap pre-zoomed to one category).
 * `topNames` is the category's biggest projects by stars.
 */
export function categoryPageMeta(category, domainShort, { projectCount, topNames = [], year }) {
  const top = listNames(topNames);
  return {
    title: `Top ${category} open-source projects (${year}) — ${domainShort} | awesomemap`,
    description: clampDescription(
      `Map of ${projectCount} open-source ${category} ${projectWord(projectCount)} in ${domainShort}, sized by stars and ranked by star growth${top ? `: ${top}` : ""}. Updated daily.`
    ),
  };
}

/**
 * A project page. `stars` is its current star count; `growth7d` is its
 * 7-day `{ starDelta, hasEnoughHistory }` (only a gain is mentioned —
 * a description is no place to advertise a decline).
 */
export function projectPageMeta(project, { stars, growth7d }) {
  const name = project.name ?? project.id;
  const facts = [`★ ${Number(stars ?? 0).toLocaleString("en-US")} stars`];
  if (growth7d?.hasEnoughHistory && growth7d.starDelta > 0) {
    facts.push(`+${growth7d.starDelta.toLocaleString("en-US")} this week`);
  }
  // The facts and repo id are what a searcher came for, so a long project
  // description is what gets cut to fit, never the tail.
  const tail = `${facts.join(", ")}. Star history and growth signals for ${project.id}.`;
  const descBudget = MAX_DESCRIPTION - tail.length - 2;
  const desc = project.desc ? project.desc.replace(/\s+/g, " ").trim().replace(/[\s.]+$/, "") : "";
  const lead = desc && descBudget >= 20 ? `${clampDescription(desc, descBudget)}${desc.length > descBudget ? "" : "."} ` : "";
  return {
    title: `${name}: GitHub star history & growth (${project.id}) — awesomemap`,
    description: clampDescription(`${lead}${tail}`),
  };
}

/** The /rising/ page — the page that competes with GitHub Trending itself. */
export function risingPageMeta({ domainCount }) {
  return {
    title: "Trending open-source projects this week, by star growth — awesomemap",
    description: clampDescription(
      `A GitHub Trending alternative: open-source projects ranked by star growth${domainCount > 0 ? ` across ${domainCount} domains` : ""}, grouped by size so small ones stand out. Updated daily.`
    ),
  };
}

/** "Oct 12–18, 2026" (or "Dec 29, 2025 – Jan 4, 2026" across a year) for an ISO week label. */
export function isoWeekRange(isoWeek) {
  const { start, end } = isoWeekBounds(isoWeek);
  const startMonth = MONTHS[start.getUTCMonth()];
  const endMonth = MONTHS[end.getUTCMonth()];
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${startMonth} ${start.getUTCDate()}, ${start.getUTCFullYear()} – ${endMonth} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  }
  const endPart = startMonth === endMonth ? `${end.getUTCDate()}` : `${endMonth} ${end.getUTCDate()}`;
  return `${startMonth} ${start.getUTCDate()}–${endPart}, ${end.getUTCFullYear()}`;
}

/**
 * One archived week's /rising/archive/<week>/ page. `topNames` is that
 * week's global leaders, so the snippet names what actually trended.
 */
export function archiveWeekPageMeta(isoWeek, { topNames = [] }) {
  const range = isoWeekRange(isoWeek);
  const top = listNames(topNames);
  return {
    title: `Trending open-source projects, ${range} — awesomemap`,
    description: clampDescription(
      `The fastest-growing open-source projects on GitHub for the week of ${range}${top ? `, led by ${top}` : ""}.`
    ),
  };
}
