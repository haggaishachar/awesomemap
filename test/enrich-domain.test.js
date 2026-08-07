import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGhRepo,
  LOGO_CANDIDATE_PATHS,
  enrichTool,
  withRetry,
  defaultIsRetryable,
  createGetJson,
  findInvalidWeights,
} from "../scripts/enrich-domain.mjs";

test("parseGhRepo extracts owner/repo from a plain github.com URL", () => {
  assert.deepEqual(parseGhRepo("https://github.com/scikit-learn/scikit-learn"), {
    owner: "scikit-learn",
    repo: "scikit-learn",
  });
});

test("parseGhRepo strips a trailing slash", () => {
  assert.deepEqual(parseGhRepo("https://github.com/facebook/react/"), {
    owner: "facebook",
    repo: "react",
  });
});

test("parseGhRepo strips a trailing .git", () => {
  assert.deepEqual(parseGhRepo("https://github.com/facebook/react.git"), {
    owner: "facebook",
    repo: "react",
  });
});

test("parseGhRepo ignores subpaths beyond owner/repo", () => {
  assert.deepEqual(parseGhRepo("https://github.com/facebook/react/tree/main/packages"), {
    owner: "facebook",
    repo: "react",
  });
});

test("parseGhRepo returns null for a non-github.com URL", () => {
  assert.equal(parseGhRepo("https://gitlab.com/foo/bar"), null);
});

test("parseGhRepo returns null for a malformed URL", () => {
  assert.equal(parseGhRepo("not a url"), null);
});

function fakeGetJson({ repoStars, contentsByPath }) {
  return async (url) => {
    const contentsMatch = Object.keys(contentsByPath).find((p) => url.endsWith(`/contents/${p}`));
    if (contentsMatch) {
      const entry = contentsByPath[contentsMatch];
      if (!entry) {
        const err = new Error("Not Found");
        err.status = 404;
        throw err;
      }
      return entry;
    }
    return { stargazers_count: repoStars };
  };
}

test("enrichTool sets weight from the repo's star count", async () => {
  const tool = { id: "react", gh: "https://github.com/facebook/react" };
  const getJson = fakeGetJson({ repoStars: 12345, contentsByPath: {} });
  const downloads = [];
  const downloadFile = async (url, dest) => downloads.push({ url, dest });

  const result = await enrichTool(tool, { getJson, downloadFile });

  assert.equal(result.weight, 12345);
  assert.equal(result.id, "react");
  assert.deepEqual(downloads, []);
});

test("enrichTool downloads the first matching logo candidate", async () => {
  const tool = { id: "react", gh: "https://github.com/facebook/react" };
  const getJson = fakeGetJson({
    repoStars: 12345,
    contentsByPath: {
      "logo.svg": null,
      "logo.png": { type: "file", download_url: "https://raw.githubusercontent.com/facebook/react/main/logo.png" },
    },
  });
  const downloads = [];
  const downloadFile = async (url, dest) => downloads.push({ url, dest });

  const result = await enrichTool(tool, { getJson, downloadFile }, "data/web-dev/images");

  assert.equal(result.weight, 12345);
  assert.deepEqual(downloads, [
    {
      url: "https://raw.githubusercontent.com/facebook/react/main/logo.png",
      dest: "data/web-dev/images/react.png",
    },
  ]);
});

test("enrichTool downloads nothing when no candidate path exists", async () => {
  const tool = { id: "react", gh: "https://github.com/facebook/react" };
  const getJson = fakeGetJson({ repoStars: 12345, contentsByPath: {} });
  const downloads = [];
  const downloadFile = async (url, dest) => downloads.push({ url, dest });

  const result = await enrichTool(tool, { getJson, downloadFile }, "data/web-dev/images");

  assert.equal(result.weight, 12345);
  assert.deepEqual(downloads, []);
});

