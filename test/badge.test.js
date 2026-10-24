// test/badge.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickBadgeClaim,
  computeCategoryRanks,
  measureText,
  renderBadgeSvg,
  buildBadgeMarkdown,
  BADGE_COLORS,
  MAX_CATEGORY_RANK,
  bestArchivedRanks,
  isoWeekMonth,
  buildShieldsEndpoint,
} from "../scripts/badge.mjs";

const growing = (percentDelta, starDelta = 100) => ({ starDelta, percentDelta, hasEnoughHistory: true });
const base = { risingRank: null, growth7d: growing(0, 0), categoryRank: { rank: 50, of: 200 }, categoryName: "Deep Learning", domainShort: "AI" };

test("pickBadgeClaim leads with a Rising rank, naming its tier and 7-day growth", () => {
  const claim = pickBadgeClaim({ ...base, risingRank: { tier: "breakout", rank: 3 }, growth7d: growing(5.14) });
  assert.equal(claim.message, "#3 Breakout in AI · +5.1% 7d");
  assert.equal(claim.color, BADGE_COLORS.rising);
});

test("pickBadgeClaim drops the growth suffix from a Rising rank when growth is unknown or under 1%", () => {
  const claim = pickBadgeClaim({ ...base, risingRank: { tier: "giants", rank: 1 }, growth7d: { hasEnoughHistory: false } });
  assert.equal(claim.message, "#1 Giant in AI");
  assert.equal(pickBadgeClaim({ ...base, risingRank: { tier: "giants", rank: 7 }, growth7d: growing(0.3) }).message, "#7 Giant in AI");
});

test("pickBadgeClaim shows 7-day growth when unranked and growing at least 1%", () => {
  const claim = pickBadgeClaim({ ...base, growth7d: growing(8.62) });
  assert.equal(claim.message, "▲ +8.6% stars this week");
  assert.equal(claim.color, BADGE_COLORS.growing);
});

test("pickBadgeClaim falls through to a top-10 category rank on slow growth", () => {
  const claim = pickBadgeClaim({ ...base, growth7d: growing(0.4), categoryRank: { rank: 4, of: 212 } });
  assert.equal(claim.message, "#4 of 212 in Deep Learning");
  assert.equal(claim.color, BADGE_COLORS.categoryRank);
});

test("pickBadgeClaim never shows a decline, a category rank past the top 10, or one in the bottom half", () => {
  const shrinking = pickBadgeClaim({ ...base, growth7d: growing(-3, -50) });
  assert.equal(shrinking.message, "listed in Deep Learning");
  assert.equal(shrinking.color, BADGE_COLORS.listed);
  assert.equal(pickBadgeClaim({ ...base, categoryRank: { rank: MAX_CATEGORY_RANK + 1, of: 200 } }).message, "listed in Deep Learning");
  assert.equal(pickBadgeClaim({ ...base, categoryRank: { rank: 5, of: 6 } }).message, "listed in Deep Learning");
  assert.equal(pickBadgeClaim({ ...base, categoryRank: { rank: 1, of: 1 } }).message, "listed in Deep Learning");
  assert.equal(pickBadgeClaim({ ...base, categoryRank: { rank: 3, of: 6 } }).message, "#3 of 6 in Deep Learning");
});

test("pickBadgeClaim falls back to the domain when there's no category", () => {
  assert.equal(pickBadgeClaim({ ...base, categoryName: undefined, categoryRank: null }).message, "listed in AI");
});

test("computeCategoryRanks ranks by stars within each top-level category", () => {
  const ranks = computeCategoryRanks([
    { id: "a/x", weight: 10, path: ["One", "Sub"] },
    { id: "b/x", weight: 30, path: ["One"] },
    { id: "c/x", weight: 20, path: ["Two"] },
    { id: "d/x", weight: 5, path: [] },
  ]);
  assert.deepEqual(ranks.get("b/x"), { rank: 1, of: 2 });
  assert.deepEqual(ranks.get("a/x"), { rank: 2, of: 2 });
  assert.deepEqual(ranks.get("c/x"), { rank: 1, of: 1 });
  assert.equal(ranks.has("d/x"), false);
});

test("measureText sums known glyph widths and falls back for unknown ones", () => {
  assert.equal(measureText("ii"), 6.2);
  assert.equal(measureText("·"), 3.5);
  assert.equal(measureText("日"), 7);
});

