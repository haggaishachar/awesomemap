// test/readme-risers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderRisersEntry,
  renderRisersList,
  updateReadme,
  withEventReason,
  formatCompact,
  README_RISERS_VISIBLE,
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
    score: 1,
    ...overrides,
  };
}

test("renderRisersEntry renders a headline line (rank, name link, up-arrow, growth, bar, stars) and a small detail line", () => {
  const [headline, detail] = renderRisersEntry(entry({ rank: 3, rankDelta: 2, domainSlug: "data-science" })).split("<br>");
  assert.match(headline, /^\*\*3\.\*\* <img /);
  assert.match(headline, /\*\*\[Project Name\]\(https:\/\/awesomemap\.dev\/projects\/owner\/repo\/\)\*\* <img src="docs\/media\/arrow-up\.svg"[^>]*alt="up"[^>]*>2 /);
  assert.match(headline, /`\+2\.8%` ▰{8} ★ 12\.3k \(\+340\)$/);
  assert.equal(detail, "<sub>📊 Data Science · A short description.</sub>");
});

test("renderRisersEntry renders a red down-arrow for a negative rankDelta, and no sign for a shrinking starDelta", () => {
  const line = renderRisersEntry(entry({ rankDelta: -4, starDelta: -10, percentDelta: -0.5 }));
  assert.match(line, /<img src="docs\/media\/arrow-down\.svg"[^>]*alt="down"[^>]*>4 /);
  assert.match(line, /`-0\.5%` .* ★ 12\.3k \(-10\)/);
});

test("renderRisersEntry shows no arrow when rank didn't move", () => {
  assert.doesNotMatch(renderRisersEntry(entry({ rankDelta: 0 })), /arrow-(up|down)/);
});

test("renderRisersEntry uses the project's image, falling back to its owner's GitHub avatar", () => {
  assert.match(renderRisersEntry(entry({ image: "https://example.com/icon.png" })), /<img src="https:\/\/example\.com\/icon\.png"/);
  assert.match(renderRisersEntry(entry({ image: null })), /<img src="https:\/\/github\.com\/owner\.png\?size=40"/);
});

test("renderRisersEntry scales the score bar to topScore, never leaving it empty", () => {
  assert.match(renderRisersEntry(entry({ score: 5 }), { topScore: 10 }), / ▰{4}▱{4} /);
  assert.match(renderRisersEntry(entry({ score: 0.01 }), { topScore: 10 }), / ▰▱{7} /);
});

test("renderRisersEntry truncates a long description on a word boundary", () => {
  const longDesc = "word ".repeat(40).trim();
  const detail = renderRisersEntry(entry({ desc: longDesc })).split("<br>")[1];
  const truncated = detail.match(/ · (.*?)<\/sub>/)[1];
  assert.ok(truncated.endsWith("…"));
  assert.ok(truncated.length <= 91);
});

test("renderRisersEntry shows just the domain name when the domain has no emoji, and omits a missing description", () => {
  assert.equal(renderRisersEntry(entry({ domainSlug: "new-domain", desc: "" })).split("<br>")[1], "<sub>Data Science</sub>");
});

test("renderRisersEntry escapes Markdown-sensitive characters in the name and description", () => {
  const line = renderRisersEntry(entry({ name: "Awesome[Lib]", desc: "Does *cool* things" }));
  assert.match(line, /\*\*\[Awesome\\\[Lib\\\]\]/);
  assert.match(line, /Does \\\*cool\\\* things/);
});

test("renderRisersEntry appends a news link with a friendly phrase when an eventReason is present", () => {
  const line = renderRisersEntry(entry({ eventReason: { type: "hn", title: "Show HN: repo", url: "https://news.ycombinator.com/item?id=1" } }));
  assert.match(line, / · \[📰 Featured on Hacker News\]\(https:\/\/news\.ycombinator\.com\/item\?id=1\)<\/sub>$/);
});

test("renderRisersEntry omits the news link when there's no eventReason", () => {
  assert.doesNotMatch(renderRisersEntry(entry({})), /📰/);
});

test("renderRisersList separates entries with blank lines and leaves a short list fully open", () => {
  const list = renderRisersList([entry({ rank: 1 }), entry({ rank: 2, id: "owner/other", name: "Other" })]);
  assert.equal(list.split("\n\n").length, 2);
  assert.doesNotMatch(list, /<details>/);
});

test("renderRisersList folds everything past the visible top slice into a collapsed <details> block", () => {
  const entries = Array.from({ length: README_RISERS_VISIBLE + 3 }, (_, i) => entry({ rank: i + 1, id: `owner/r${i}`, name: `R${i}` }));
  const list = renderRisersList(entries);
  const [open, folded] = list.split("<details>");
  assert.equal(open.trim().split("\n\n").length, README_RISERS_VISIBLE);
  assert.match(folded, new RegExp(`<summary><b>Show ranks ${README_RISERS_VISIBLE + 1}–${README_RISERS_VISIBLE + 3}</b></summary>`));
  assert.ok(list.endsWith("</details>"));
});

test("renderRisersList scales every bar to the #1 entry's score", () => {
  const list = renderRisersList([entry({ rank: 1, score: 8 }), entry({ rank: 2, score: 2, id: "owner/other" })]);
  assert.match(list.split("\n\n")[1], / ▰{2}▱{6} /);
});

test("formatCompact abbreviates thousands and millions to one decimal", () => {
  assert.equal(formatCompact(950), "950");
  assert.equal(formatCompact(31005), "31.0k");
  assert.equal(formatCompact(-1500), "-1.5k");
  assert.equal(formatCompact(1_234_567), "1.2M");
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
