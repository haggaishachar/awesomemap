import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProjectId, isValidProjectInput, buildSubmissionIssueBody, buildSubmissionIssueUrl } from "../app/shared/submit-project.js";

test("normalizeProjectId strips a github.com prefix and trailing slashes", () => {
  assert.equal(normalizeProjectId("https://github.com/facebook/react/"), "facebook/react");
  assert.equal(normalizeProjectId("  facebook/react  "), "facebook/react");
  assert.equal(normalizeProjectId(""), "");
});

test("isValidProjectInput accepts a bare or URL-form owner/repo and rejects everything else", () => {
  assert.equal(isValidProjectInput("facebook/react"), true);
  assert.equal(isValidProjectInput("https://github.com/facebook/react"), true);
  assert.equal(isValidProjectInput("not-a-repo"), false);
  assert.equal(isValidProjectInput("too/many/segments"), false);
  assert.equal(isValidProjectInput(""), false);
});

test("buildSubmissionIssueBody renders the headers suggest-a-project.md expects, in order", () => {
  const body = buildSubmissionIssueBody({ projectId: "facebook/react", targetMap: "Web Dev", why: "It's the most popular UI library." });
  assert.match(body, /\*\*Project\*\*\n\nhttps:\/\/github\.com\/facebook\/react/);
  assert.match(body, /\*\*Which map should it go in\?\*\*\n\nWeb Dev/);
  assert.match(body, /\*\*Why it fits\*\*\n\nIt's the most popular UI library\./);
  assert.ok(body.indexOf("**Project**") < body.indexOf("**Which map") && body.indexOf("**Which map") < body.indexOf("**Why it fits**"));
});

test("buildSubmissionIssueBody falls back to placeholder text for an empty targetMap/why", () => {
  const body = buildSubmissionIssueBody({ projectId: "facebook/react", targetMap: "", why: "" });
  assert.match(body, /\*\*Which map should it go in\?\*\*\n\nNot sure/);
  assert.match(body, /\*\*Why it fits\*\*\n\n\(no reason given\)/);
});

test("buildSubmissionIssueUrl points at the repo's issue tracker with the template, title, and body prefilled", () => {
  const url = buildSubmissionIssueUrl({
    repoUrl: "https://github.com/haggaishachar/awesomemap",
    projectId: "facebook/react",
    targetMap: "Web Dev",
    why: "Popular",
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://github.com/haggaishachar/awesomemap/issues/new");
  assert.equal(parsed.searchParams.get("template"), "suggest-a-project.md");
  assert.equal(parsed.searchParams.get("title"), "Suggest: facebook/react");
  assert.match(parsed.searchParams.get("body"), /facebook\/react/);
});