test("renderBadgeSvg sizes the badge to its text and escapes the message", () => {
  const svg = renderBadgeSvg({ message: "listed in R&D <tools>", color: "#6e7781" });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20"/);
  assert.match(svg, /aria-label="awesomemap: listed in R&amp;D &lt;tools&gt;"/);
  assert.doesNotMatch(svg, /R&D/);
  const short = Number(renderBadgeSvg({ message: "a", color: "#000" }).match(/width="(\d+)"/)[1]);
  const long = Number(renderBadgeSvg({ message: "a much longer message", color: "#000" }).match(/width="(\d+)"/)[1]);
  assert.ok(long > short);
});

test("buildBadgeMarkdown links the badge image to the project page", () => {
  assert.equal(
    buildBadgeMarkdown("https://awesomemap.dev/projects/a/b/badge.svg", "https://awesomemap.dev/projects/a/b/"),
    "[![awesomemap](https://awesomemap.dev/projects/a/b/badge.svg)](https://awesomemap.dev/projects/a/b/)"
  );
});

const row = (id, rank) => ({ id, rank, name: id });

test("pickBadgeClaim falls back to a dated archived peak after a live rank lapses, ahead of growth", () => {
  const claim = pickBadgeClaim({ ...base, growth7d: growing(8), peakRank: { rank: 2, tier: "breakout", scope: "artificial-intelligence", isoWeek: "2026-W40" } });
  assert.equal(claim.message, "#2 Breakout in AI · Oct 2026");
  assert.equal(claim.color, BADGE_COLORS.peak);
});

test("pickBadgeClaim keeps a live rank ahead of an archived peak, and names a peak's own domain or 'overall'", () => {
  const peakRank = { rank: 1, tier: "giants", scope: "global", isoWeek: "2026-W41" };
  assert.equal(pickBadgeClaim({ ...base, risingRank: { tier: "climbing", rank: 9 }, peakRank }).message, "#9 Climbing in AI");
  assert.equal(pickBadgeClaim({ ...base, peakRank }).message, "#1 Giant overall · Oct 2026");
  assert.equal(
    pickBadgeClaim({ ...base, peakRank: { rank: 4, tier: "breakout", scope: "web-dev", isoWeek: "2026-W39" }, domainShortBySlug: { "web-dev": "Web Dev" } }).message,
    "#4 Breakout in Web Dev · Sep 2026"
  );
});

test("isoWeekMonth names the month the week closes in", () => {
  assert.equal(isoWeekMonth("2026-W42"), "Oct 2026");
  assert.equal(isoWeekMonth("2026-W01"), "Jan 2026");
});

test("bestArchivedRanks keeps each project's lowest rank across weeks, preferring global, then the earliest week", () => {
  const ranks = bestArchivedRanks([
    { isoWeek: "2026-W42", scopes: { "breakout:global": [row("a/a", 1)], "climbing:web-dev": [row("b/b", 3)] } },
    { isoWeek: "2026-W40", scopes: { "breakout:ai": [row("a/a", 1)] } },
    { isoWeek: "2026-W41", scopes: { "breakout:global": [row("a/a", 1)], "climbing:web-dev": [row("b/b", 2)] } },
  ]);
  assert.deepEqual(ranks.get("a/a"), { rank: 1, tier: "breakout", scope: "global", isoWeek: "2026-W41" });
  assert.deepEqual(ranks.get("b/b"), { rank: 2, tier: "climbing", scope: "web-dev", isoWeek: "2026-W41" });
});

test("bestArchivedRanks reads pre-tier snapshots as Breakout, skips their copies in tiered ones, and ignores Spiking and removed domains", () => {
  const ranks = bestArchivedRanks(
    [
      { isoWeek: "2026-W39", scopes: { global: [row("old/old", 5)] } },
      { isoWeek: "2026-W42", scopes: { global: [row("dup/dup", 1)], "breakout:global": [row("dup/dup", 6)], "spiking:global": [row("s/s", 1)], "climbing:utilities": [row("u/u", 1)] } },
    ],
    { knownScopes: new Set(["global"]) }
  );
  assert.deepEqual(ranks.get("old/old"), { rank: 5, tier: "breakout", scope: "global", isoWeek: "2026-W39" });
  assert.equal(ranks.get("dup/dup").rank, 6);
  assert.equal(ranks.has("s/s"), false);
  assert.equal(ranks.has("u/u"), false);
});

test("buildShieldsEndpoint emits a shields.io endpoint document without the '#'", () => {
  assert.deepEqual(buildShieldsEndpoint({ message: "listed in NLP", color: "#6e7781" }), {
    schemaVersion: 1,
    label: "awesomemap",
    message: "listed in NLP",
    color: "6e7781",
  });
});