test("enrichTool leaves a tool with no gh URL unchanged", async () => {
  const tool = { id: "unlisted", desc: "no repo" };
  const getJson = async () => {
    throw new Error("should not be called");
  };
  const downloadFile = async () => {
    throw new Error("should not be called");
  };

  const result = await enrichTool(tool, { getJson, downloadFile });

  assert.deepEqual(result, tool);
});

function fakeSleep(calls) {
  return async (ms) => {
    calls.push(ms);
  };
}

test("withRetry succeeds immediately when fn does not throw", async () => {
  let callCount = 0;
  const sleeps = [];
  const fn = async () => {
    callCount += 1;
    return "ok";
  };

  const result = await withRetry(fn, { sleep: fakeSleep(sleeps) });

  assert.equal(result, "ok");
  assert.equal(callCount, 1);
  assert.deepEqual(sleeps, []);
});

test("withRetry succeeds after N transient (retryable) failures", async () => {
  let callCount = 0;
  const sleeps = [];
  const fn = async () => {
    callCount += 1;
    if (callCount < 3) {
      const err = new Error("Bad Gateway");
      err.status = 502;
      throw err;
    }
    return "ok";
  };

  const result = await withRetry(fn, { attempts: 3, sleep: fakeSleep(sleeps) });

  assert.equal(result, "ok");
  assert.equal(callCount, 3);
  // Linear backoff: delayMs (default 200) * attempt number, one sleep per
  // failed attempt (attempts 1 and 2 failed; attempt 3 succeeded so no
  // trailing sleep after it).
  assert.deepEqual(sleeps, [200, 400]);
});

test("withRetry gives up and rethrows after exhausting attempts", async () => {
  let callCount = 0;
  const sleeps = [];
  const err502 = Object.assign(new Error("Bad Gateway"), { status: 502 });
  const fn = async () => {
    callCount += 1;
    throw err502;
  };

  await assert.rejects(() => withRetry(fn, { attempts: 3, sleep: fakeSleep(sleeps) }), err502);
  assert.equal(callCount, 3);
  assert.deepEqual(sleeps, [200, 400]);
});

test("withRetry does not retry a non-retryable (4xx-style) error", async () => {
  let callCount = 0;
  const sleeps = [];
  const err404 = Object.assign(new Error("Not Found"), { status: 404 });
  const fn = async () => {
    callCount += 1;
    throw err404;
  };

  await assert.rejects(() => withRetry(fn, { attempts: 3, sleep: fakeSleep(sleeps) }), err404);
  assert.equal(callCount, 1);
  assert.deepEqual(sleeps, []);
});

test("defaultIsRetryable retries 5xx and network-level (no status) errors, not 4xx", () => {
  assert.equal(defaultIsRetryable(Object.assign(new Error(), { status: 502 })), true);
  assert.equal(defaultIsRetryable(Object.assign(new Error(), { status: 500 })), true);
  assert.equal(defaultIsRetryable(new TypeError("fetch failed")), true);
  assert.equal(defaultIsRetryable(Object.assign(new Error(), { status: 404 })), false);
  assert.equal(defaultIsRetryable(Object.assign(new Error(), { status: 401 })), false);
});

// createGetJson builds the exact getJson used by main() in production
// (fetch -> !res.ok check -> err.status -> withRetry). These tests exercise
// that real composition end to end via an injected fetchImpl + sleep,
// rather than a hand-reconstructed copy of it, so they catch regressions
// in the actual wiring main() relies on.
function fakeFetchSequence(outcomes) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url) => {
    const outcome = outcomes[Math.min(i, outcomes.length - 1)];
    i += 1;
    calls.push(url);
    if (outcome.networkError) throw new TypeError("fetch failed (simulated network error)");
    return {
      ok: outcome.status < 400,
      status: outcome.status,
      statusText: outcome.statusText ?? "",
      json: async () => outcome.body,
    };
  };
  return { fetchImpl, calls };
}

