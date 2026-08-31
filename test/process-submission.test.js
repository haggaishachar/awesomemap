import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSubmissionIssueBody, resolveDomainHint, qualityBarFailureReasons, formatSubmissionComment } from "../scripts/process-submission.mjs";

const TEMPLATE_BODY = [
  "**Project**",
  "",
  "https://github.com/facebook/react",
  "",
  "**Which map should it go in?**",
  "",
  "Web Dev",
  "",
  "**Why it fits**",
  "",
  "It's the most popular UI library.",
].join("\n");

test("parseSubmissionIssueBody extracts projectId, targetMapHint, and why from a filled-in template", () => {
  assert.deepEqual(parseSubmissionIssueBody(TEMPLATE_BODY), {
    projectId: "facebook/react",
    targetMapHint: "Web Dev",
    why: "It's the most popular UI library.",
  });
});

test("parseSubmissionIssueBody normalizes a bare owner/repo id under Project", () => {
  const body = "**Project**\n\nfacebook/react\n\n**Which map should it go in?**\n\nNot sure\n\n**Why it fits**\n\n(no reason given)";
  assert.deepEqual(parseSubmissionIssueBody(body), { projectId: "facebook/react", targetMapHint: null, why: null });
});

test("parseSubmissionIssueBody extracts a URL from a Markdown link", () => {
  const body = "**Project**\n\n[React](https://github.com/facebook/react)\n\n**Which map should it go in?**\n\nWeb Dev\n\n**Why it fits**\n\nGreat lib";
  assert.equal(parseSubmissionIssueBody(body).projectId, "facebook/react");
});

test("parseSubmissionIssueBody returns null when no Project field is present", () => {
  assert.equal(parseSubmissionIssueBody("Just some random issue text with no headers."), null);
});

test("parseSubmissionIssueBody returns null when the Project field has no resolvable repo", () => {
  const body = "**Project**\n\n<!-- GitHub repo URL, e.g. https://github.com/owner/repo -->\n\n**Which map should it go in?**\n\nWeb Dev";
  assert.equal(parseSubmissionIssueBody(body), null);
});

test("parseSubmissionIssueBody skips a multi-line <!-- --> placeholder entirely, not just its first line", () => {
  const body = [
    "**Project**",
    "",
    "https://github.com/facebook/react",
    "",
    "**Which map should it go in?**",
    "",
    "<!-- One of: AI, Data Science, Databases, DevOps & Infra, Mobile Dev,",
    "     Security, IoT & Smart Home, Web Dev, Automation — or \"not sure\" if",
    "     you're not certain which fits best. -->",
    "",
    "**Why it fits**",
    "",
    "<!-- A sentence or two: what does it do, and why does it belong here?",
    "     Real, actively maintained projects only — forks, archived repos, and",
    "     personal toy projects don't make the cut. -->",
  ].join("\n");
  assert.deepEqual(parseSubmissionIssueBody(body), { projectId: "facebook/react", targetMapHint: null, why: null });
});

test("parseSubmissionIssueBody treats 'Not sure' and the placeholder why text as absent", () => {
  const body = "**Project**\n\nfacebook/react\n\n**Which map should it go in?**\n\nNot sure\n\n**Why it fits**\n\n(no reason given)";
  const parsed = parseSubmissionIssueBody(body);
  assert.equal(parsed.targetMapHint, null);
  assert.equal(parsed.why, null);
});

const DOMAINS = [
  { slug: "web-dev", shortName: "Web Dev", name: "Best Web Development Open Source Projects" },
  { slug: "data-science", shortName: "Data Science", name: "Best Data Science Open Source Projects" },
];

test("resolveDomainHint matches by slug, shortName, or name, case-insensitively", () => {
  assert.equal(resolveDomainHint("web-dev", DOMAINS), DOMAINS[0]);
  assert.equal(resolveDomainHint("web dev", DOMAINS), DOMAINS[0]);
  assert.equal(resolveDomainHint("DATA SCIENCE", DOMAINS), DOMAINS[1]);
});

test("resolveDomainHint falls back to a substring match", () => {
  assert.equal(resolveDomainHint("I think Web Dev is right", DOMAINS), DOMAINS[0]);
});

test("resolveDomainHint returns null for an empty or unmatched hint", () => {
  assert.equal(resolveDomainHint(null, DOMAINS), null);
  assert.equal(resolveDomainHint("", DOMAINS), null);
  assert.equal(resolveDomainHint("Astrology", DOMAINS), null);
});

test("qualityBarFailureReasons is empty for a repo that clears every bar", () => {
  const meta = { stars: 1000, isFork: false, isArchived: false, hasLicense: true, pushedAt: "2026-08-01T00:00:00Z" };
  assert.deepEqual(qualityBarFailureReasons(meta, { now: new Date("2026-08-31") }), []);
});

test("qualityBarFailureReasons lists every failing reason together", () => {
  const meta = { stars: 10, isFork: true, isArchived: true, hasLicense: false, pushedAt: "2020-01-01T00:00:00Z" };
  const reasons = qualityBarFailureReasons(meta, { now: new Date("2026-08-31") });
  assert.equal(reasons.length, 5);
  assert.match(reasons[0], /only 10 stars/);
  assert.ok(reasons.includes("it's a fork"));
  assert.ok(reasons.includes("it's archived"));
  assert.ok(reasons.includes("no license"));
  assert.match(reasons[4], /no commits in the last 12 months/);
});

test("formatSubmissionComment renders each outcome type distinctly", () => {
  assert.match(formatSubmissionComment({ type: "committed", id: "a/a", domainName: "Web Dev", path: ["Utility Libraries"] }), /Added \*\*a\/a\*\* to Web Dev under "Utility Libraries"/);
  assert.match(formatSubmissionComment({ type: "already-exists", id: "a/a" }), /already curated/);
  assert.match(formatSubmissionComment({ type: "quality-bar-failed", id: "a/a", reasons: ["only 10 stars (500+ required)"] }), /only 10 stars/);
  assert.match(formatSubmissionComment({ type: "no-fit", id: "a/a", reason: "too niche" }), /doesn't clearly fit any current map/);
  assert.match(formatSubmissionComment({ type: "invalid", id: "a/a", reason: "404" }), /Couldn't resolve/);
  assert.match(formatSubmissionComment({ type: "unparseable" }), /Couldn't parse this issue/);
});
