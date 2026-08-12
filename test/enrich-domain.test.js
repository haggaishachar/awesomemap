import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGhRepo,
  LOGO_CANDIDATE_PATHS,
  enrichProject,
  withRetry,
  defaultIsRetryable,
  createGetJson,
  findInvalidWeights,
} from "../scripts/enrich-domain.mjs";

test("parseGhRepo extracts owner/repo from the shorthand", () => {
  assert.deepEqual(parseGhRepo("scikit-learn/scikit-learn"), {
    owner: "scikit-learn",
    repo: "scikit-learn",
  });
});

test("parseGhRepo strips a trailing slash", () => {
  assert.deepEqual(parseGhRepo("facebook/react/"), {
    owner: "facebook",
    repo: "react",
  });
});

test("parseGhRepo strips a trailing .git", () => {
  assert.deepEqual(parseGhRepo("facebook/react.git"), {
    owner: "facebook",
    repo: "react",
  });
});

test("parseGhRepo returns null for a full URL (write the owner/repo shorthand instead)", () => {
  assert.equal(parseGhRepo("https://github.com/facebook/react"), null);
});

test("parseGhRepo returns null for a path with extra segments beyond owner/repo", () => {
  assert.equal(parseGhRepo("facebook/react/tree/main/packages"), null);
});

test("parseGhRepo returns null for a bare owner with no repo", () => {
  assert.equal(parseGhRepo("facebook"), null);
});

test("parseGhRepo returns null for a non-string value", () => {
  assert.equal(parseGhRepo(undefined), null);
});

function fakeGetJson({ repoStars, ownerAvatarUrl, contentsByPath }) {
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
    return { stargazers_count: repoStars, owner: { avatar_url: ownerAvatarUrl } };
  };
}

test("enrichProject sets weight from the repo's star count", async () => {
  const project = { id: "facebook/react" };
  const getJson = fakeGetJson({ repoStars: 12345, contentsByPath: {} });

  const result = await enrichProject(project, { getJson });

  assert.equal(result.weight, 12345);
  assert.equal(result.id, "facebook/react");
  assert.equal(result.image, undefined);
});

test("enrichProject sets image to the first matching logo candidate's direct URL", async () => {
  const project = { id: "facebook/react" };
  const getJson = fakeGetJson({
    repoStars: 12345,
    contentsByPath: {
      "logo.svg": null,
      "logo.png": { type: "file", download_url: "https://raw.githubusercontent.com/facebook/react/main/logo.png" },
    },
  });

  const result = await enrichProject(project, { getJson });

  assert.equal(result.weight, 12345);
  assert.equal(result.image, "https://raw.githubusercontent.com/facebook/react/main/logo.png");
});

test("enrichProject leaves image unset when no candidate path exists", async () => {
  const project = { id: "facebook/react" };
  const getJson = fakeGetJson({ repoStars: 12345, contentsByPath: {} });

  const result = await enrichProject(project, { getJson });

  assert.equal(result.weight, 12345);
  assert.equal(result.image, undefined);
});

test("enrichProject falls back to the repo owner's avatar when no logo file is found", async () => {
  const project = { id: "facebook/react" };
  const getJson = fakeGetJson({
    repoStars: 12345,
    ownerAvatarUrl: "https://avatars.githubusercontent.com/u/69631?v=4",
    contentsByPath: {},
  });

  const result = await enrichProject(project, { getJson });

  assert.equal(result.image, "https://avatars.githubusercontent.com/u/69631?v=4");
});

test("enrichProject prefers a found logo file over the owner avatar fallback", async () => {
  const project = { id: "facebook/react" };
  const getJson = fakeGetJson({
    repoStars: 12345,
    ownerAvatarUrl: "https://avatars.githubusercontent.com/u/69631?v=4",
    contentsByPath: {
      "logo.svg": { type: "file", download_url: "https://raw.githubusercontent.com/facebook/react/main/logo.svg" },
    },
  });

  const result = await enrichProject(project, { getJson });

  assert.equal(result.image, "https://raw.githubusercontent.com/facebook/react/main/logo.svg");
});

test("enrichProject leaves a project whose id isn't an owner/repo shorthand unchanged", async () => {
  const project = { id: "unlisted", desc: "no repo" };
  const getJson = async () => {
    throw new Error("should not be called");
  };

  const result = await enrichProject(project, { getJson });

  assert.deepEqual(result, project);
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
test("findInvalidWeights returns an empty list when every repo-linked project has a valid weight", () => {
  const projects = [
    { id: "facebook/react", weight: 12345 },
    { id: "vuejs/vue", weight: 1 },
    { id: "c", desc: "no repo at all" },
  ];

  assert.deepEqual(findInvalidWeights(projects), []);
});

test("findInvalidWeights flags a repo-linked project whose weight is 0", () => {
  const projects = [
    { id: "facebook/react", weight: 12345 },
    { id: "zero-weight/repo", weight: 0 },
  ];

  assert.deepEqual(findInvalidWeights(projects), ["zero-weight/repo"]);
});

test("findInvalidWeights flags a repo-linked project whose weight is undefined", () => {
  const projects = [{ id: "no-weight/repo" }];

  assert.deepEqual(findInvalidWeights(projects), ["no-weight/repo"]);
});

test("findInvalidWeights does not flag a project whose id isn't an owner/repo shorthand, even without a weight", () => {
  const projects = [{ id: "unlisted", desc: "no repo, never enriched, no weight expected" }];

  assert.deepEqual(findInvalidWeights(projects), []);
});

test("findInvalidWeights flags non-integer and negative weights too", () => {
  const projects = [
    { id: "fractional/repo", weight: 4.5 },
    { id: "negative/repo", weight: -1 },
    { id: "not-a-number/repo", weight: "12345" },
  ];

  assert.deepEqual(findInvalidWeights(projects), ["fractional/repo", "negative/repo", "not-a-number/repo"]);
});
