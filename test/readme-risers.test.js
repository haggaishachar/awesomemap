// test/readme-risers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderRisersEntry,
  renderRisersList,
  updateReadme,
  withEventReason,
  RISERS_START_MARKER,
  RISERS_END_MARKER,
} from "../scripts/readme-risers.mjs";

function entry(overrides) {
  return {
    rank: 1,
    id: "owner/repo",
    name: "Project Name",
    image: null,
    desc: "A short description.",
    domain: "Data Science",
    domainShort: "Data Science",
    domainSlug: "data-science",
    currentStars: 12345,
    starDelta: 340,
    percentDelta: 2.8,
    rankDelta: 0,
    ...overrides,
  };
}

test("renderRisersEntry renders rank, a green up-arrow icon with a signed +N, name link, domain, desc, and stats", () => {
  const line = renderRisersEntry(entry({ rank: 3, rankDelta: 2 }));
  assert.match(line, /^3\. <img src="docs\/media\/arrow-up\.svg"[^>]*alt="up"[^>]*> \+2 /);
  assert.match(line, /\*\*\[Project Name\]\(https:\/\/awesomemap\.dev\/projects\/owner\/repo\/\)\*\*/);
  assert.match(line, /<sub>Data Science<\/sub>/);
  assert.match(line, /A short description\./);
  assert.match(line, /★ 12,345 \(\+340 · \+2\.8% this week\)/);
});

test("renderRisersEntry renders a red down-arrow icon with a signed -N for a negative rankDelta, and no sign for a shrinking starDelta", () => {
  const line = renderRisersEntry(entry({ rankDelta: -4, starDelta: -10, percentDelta: -0.5 }));
  assert.match(line, /^1\. <img src="docs\/media\/arrow-down\.svg"[^>]*alt="down"[^>]*> -4 /);
  assert.match(line, /★ 12,345 \(-10 · -0\.5% this week\)/);
});

test("renderRisersEntry renders a flat dash with no icon or number when rank didn't move", () => {
  const line = renderRisersEntry(entry({ rankDelta: 0 }));
  assert.match(line, /^1\. – /);
  assert.doesNotMatch(line, /<img src="docs\/media\/arrow/);
});

test("renderRisersEntry includes an <img> icon only when the project has one", () => {
  assert.match(renderRisersEntry(entry({ image: "https://example.com/icon.png" })), /<img src="https:\/\/example\.com\/icon\.png"/);
  assert.doesNotMatch(renderRisersEntry(entry({ image: null })), /<img /);
});

test("renderRisersEntry truncates a long description on a word boundary", () => {
  const longDesc = "word ".repeat(40).trim();
  const line = renderRisersEntry(entry({ desc: longDesc }));
  const truncated = line.match(/— (.*?) — ★/)[1];
  assert.ok(truncated.endsWith("…"));
  assert.ok(truncated.length <= 112);
});

test("renderRisersEntry escapes Markdown-sensitive characters in the name and description", () => {
  const line = renderRisersEntry(entry({ name: "Awesome[Lib]", desc: "Does *cool* things" }));
  assert.match(line, /\*\*\[Awesome\\\[Lib\\\]\]/);
  assert.match(line, /Does \\\*cool\\\* things/);
});

test("renderRisersEntry appends a news link with a friendly phrase when an eventReason is present", () => {
  const line = renderRisersEntry(entry({ eventReason: { type: "hn", title: "Show HN: repo", url: "https://news.ycombinator.com/item?id=1" } }));
  assert.match(line, /\[📰 Featured on Hacker News\]\(https:\/\/news\.ycombinator\.com\/item\?id=1\)$/);
});

test("renderRisersEntry omits the news link when there's no eventReason", () => {
  assert.doesNotMatch(renderRisersEntry(entry({})), /📰/);
});

test("renderRisersList joins one line per entry", () => {
  const list = renderRisersList([entry({ rank: 1 }), entry({ rank: 2, id: "owner/other", name: "Other" })]);
  assert.equal(list.split("\n").length, 2);
});

test("renderRisersList renders a placeholder for an empty leaderboard", () => {
  assert.match(renderRisersList([]), /Not enough star-history/);
});

test("withEventReason joins the most notable in-window event by candidate id, leaving others untouched", () => {
  const pool = [{ id: "a/a" }, { id: "b/b" }];
  const entitiesById = new Map([
    ["a/a", { events: [{ type: "hn", date: "2026-08-10", points: 50, url: "https://x", title: "t" }] }],
  ]);
  const result = withEventReason(pool, entitiesById, "2026-08-01");
  assert.equal(result[0].eventReason.type, "hn");
  assert.equal(result[1].eventReason, undefined);
});

test("updateReadme replaces only the content between the marker pair", () => {
  const readme = `# Title\n\nIntro.\n\n${RISERS_START_MARKER}\nold content\n${RISERS_END_MARKER}\n\nFooter.`;
  const updated = updateReadme(readme, "1. new entry");
  assert.equal(updated, `# Title\n\nIntro.\n\n${RISERS_START_MARKER}\n1. new entry\n${RISERS_END_MARKER}\n\nFooter.`);
});

test("updateReadme throws when the marker pair is missing", () => {
  assert.throws(() => updateReadme("# Title\n\nNo markers here.", "1. new entry"), /marker pair/);
});
