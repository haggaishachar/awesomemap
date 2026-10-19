import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRisingFeed } from "../scripts/rss.mjs";

const SNAPSHOTS = [
  {
    isoWeek: "2026-W38",
    generatedAt: "2026-09-21T08:00:00.000Z",
    scopes: { global: [{ id: "a/a", name: "Project A", domain: "Data Science", starDelta: 100, percentDelta: 10 }] },
  },
  {
    isoWeek: "2026-W39",
    generatedAt: "2026-09-28T08:00:00.000Z",
    scopes: { global: [{ id: "b/b", name: "Project B", domain: "Security", starDelta: 200, percentDelta: 20 }] },
  },
];

test("buildRisingFeed returns null when siteUrl is empty", () => {
  assert.equal(buildRisingFeed(SNAPSHOTS, { siteUrl: "" }), null);
});

test("buildRisingFeed emits one item per archived week, newest first", () => {
  const xml = buildRisingFeed(SNAPSHOTS, { siteUrl: "https://example.com" });
  const firstWeekIndex = xml.indexOf("2026-W39");
  const secondWeekIndex = xml.indexOf("2026-W38");
  assert.ok(firstWeekIndex > -1 && secondWeekIndex > -1);
  assert.ok(firstWeekIndex < secondWeekIndex, "newest week should appear first");
});

test("buildRisingFeed links each item at its archive page URL", () => {
  const xml = buildRisingFeed(SNAPSHOTS, { siteUrl: "https://example.com", basePath: "/awesomemap" });
  assert.match(xml, /<link>https:\/\/example\.com\/awesomemap\/rising\/archive\/2026-W39\/<\/link>/);
});

test("buildRisingFeed escapes riser names into the description", () => {
  const xml = buildRisingFeed(
    [
      {
        isoWeek: "2026-W39",
        generatedAt: "2026-09-28T08:00:00.000Z",
        scopes: { global: [{ id: "a/a", name: "A & B <script>", domain: "Data Science", starDelta: 5, percentDelta: 1 }] },
      },
    ],
    { siteUrl: "https://example.com" },
  );
  assert.match(xml, /A &amp;amp; B &amp;lt;script&amp;gt;/);
});

test("buildRisingFeed reports a placeholder description for a week with no risers", () => {
  const xml = buildRisingFeed([{ isoWeek: "2026-W39", generatedAt: "2026-09-28T08:00:00.000Z", scopes: { global: [] } }], { siteUrl: "https://example.com" });
  assert.match(xml, /Not enough star-history yet/);
});

test("buildRisingFeed lists a tiered snapshot's Breakout risers and its biggest spike", () => {
  const xml = buildRisingFeed(
    [
      {
        isoWeek: "2026-W43",
        generatedAt: "2026-10-26T08:00:00.000Z",
        scopes: {
          global: [{ id: "old/old", name: "Legacy Copy", domain: "AI", starDelta: 1, percentDelta: 1 }],
          "breakout:global": [{ id: "a/a", name: "Small One", domain: "AI", starDelta: 300, percentDelta: 40 }],
          "spiking:global": [{ id: "s/s", name: "Spiker", domain: "Security", starDelta: 5554, percentDelta: 21.8 }],
        },
      },
    ],
    { siteUrl: "https://example.com" }
  );
  assert.match(xml, /Small One/);
  assert.doesNotMatch(xml, /Legacy Copy/);
  assert.match(xml, /Biggest spike: Spiker \(\+5554 stars this week\)/);
});

test("buildRisingFeed falls back to scopes.global and omits the spike line for a pre-tier snapshot", () => {
  const xml = buildRisingFeed(SNAPSHOTS, { siteUrl: "https://example.com" });
  assert.match(xml, /Project B/);
  assert.doesNotMatch(xml, /Biggest spike/);
});
