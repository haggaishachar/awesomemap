import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampDescription,
  tagPageMeta,
  categoryPageMeta,
  projectPageMeta,
  risingPageMeta,
  isoWeekRange,
  archiveWeekPageMeta,
} from "../scripts/page-meta.mjs";

test("clampDescription leaves short text alone and cuts long text at a word boundary within 155 chars", () => {
  assert.equal(clampDescription("  short   text "), "short text");
  const long = clampDescription("word ".repeat(60));
  assert.ok(long.length <= 155, long.length);
  assert.match(long, /word…$/);
});

test("tagPageMeta phrases the title as a search query and names the top three projects", () => {
  const meta = tagPageMeta("mcp", [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }], { year: 2026 });
  assert.equal(meta.title, "Top mcp open-source projects (2026) — awesomemap");
  assert.equal(meta.description, "4 open-source mcp projects ranked by GitHub stars, with 7-day star growth, including A, B and C. Updated daily.");
});

test("tagPageMeta handles a single project", () => {
  assert.equal(
    tagPageMeta("rust", [{ id: "a/a" }], { year: 2026 }).description,
    "1 open-source rust project ranked by GitHub stars, with 7-day star growth, including a/a. Updated daily."
  );
});

test("categoryPageMeta names the category, its domain and its biggest projects", () => {
  const meta = categoryPageMeta("Vector Databases", "AI", { projectCount: 12, topNames: ["qdrant", "milvus"], year: 2026 });
  assert.equal(meta.title, "Top Vector Databases open-source projects (2026) — AI | awesomemap");
  assert.equal(meta.description, "Map of 12 open-source Vector Databases projects in AI, sized by stars and ranked by star growth: qdrant and milvus. Updated daily.");
});

test("projectPageMeta targets 'star history' searches and states stars and a weekly gain", () => {
  const meta = projectPageMeta({ id: "anomalyco/opencode", name: "opencode", desc: "The open source coding agent." }, { stars: 220400, growth7d: { hasEnoughHistory: true, starDelta: 6300 } });
  assert.equal(meta.title, "opencode: GitHub star history & growth (anomalyco/opencode) — awesomemap");
  assert.equal(meta.description, "The open source coding agent. ★ 220,400 stars, +6,300 this week. Star history and growth signals for anomalyco/opencode.");
});

test("projectPageMeta never advertises a decline or an untracked week, and copes without a description", () => {
  const declining = projectPageMeta({ id: "a/b", name: "b" }, { stars: 10, growth7d: { hasEnoughHistory: true, starDelta: -4 } });
  assert.equal(declining.description, "★ 10 stars. Star history and growth signals for a/b.");
  const untracked = projectPageMeta({ id: "a/b" }, { stars: 10, growth7d: { hasEnoughHistory: false, starDelta: 99 } });
  assert.doesNotMatch(untracked.description, /this week/);
  assert.match(untracked.title, /^a\/b: GitHub star history/);
});

test("projectPageMeta keeps a long description within the snippet length", () => {
  const meta = projectPageMeta({ id: "a/b", desc: "x ".repeat(200) }, { stars: 1, growth7d: null });
  assert.ok(meta.description.length <= 155);
});

test("risingPageMeta positions /rising/ against GitHub Trending", () => {
  const meta = risingPageMeta({ domainCount: 10 });
  assert.match(meta.title, /^Trending open-source projects this week/);
  assert.match(meta.description, /^A GitHub Trending alternative: .* across 10 domains/);
  assert.ok(meta.description.length <= 155);
});

test("isoWeekRange formats a week within one month, across months, and across years", () => {
  assert.equal(isoWeekRange("2026-W42"), "Oct 12–18, 2026");
  assert.equal(isoWeekRange("2026-W40"), "Sep 28–Oct 4, 2026");
  assert.equal(isoWeekRange("2026-W01"), "Dec 29, 2025 – Jan 4, 2026");
});

test("archiveWeekPageMeta dates the page and names that week's leaders", () => {
  const meta = archiveWeekPageMeta("2026-W42", { topNames: ["bifrost", "cosmo-edge", "rea", "x"] });
  assert.equal(meta.title, "Trending open-source projects, Oct 12–18, 2026 — awesomemap");
  assert.equal(
    meta.description,
    "The fastest-growing open-source projects on GitHub for the week of Oct 12–18, 2026, led by bifrost, cosmo-edge and rea."
  );
});

test("projectPageMeta cuts a long project description, never the stars or the repo id", () => {
  const meta = projectPageMeta(
    { id: "ggerganov/llama.cpp", desc: "Inference of LLaMA and other large language models in pure C/C++ with many backends" },
    { stars: 125701, growth7d: { hasEnoughHistory: true, starDelta: 500 } }
  );
  assert.ok(meta.description.length <= 155, meta.description.length);
  assert.match(meta.description, /^Inference of LLaMA[^★]*… ★ 125,701 stars, \+500 this week\. Star history and growth signals for ggerganov\/llama\.cpp\.$/);
});
