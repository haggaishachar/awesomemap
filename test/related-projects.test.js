import { test } from "node:test";
import assert from "node:assert/strict";
import { relatednessScore, pickRelatedProjects } from "../scripts/related-projects.mjs";

const project = (id, { domainSlug = "ai", path = ["LLM"], tags = [], weight = 100, gain = null } = {}) => ({
  id,
  domainSlug,
  path,
  tags,
  weight,
  growth: { rising7: { starDelta: gain ?? 0 } },
  hasEnoughHistory: { rising7: gain !== null },
});

test("relatednessScore ranks a deeper shared category above a top-level one, and counts shared tags", () => {
  const self = project("s/s", { path: ["LLM", "Agents"], tags: ["mcp", "rag"] });
  const sibling = project("a/a", { path: ["LLM", "Agents"] });
  const cousin = project("b/b", { path: ["LLM", "Inference"] });
  const tagged = project("c/c", { domainSlug: "web-dev", path: ["Frameworks"], tags: ["mcp", "rag"] });
  assert.ok(relatednessScore(self, sibling) > relatednessScore(self, cousin));
  assert.equal(relatednessScore(self, tagged), 2);
});

test("relatednessScore is 0 for a project that only shares the domain", () => {
  assert.equal(relatednessScore(project("s/s", { path: ["LLM"] }), project("a/a", { path: ["Vision"] })), 0);
});

test("relatednessScore ignores a matching category name in another domain", () => {
  assert.equal(relatednessScore(project("s/s", { path: ["Testing"] }), project("a/a", { domainSlug: "mobile-dev", path: ["Testing"] })), 0);
});

test("pickRelatedProjects skips the project itself and unrelated ones, orders by score, then weekly gain, then stars", () => {
  const self = project("s/s", { path: ["LLM", "Agents"] });
  const candidates = [
    self,
    project("big/steady", { path: ["LLM"], weight: 9000, gain: 10 }),
    project("small/hot", { path: ["LLM"], weight: 50, gain: 400 }),
    project("close/one", { path: ["LLM", "Agents"], weight: 1 }),
    project("far/away", { path: ["Vision"] }),
    project("big/untracked", { path: ["LLM"], weight: 99999 }),
  ];
  assert.deepEqual(
    pickRelatedProjects(self, candidates).map((p) => p.id),
    ["close/one", "small/hot", "big/steady", "big/untracked"]
  );
  assert.equal(pickRelatedProjects(self, candidates, { limit: 2 }).length, 2);
});
