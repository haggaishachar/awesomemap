import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCompareRecord, buildCompareIndex } from "../scripts/compare-index.mjs";

const PROJECT = {
  id: "facebook/react",
  name: "React",
  domainSlug: "web-dev",
  domainShort: "Web Dev",
  image: "https://example.com/react.png",
  link: "https://react.dev",
  desc: "A JavaScript library for building user interfaces",
  tags: ["frontend", "javascript"],
  weight: 247895,
  growth: { rising7: { starDelta: 340, percentDelta: 0.14, oldestDate: "2026-08-01" } },
  hasEnoughHistory: { rising7: true },
};

test("buildCompareRecord copies the project's own fields through unchanged", () => {
  const record = buildCompareRecord(PROJECT, { historySeries: [], signalHeadline: "Growing steadily" });
  assert.equal(record.id, "facebook/react");
  assert.equal(record.name, "React");
  assert.equal(record.domainSlug, "web-dev");
  assert.equal(record.domainShort, "Web Dev");
  assert.equal(record.weight, 247895);
  assert.deepEqual(record.tags, ["frontend", "javascript"]);
  assert.deepEqual(record.growth, PROJECT.growth);
  assert.equal(record.signalHeadline, "Growing steadily");
});

test("buildCompareRecord pulls forks/openIssues from the latest history entry", () => {
  const historySeries = [
    { date: "2026-08-01", stars: 100, forks: 10, openIssues: 2 },
    { date: "2026-08-02", stars: 110, forks: 12, openIssues: 3 },
  ];
  const record = buildCompareRecord(PROJECT, { historySeries, signalHeadline: null });
  assert.equal(record.forks, 12);
  assert.equal(record.openIssues, 3);
});

test("buildCompareRecord defaults forks/openIssues to null with no history at all", () => {
  const record = buildCompareRecord(PROJECT, { historySeries: [], signalHeadline: null });
  assert.equal(record.forks, null);
  assert.equal(record.openIssues, null);
});

test("buildCompareRecord defaults forks/openIssues to null when the latest entry predates that capture", () => {
  const historySeries = [{ date: "2026-01-01", stars: 100 }];
  const record = buildCompareRecord(PROJECT, { historySeries, signalHeadline: null });
  assert.equal(record.forks, null);
  assert.equal(record.openIssues, null);
});

test("buildCompareIndex keys records by id", () => {
  const index = buildCompareIndex([
    buildCompareRecord(PROJECT, {}),
    buildCompareRecord({ ...PROJECT, id: "vuejs/core", name: "Vue" }, {}),
  ]);
  assert.deepEqual(Object.keys(index), ["facebook/react", "vuejs/core"]);
  assert.equal(index["vuejs/core"].name, "Vue");
});
