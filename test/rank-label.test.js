// test/rank-label.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDomainRank } from "../app/shared/rank-label.js";

test("formatDomainRank names the project's own tier, singular", () => {
  assert.equal(formatDomainRank({ tier: "breakout", rank: 3 }, { windowDays: "7", domainShort: "AI" }), "#3 Breakout in AI over 7 days");
  assert.equal(formatDomainRank({ tier: "climbing", rank: 5 }, { windowDays: "30", domainShort: "AI" }), "#5 Climbing in AI over 30 days");
  assert.equal(formatDomainRank({ tier: "giants", rank: 2 }, { windowDays: "7", domainShort: "AI" }), "#2 Giant in AI over 7 days");
});

test("formatDomainRank falls back to 'this domain' and returns null without a rank", () => {
  assert.equal(formatDomainRank({ tier: "breakout", rank: 1 }, { windowDays: "7" }), "#1 Breakout in this domain over 7 days");
  assert.equal(formatDomainRank(null, { windowDays: "7", domainShort: "AI" }), null);
  assert.equal(formatDomainRank(undefined, { windowDays: "7", domainShort: "AI" }), null);
});
