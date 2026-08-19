// test/leaderboard.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLeaderboard } from "../scripts/leaderboard.mjs";

const NOW = "2026-08-15T00:00:00.000Z";

const DOMAINS = [
  {
    slug: "data-science",
    name: "Data Science",
    projects: [
      { id: "a/a", name: "Project A", link: "https://a.example" },
      { id: "b/b", name: "Project B", link: "https://b.example" },
    ],
  },
  {
    slug: "security",
    name: "Security",
    projects: [{ id: "c/c", name: "Project C", link: "https://c.example" }],
  },
];

const HISTORY = {
  "data-science": {
    "a/a": [
      { date: "2026-08-05", stars: 100 },
      { date: "2026-08-14", stars: 110 },
      { date: "2026-08-15", stars: 150 },
    ],
    "b/b": [
      { date: "2026-08-05", stars: 500 },
      { date: "2026-08-14", stars: 600 },
      { date: "2026-08-15", stars: 610 },
    ],
  },
  security: {
    "c/c": [
      { date: "2026-08-05", stars: 50 },
      { date: "2026-08-14", stars: 80 },
      { date: "2026-08-15", stars: 200 },
    ],
  },
};

test("computeLeaderboard ranks by score descending and computes rank movement vs yesterday", () => {
  const result = computeLeaderboard(DOMAINS, HISTORY, { scope: "global", windowDays: 7, limit: 20, now: NOW });
  assert.deepEqual(result.map((r) => r.id), ["c/c", "b/b", "a/a"]);
  assert.deepEqual(result.map((r) => r.rank), [1, 2, 3]);

  const cRow = result.find((r) => r.id === "c/c");
  assert.equal(cRow.rankDelta, 1); // climbed from #2 (yesterday) to #1 (today)
  assert.equal(cRow.starDelta, 150);
  assert.equal(cRow.percentDelta, 300);

  const bRow = result.find((r) => r.id === "b/b");
  assert.equal(bRow.rankDelta, -1); // fell from #1 (yesterday) to #2 (today)

  const aRow = result.find((r) => r.id === "a/a");
  assert.equal(aRow.rankDelta, 0); // unchanged at #3
});

test("computeLeaderboard respects the limit", () => {
  const result = computeLeaderboard(DOMAINS, HISTORY, { scope: "global", windowDays: 7, limit: 2, now: NOW });
  assert.deepEqual(result.map((r) => r.id), ["c/c", "b/b"]);
});

test("computeLeaderboard scoped to one domain only ranks that domain's projects", () => {
  const result = computeLeaderboard(DOMAINS, HISTORY, { scope: "data-science", windowDays: 7, limit: 20, now: NOW });
  assert.deepEqual(result.map((r) => r.id), ["b/b", "a/a"]);
});

test("computeLeaderboard excludes a project with enough history today but not enough as of yesterday", () => {
  const domains = [
    {
      slug: "data-science",
      name: "Data Science",
      projects: [{ id: "d/d", name: "Project D", link: "https://d.example" }],
    },
  ];
  const history = {
    "data-science": {
      "d/d": [
        { date: "2026-08-08", stars: 10 }, // exactly at today's 7-day cutoff, but after yesterday's
        { date: "2026-08-15", stars: 500 },
      ],
    },
  };
  const result = computeLeaderboard(domains, history, { scope: "global", windowDays: 7, limit: 20, now: NOW });
  assert.deepEqual(result, []);
});

test("computeLeaderboard returns an empty list for a domain with no history yet", () => {
  const domains = [{ slug: "data-science", name: "Data Science", projects: [{ id: "a/a", name: "Project A", link: "https://a.example" }] }];
  const result = computeLeaderboard(domains, {}, { scope: "global", windowDays: 7, limit: 20, now: NOW });
  assert.deepEqual(result, []);
});

test("computeLeaderboard dedupes a project listed in multiple domains, keeping its best-scoring listing", () => {
  const domains = [
    { slug: "data-science", name: "Data Science", projects: [{ id: "e/e", name: "Project E", link: "https://e.example" }] },
    { slug: "security", name: "Security", projects: [{ id: "e/e", name: "Project E", link: "https://e.example" }] },
  ];
  const history = {
    "data-science": {
      "e/e": [
        { date: "2026-08-05", stars: 1000 },
        { date: "2026-08-14", stars: 1005 },
        { date: "2026-08-15", stars: 1010 },
      ],
    },
    security: {
      "e/e": [
        { date: "2026-08-05", stars: 20 },
        { date: "2026-08-14", stars: 25 },
        { date: "2026-08-15", stars: 100 },
      ],
    },
  };
  const result = computeLeaderboard(domains, history, { scope: "global", windowDays: 7, limit: 20, now: NOW });
  assert.equal(result.length, 1);
  assert.equal(result[0].domain, "Security");
  assert.equal(result[0].starDelta, 80);
});

test("computeLeaderboard keeps ranks contiguous (1..N) and rankDelta accurate when a today-only candidate is excluded", () => {
  const domains = [
    {
      slug: "data-science",
      name: "Data Science",
      projects: [
        { id: "a/a", name: "Project A", link: "https://a.example" },
        { id: "b/b", name: "Project B", link: "https://b.example" },
        { id: "g/g", name: "Project G", link: "https://g.example" },
      ],
    },
  ];
  const history = {
    "data-science": {
      "a/a": [
        { date: "2026-08-05", stars: 100 },
        { date: "2026-08-14", stars: 110 },
        { date: "2026-08-15", stars: 150 },
      ],
      "b/b": [
        { date: "2026-08-05", stars: 500 },
        { date: "2026-08-14", stars: 600 },
        { date: "2026-08-15", stars: 610 },
      ],
      "g/g": [
        { date: "2026-08-08", stars: 10 },
        { date: "2026-08-15", stars: 1000 },
      ],
    },
  };
  const result = computeLeaderboard(domains, history, { scope: "global", windowDays: 7, limit: 20, now: NOW });
  // g/g has a huge score today (~31.3, from a starDelta of 990 on 1000 current
  // stars) but no rank yesterday (its only history entry old enough for
  // today's 7-day window is exactly at today's cutoff, one day too late for
  // yesterday's), so it must not appear in the result — and its exclusion
  // must not leave a gap in a/a and b/b's rank numbers.
  assert.deepEqual(result.map((r) => r.id), ["b/b", "a/a"]);
  assert.deepEqual(result.map((r) => r.rank), [1, 2]);
});

test("computeLeaderboard excludes a project with flat or declining stars, even with enough history", () => {
  const domains = [
    {
      slug: "data-science",
      name: "Data Science",
      projects: [{ id: "f/f", name: "Project F", link: "https://f.example" }],
    },
  ];
  const history = {
    "data-science": {
      "f/f": [
        { date: "2026-08-05", stars: 200 },
        { date: "2026-08-14", stars: 190 },
        { date: "2026-08-15", stars: 180 },
      ],
    },
  };
  const result = computeLeaderboard(domains, history, { scope: "global", windowDays: 7, limit: 20, now: NOW });
  assert.deepEqual(result, []);
});
