import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCategoryTree, buildClassificationPrompt, callOpenRouterApi, classifyCandidates } from "../scripts/classify-candidates.mjs";

const domain = {
  slug: "artificial-intelligence",
  name: "Best Artificial Intelligence Open Source Projects",
  description: "LLM frameworks, AI agents, RAG, vector databases, coding assistants, and more.",
  projects: [
    { id: "a/a", path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"] },
    { id: "b/b", path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"] },
    { id: "c/c", path: ["Agents & Coding", "Orchestration Frameworks"] },
  ],
};

test("buildCategoryTree dedups project paths into sorted breadcrumb strings", () => {
  assert.deepEqual(buildCategoryTree(domain), ["Agents & Coding / Orchestration Frameworks", "LLM Infrastructure / LLM Frameworks & Runtimes"]);
});

test("buildClassificationPrompt includes the domain description, category tree, and every candidate", () => {
  const categoryTree = ["LLM Infrastructure / LLM Frameworks & Runtimes"];
  const candidates = [{ id: "foo/bar", description: "A test LLM tool", topics: ["llm"] }];

  const { system, candidatesText } = buildClassificationPrompt(domain, categoryTree, candidates);

  assert.match(system, /LLM frameworks, AI agents, RAG/);
  assert.match(system, /LLM Infrastructure \/ LLM Frameworks & Runtimes/);
  assert.match(candidatesText, /foo\/bar/);
  assert.match(candidatesText, /A test LLM tool/);
});

test("callOpenRouterApi posts to the chat completions endpoint with a forced classify_candidates tool call and parses its arguments", async () => {
  let capturedBody;
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "classify_candidates", arguments: JSON.stringify({ classifications: [{ id: "foo/bar", fits: true, confidence: 0.9, reason: "fits" }] }) } },
              ],
            },
          },
        ],
      }),
    };
  };

  const result = await callOpenRouterApi({ system: "sys", candidatesText: "candidates" }, { apiKey: "test-key", fetchImpl });

  assert.deepEqual(result, [{ id: "foo/bar", fits: true, confidence: 0.9, reason: "fits" }]);
  assert.equal(capturedBody.tool_choice.function.name, "classify_candidates");
  assert.equal(capturedBody.messages[0].content, "sys");
});

test("callOpenRouterApi defaults to the google/gemini-3.7-flash model when OPENROUTER_MODEL is unset", async () => {
  const previous = process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MODEL;
  let capturedBody;
  const fetchImpl = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: "classify_candidates", arguments: '{"classifications":[]}' } }] } }] }) };
  };

  await callOpenRouterApi({ system: "sys", candidatesText: "c" }, { apiKey: "k", fetchImpl });

  assert.equal(capturedBody.model, "google/gemini-3.7-flash");
  if (previous !== undefined) process.env.OPENROUTER_MODEL = previous;
});

test("callOpenRouterApi throws on a non-ok response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, statusText: "Server Error" });
  await assert.rejects(() => callOpenRouterApi({ system: "s", candidatesText: "c" }, { apiKey: "k", fetchImpl }), /500/);
});

test("classifyCandidates passes through a well-formed response", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => [{ id: "foo/bar", fits: true, path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"], confidence: 0.9, reason: "great fit" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.deepEqual(result, [
    { id: "foo/bar", fits: true, path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"], confidence: 0.9, suggestedNewCategory: null, reason: "great fit" },
  ]);
});

test("classifyCandidates accepts a suggestedNewCategory with no existing-path match", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => [{ id: "foo/bar", fits: true, confidence: 0.7, suggestedNewCategory: "Fine-Tuning Tools", reason: "no existing category fits" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.equal(result[0].suggestedNewCategory, "Fine-Tuning Tools");
});

test("classifyCandidates falls back to fits:null for a candidate missing from the response", async () => {
  const candidates = [
    { id: "foo/bar", description: "d", topics: [] },
    { id: "missing/one", description: "d", topics: [] },
  ];
  const callLlm = async () => [{ id: "foo/bar", fits: true, path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"], confidence: 0.9, reason: "fits" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.deepEqual(result[1], { id: "missing/one", fits: null, path: null, confidence: 0, suggestedNewCategory: null, reason: "unparseable classification" });
});

test("classifyCandidates falls back to fits:null for an out-of-range confidence", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => [{ id: "foo/bar", fits: true, path: ["LLM Infrastructure", "LLM Frameworks & Runtimes"], confidence: 1.5, reason: "fits" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.equal(result[0].fits, null);
  assert.equal(result[0].reason, "unparseable classification");
});

test("classifyCandidates falls back to fits:null for a path that neither matches an existing category nor carries suggestedNewCategory", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => [{ id: "foo/bar", fits: true, path: ["Made Up Category"], confidence: 0.9, reason: "fits" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.equal(result[0].fits, null);
});

test("classifyCandidates falls back to fits:null for fits:true with neither path nor suggestedNewCategory (would otherwise auto-commit with path: null)", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => [{ id: "foo/bar", fits: true, confidence: 0.9, reason: "fits, somehow" }];

  const result = await classifyCandidates(domain, candidates, { callLlm });

  assert.equal(result[0].fits, null);
  assert.equal(result[0].reason, "unparseable classification");
});

test("classifyCandidates propagates a whole-call failure (caller retries/skips the domain, not a per-candidate fallback)", async () => {
  const candidates = [{ id: "foo/bar", description: "d", topics: [] }];
  const callLlm = async () => {
    throw new Error("network down");
  };

  await assert.rejects(() => classifyCandidates(domain, candidates, { callLlm }), /network down/);
});
