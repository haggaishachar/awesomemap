import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGhRepo, LOGO_CANDIDATE_PATHS, enrichTool, withRetry, defaultIsRetryable } from "../scripts/enrich-domain.mjs";

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
  assert.equal(sleeps.length, 2);
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
  assert.equal(sleeps.length, 2);
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
