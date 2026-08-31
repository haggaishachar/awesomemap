// test/social-digest.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDigest, renderReadmeRisers, updateReadme } from "../scripts/social-digest.mjs";
import { computeLeaderboard } from "../scripts/leaderboard.mjs";

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

test("the digest's ranking (via computeLeaderboard) is normalized by score, not raw star count", () => {
  const domains = [
    {
      slug: "data-science",
      name: "Data Science",
      projects: [
        {
          id: "big/big",
          name: "Big Repo",
          link: "https://big.example",
          // Bigger absolute star gain (+330) but on a much larger repo, so
          // its score (normalized by sqrt(currentStars)) is lower than the
          // small repo's smaller absolute gain (+208) on a much smaller repo.
          history: [
            { date: "2026-08-05", stars: 50000 },
            { date: "2026-08-14", stars: 50200 },
            { date: "2026-08-15", stars: 50330 },
          ],
        },
        {
          id: "small/small",
          name: "Small Repo",
          link: "https://small.example",
          history: [
            { date: "2026-08-05", stars: 900 },
            { date: "2026-08-14", stars: 1000 },
            { date: "2026-08-15", stars: 1108 },
          ],
        },
      ],
    },
  ];
  const result = computeLeaderboard(domains, { scope: "global", windowDays: 7, limit: 5, now: "2026-08-15T00:00:00.000Z" });
  // small/small's score (208/sqrt(1108) ≈ 6.25) beats big/big's
  // (330/sqrt(50330) ≈ 1.47) despite the smaller absolute star count —
  // this is the intended behavior (same metric as the site's Rising mode
  // everywhere else), not a regression.
  assert.deepEqual(result.map((r) => r.id), ["small/small", "big/big"]);
});