test("createGetJson: real getJson retries a transient 502 then succeeds", async () => {
  const { fetchImpl, calls } = fakeFetchSequence([
    { status: 502, statusText: "Bad Gateway" },
    { status: 502, statusText: "Bad Gateway" },
    { status: 200, body: { stargazers_count: 4242 } },
  ]);
  const sleeps = [];
  const getJson = createGetJson("fake-token", { fetchImpl, sleep: fakeSleep(sleeps) });

  const result = await getJson("https://api.github.com/repos/facebook/react");

  assert.deepEqual(result, { stargazers_count: 4242 });
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [200, 400]);
});

test("createGetJson: real getJson retries a thrown network exception then succeeds", async () => {
  const { fetchImpl, calls } = fakeFetchSequence([
    { networkError: true },
    { status: 200, body: { stargazers_count: 99 } },
  ]);
  const sleeps = [];
  const getJson = createGetJson("fake-token", { fetchImpl, sleep: fakeSleep(sleeps) });

  const result = await getJson("https://api.github.com/repos/facebook/react");

  assert.deepEqual(result, { stargazers_count: 99 });
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [200]);
});

test("createGetJson: real getJson does not retry a persistent 404 (single fetch call)", async () => {
  const { fetchImpl, calls } = fakeFetchSequence([{ status: 404, statusText: "Not Found" }]);
  const sleeps = [];
  const getJson = createGetJson("fake-token", { fetchImpl, sleep: fakeSleep(sleeps) });

  await assert.rejects(
    () => getJson("https://api.github.com/repos/facebook/react/contents/logo.svg"),
    (err) => err.status === 404,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test("createGetJson: real getJson exhausts retries and throws on a persistent 502", async () => {
  const { fetchImpl, calls } = fakeFetchSequence([{ status: 502, statusText: "Bad Gateway" }]);
  const sleeps = [];
  const getJson = createGetJson("fake-token", { fetchImpl, sleep: fakeSleep(sleeps) });

  await assert.rejects(
    () => getJson("https://api.github.com/repos/facebook/react"),
    (err) => err.status === 502,
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [200, 400]);
});

test("withRetry rejects attempts < 1 with a clear error instead of silently returning undefined", async () => {
  const fn = async () => {
    throw new Error("should never be called");
  };

  await assert.rejects(() => withRetry(fn, { attempts: 0 }), /attempts must be >= 1/);
});

// findInvalidWeights: the post-enrichment guard that would have caught the
// earlier draft of mobile-dev.json shipping with every weight stuck at 0.
test("findInvalidWeights returns an empty list when every gh-linked tool has a valid weight", () => {
  const tools = [
    { id: "a", gh: "https://github.com/facebook/react", weight: 12345 },
    { id: "b", gh: "https://github.com/vuejs/vue", weight: 1 },
    { id: "c", desc: "no gh url at all" },
  ];

  assert.deepEqual(findInvalidWeights(tools), []);
});

test("findInvalidWeights flags a gh-linked tool whose weight is 0", () => {
  const tools = [
    { id: "a", gh: "https://github.com/facebook/react", weight: 12345 },
    { id: "zero-weight", gh: "https://github.com/some/repo", weight: 0 },
  ];

  assert.deepEqual(findInvalidWeights(tools), ["zero-weight"]);
});

test("findInvalidWeights flags a gh-linked tool whose weight is undefined", () => {
  const tools = [{ id: "no-weight", gh: "https://github.com/some/repo" }];

  assert.deepEqual(findInvalidWeights(tools), ["no-weight"]);
});

test("findInvalidWeights does not flag a tool with no gh URL even without a weight", () => {
  const tools = [{ id: "unlisted", desc: "no repo, never enriched, no weight expected" }];

  assert.deepEqual(findInvalidWeights(tools), []);
});

test("findInvalidWeights flags non-integer and negative weights too", () => {
  const tools = [
    { id: "fractional", gh: "https://github.com/some/repo", weight: 4.5 },
    { id: "negative", gh: "https://github.com/some/other-repo", weight: -1 },
    { id: "not-a-number", gh: "https://github.com/some/third-repo", weight: "12345" },
  ];

  assert.deepEqual(findInvalidWeights(tools), ["fractional", "negative", "not-a-number"]);
});
