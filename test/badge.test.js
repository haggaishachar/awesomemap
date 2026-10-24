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
