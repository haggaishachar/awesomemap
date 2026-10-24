import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestArchivedRanks,
  isoWeekMonth,
  pickBadge,
  renderBadgeSvg,
  buildShieldsEndpoint,
  buildBadgeSnippets,
  textWidth,
} from "../scripts/badges.mjs";

const row = (id, rank) => ({ id, rank, name: id });

test("bestArchivedRanks keeps each project's lowest rank across weeks and tiered scopes", () => {
  const ranks = bestArchivedRanks([
    { isoWeek: "2026-W41", scopes: { "breakout:global": [row("a/a", 4)], "climbing:web-dev": [row("a/a", 2), row("b/b", 1)] } },
    { isoWeek: "2026-W42", scopes: { "breakout:global": [row("a/a", 3)] } },
  ]);
  assert.deepEqual(ranks.get("a/a"), { rank: 2, tier: "climbing", scope: "web-dev", isoWeek: "2026-W41" });
  assert.deepEqual(ranks.get("b/b"), { rank: 1, tier: "climbing", scope: "web-dev", isoWeek: "2026-W41" });
});

test("bestArchivedRanks prefers a global rank over a domain rank of the same number, then the earliest week", () => {
  const ranks = bestArchivedRanks([
    { isoWeek: "2026-W42", scopes: { "breakout:global": [row("a/a", 1)] } },
    { isoWeek: "2026-W40", scopes: { "breakout:ai": [row("a/a", 1)] } },
    { isoWeek: "2026-W41", scopes: { "breakout:global": [row("a/a", 1)] } },
  ]);
  assert.deepEqual(ranks.get("a/a"), { rank: 1, tier: "breakout", scope: "global", isoWeek: "2026-W41" });
});

test("bestArchivedRanks reads a pre-tier snapshot's plain scope keys as Breakout, and skips them (copies) in tiered snapshots", () => {
  const ranks = bestArchivedRanks([
    { isoWeek: "2026-W39", scopes: { global: [row("old/old", 5)] } },
    { isoWeek: "2026-W42", scopes: { global: [row("dup/dup", 1)], "breakout:global": [row("dup/dup", 6)] } },
  ]);
  assert.equal(ranks.get("old/old").tier, "breakout");
  assert.equal(ranks.get("old/old").rank, 5);
  assert.equal(ranks.get("dup/dup").rank, 6);
});

test("bestArchivedRanks ignores Spiking and, given knownScopes, removed domains", () => {
  const ranks = bestArchivedRanks(
    [{ isoWeek: "2026-W42", scopes: { "spiking:global": [row("a/a", 1)], "climbing:utilities": [row("a/a", 1)], "giants:ai": [row("a/a", 9)] } }],
    { knownScopes: new Set(["global", "ai"]) }
  );
  assert.deepEqual(ranks.get("a/a"), { rank: 9, tier: "giants", scope: "ai", isoWeek: "2026-W42" });
});

test("isoWeekMonth names the month the week closes in", () => {
  assert.equal(isoWeekMonth("2026-W42"), "Oct 2026");
  assert.equal(isoWeekMonth("2026-W01"), "Jan 2026");
});

test("pickBadge shows a live rank as 'this week' in green", () => {
  const badge = pickBadge({ liveRanks: [{ rank: 3, tier: "breakout", scope: "ai" }], domainShort: "AI" });
  assert.deepEqual(badge, { label: "awesomemap", message: "#3 Breakout in AI · this week", color: "#1a8a4a" });
});

test("pickBadge shows the better of live and archived ranks — a past #1 outranks a live #12", () => {
  const badge = pickBadge({
    liveRanks: [{ rank: 12, tier: "climbing", scope: "ai" }],
    peak: { rank: 1, tier: "giants", scope: "global", isoWeek: "2026-W40" },
    domainShort: "AI",
  });
  assert.equal(badge.message, "#1 Giant overall · Oct 2026");
  assert.equal(badge.color, "#2b5fad");
});

test("pickBadge prefers the live rank on a tie, and names a peak's own domain", () => {
  assert.equal(
    pickBadge({ liveRanks: [{ rank: 2, tier: "breakout", scope: "ai" }], peak: { rank: 2, tier: "breakout", scope: "ai", isoWeek: "2026-W40" }, domainShort: "AI" }).message,
    "#2 Breakout in AI · this week"
  );
  assert.equal(
    pickBadge({ peak: { rank: 4, tier: "breakout", scope: "web-dev", isoWeek: "2026-W40" }, domainShort: "AI", domainShortBySlug: { "web-dev": "Web" } }).message,
    "#4 Breakout in Web · Oct 2026"
  );
});

test("pickBadge falls back to a gray 'Listed in' badge for a project that never ranked", () => {
  assert.deepEqual(pickBadge({ domainShort: "Security" }), { label: "awesomemap", message: "Listed in Security", color: "#6b7280" });
});

test("renderBadgeSvg sizes both halves to their text and escapes the message", () => {
  const svg = renderBadgeSvg({ label: "awesomemap", message: "#1 <Breakout> & co", color: "#1a8a4a" });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20"/);
  assert.match(svg, /&lt;Breakout&gt; &amp; co/);
  assert.doesNotMatch(svg, /<Breakout>/);
  const width = Number(svg.match(/width="(\d+)"/)[1]);
  assert.equal(width, 6 + 14 + 4 + textWidth("awesomemap") + 6 + 6 + textWidth("#1 <Breakout> & co") + 6);
  assert.match(svg, /fill="#1a8a4a"/);
  assert.match(svg, /textLength=/);
});

test("textWidth grows with text and treats narrow glyphs as narrower", () => {
  assert.ok(textWidth("iiii") < textWidth("mmmm"));
  assert.ok(textWidth("awesomemap") > 50);
});

test("buildShieldsEndpoint emits a shields.io endpoint document without the '#'", () => {
  assert.deepEqual(buildShieldsEndpoint({ label: "awesomemap", message: "Listed in AI", color: "#6b7280" }), {
    schemaVersion: 1,
    label: "awesomemap",
    message: "Listed in AI",
    color: "6b7280",
  });
});

test("buildBadgeSnippets builds Markdown, HTML, and shields.io snippets linking back to the project page", () => {
  const snippets = buildBadgeSnippets({
    badgeUrl: "https://awesomemap.dev/badges/a/b.svg",
    projectUrl: "https://awesomemap.dev/projects/a/b/",
    endpointUrl: "https://awesomemap.dev/badges/a/b.json",
  });
  assert.equal(snippets.markdown, "[![awesomemap](https://awesomemap.dev/badges/a/b.svg)](https://awesomemap.dev/projects/a/b/)");
  assert.equal(snippets.html, '<a href="https://awesomemap.dev/projects/a/b/"><img src="https://awesomemap.dev/badges/a/b.svg" alt="awesomemap" /></a>');
  assert.equal(
    snippets.shields,
    "[![awesomemap](https://img.shields.io/endpoint?url=https%3A%2F%2Fawesomemap.dev%2Fbadges%2Fa%2Fb.json&style=for-the-badge)](https://awesomemap.dev/projects/a/b/)"
  );
});
