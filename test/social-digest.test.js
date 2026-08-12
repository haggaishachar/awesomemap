import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTopRisers, formatDigest } from "../scripts/social-digest.mjs";

const NOW = "2026-08-15T00:00:00.000Z";

const DOMAINS = [
  {
    slug: "data-science",
    name: "Data Science",
    tools: [
      { id: "a/a", name: "Tool A", link: "https://a.example" },
      { id: "b/b", name: "Tool B", link: "https://b.example" },
    ],
  },
  {
    slug: "security",
    name: "Security",
    tools: [{ id: "c/c", name: "Tool C", link: "https://c.example" }],
  },
];

test("computeTopRisers ranks tools by star delta, descending, across domains", () => {
  const history = {
    "data-science": {
      "a/a": [
        { date: "2026-08-08", stars: 100 },
        { date: "2026-08-15", stars: 130 },
      ],
      "b/b": [
        { date: "2026-08-08", stars: 500 },
        { date: "2026-08-15", stars: 520 },
      ],
    },
    security: {
      "c/c": [
        { date: "2026-08-08", stars: 50 },
        { date: "2026-08-15", stars: 90 },
      ],
    },
  };

  const result = computeTopRisers(DOMAINS, history, { now: NOW });
  assert.deepEqual(
    result.map((r) => r.id),
    ["c/c", "a/a", "b/b"]
  );
  assert.equal(result[0].starDelta, 40);
});

test("computeTopRisers excludes tools without enough history for the window", () => {
  const history = {
    "data-science": { "a/a": [{ date: "2026-08-14", stars: 100 }] },
    security: {},
  };
  const result = computeTopRisers(DOMAINS, history, { now: NOW });
  assert.deepEqual(result, []);
});

test("computeTopRisers excludes tools that shrank or stayed flat", () => {
  const history = {
    "data-science": {
      "a/a": [
        { date: "2026-08-08", stars: 100 },
        { date: "2026-08-15", stars: 90 },
      ],
    },
    security: {},
  };
  const result = computeTopRisers(DOMAINS, history, { now: NOW });
  assert.deepEqual(result, []);
});

test("computeTopRisers respects the limit", () => {
  const history = {
    "data-science": {
      "a/a": [
        { date: "2026-08-08", stars: 100 },
        { date: "2026-08-15", stars: 130 },
      ],
      "b/b": [
        { date: "2026-08-08", stars: 500 },
        { date: "2026-08-15", stars: 520 },
      ],
    },
    security: {
      "c/c": [
        { date: "2026-08-08", stars: 50 },
        { date: "2026-08-15", stars: 90 },
      ],
    },
  };
  const result = computeTopRisers(DOMAINS, history, { now: NOW, limit: 1 });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "c/c");
});

test("formatDigest renders a numbered list with links and percentages", () => {
  const body = formatDigest(
    [{ id: "a/a", name: "Tool A", link: "https://a.example", domain: "Data Science", starDelta: 30, percentDelta: 30 }],
    { windowDays: 7 }
  );
  assert.match(body, /1\. \*\*\[Tool A\]\(https:\/\/a\.example\)\*\* \(Data Science\) — \+30 stars \(\+30\.0%\)/);
  assert.match(body, /last 7 days/);
});

test("formatDigest returns a not-ready placeholder for an empty list", () => {
  const body = formatDigest([], { windowDays: 7 });
  assert.match(body, /Not enough star-history yet/);
  assert.match(body, /7-day/);
});
