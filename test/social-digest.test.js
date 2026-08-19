// test/social-digest.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDigest, renderReadmeRisers, updateReadme } from "../scripts/social-digest.mjs";

test("formatDigest renders a numbered list with links and percentages", () => {
  const body = formatDigest(
    [{ id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 30, percentDelta: 30 }],
    { windowDays: 7 }
  );
  assert.match(body, /1\. \*\*\[Project A\]\(https:\/\/a\.example\)\*\* \(Data Science\) — \+30 stars \(\+30\.0%\)/);
  assert.match(body, /last 7 days/);
});

test("formatDigest returns a not-ready placeholder for an empty list", () => {
  const body = formatDigest([], { windowDays: 7 });
  assert.match(body, /Not enough star-history yet/);
  assert.match(body, /7-day/);
});

test("renderReadmeRisers renders a numbered list without the digest intro line", () => {
  const section = renderReadmeRisers(
    [{ id: "a/a", name: "Project A", link: "https://a.example", domain: "Data Science", starDelta: 30, percentDelta: 30 }],
    { windowDays: 7 }
  );
  assert.match(section, /^1\. \*\*\[Project A\]\(https:\/\/a\.example\)\*\* \(Data Science\) — \+30 stars \(\+30\.0%\)$/);
  assert.doesNotMatch(section, /Biggest risers on/);
});

test("renderReadmeRisers returns a not-ready placeholder for an empty list", () => {
  const section = renderReadmeRisers([], { windowDays: 7 });
  assert.match(section, /Not enough star-history yet/);
  assert.match(section, /7-day/);
});

test("updateReadme replaces the content between the risers markers", () => {
  const readme = ["# awesomemap", "", "<!-- risers:start -->", "old content", "<!-- risers:end -->", "", "## Next section"].join("\n");
  const result = updateReadme(readme, "new content");
  assert.equal(result, ["# awesomemap", "", "<!-- risers:start -->", "new content", "<!-- risers:end -->", "", "## Next section"].join("\n"));
});

test("updateReadme throws when the markers are missing", () => {
  assert.throws(() => updateReadme("# awesomemap", "new content"), /risers markers not found/);
});
