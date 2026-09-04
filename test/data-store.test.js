import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAllDomains, loadAllProjectEntities, joinDomainProjects, SCHEMA_VERSION } from "../scripts/data-store.mjs";

process.env.AWESOMEMAP_DATA_API_URL = "http://example.test";

/** Records every call and replays canned responses in order. */
function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url) => {
    calls.push({ url });
    const next = queue.shift();
    if (!next) throw new Error(`fakeFetch: no response queued for ${url}`);
    return { ok: next.status < 400, status: next.status, statusText: next.statusText ?? "", json: async () => next.body, text: async () => JSON.stringify(next.body) };
  };
  return { fetchImpl, calls };
}

test("SCHEMA_VERSION is 1", () => {
  assert.equal(SCHEMA_VERSION, 1);
});

test("loadAllDomains fetches /domains and sorts by slug", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body: [{ slug: "web-dev", projects: [] }, { slug: "automation", projects: [] }] }]);
  const domains = await loadAllDomains({ fetchImpl });
  assert.deepEqual(domains.map((d) => d.slug), ["automation", "web-dev"]);
  assert.equal(calls[0].url, "http://example.test/domains");
});

test("loadAllProjectEntities fetches /projects into a Map keyed by id", async () => {
  const { fetchImpl } = fakeFetch([{ status: 200, body: [{ id: "facebook/react", name: "React" }] }]);
  const byId = await loadAllProjectEntities({ fetchImpl });
  assert.equal(byId.get("facebook/react").name, "React");
});

test("joinDomainProjects merges each membership entry's path onto its project entity", () => {
  const domain = {
    slug: "web-dev",
    projects: [
      { id: "facebook/react", path: ["Frontend Frameworks"] },
      { id: "vuejs/core", path: ["Frontend Frameworks"] },
    ],
  };
  const entitiesById = new Map([
    ["facebook/react", { id: "facebook/react", name: "React", weight: 247895 }],
    ["vuejs/core", { id: "vuejs/core", name: "Vue", weight: 54250 }],
  ]);

  const joined = joinDomainProjects(domain, entitiesById);

  assert.deepEqual(joined, [
    { id: "facebook/react", name: "React", weight: 247895, path: ["Frontend Frameworks"] },
    { id: "vuejs/core", name: "Vue", weight: 54250, path: ["Frontend Frameworks"] },
  ]);
});

test("joinDomainProjects throws on a membership id with no matching entity", () => {
  const domain = { slug: "web-dev", projects: [{ id: "ghost/repo", path: ["Nowhere"] }] };
  assert.throws(() => joinDomainProjects(domain, new Map()), /"ghost\/repo" has no project entity/);
});

test("a failing (non-ok) response throws with status and body text", async () => {
  const { fetchImpl } = fakeFetch([{ status: 500, statusText: "Internal Server Error", body: { error: "boom" } }]);
  await assert.rejects(loadAllDomains({ fetchImpl }), /500/);
});

test("loadAllDomains defaults to the live production API when AWESOMEMAP_DATA_API_URL is unset", async () => {
  const original = process.env.AWESOMEMAP_DATA_API_URL;
  delete process.env.AWESOMEMAP_DATA_API_URL;
  try {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: [] }]);
    await loadAllDomains({ fetchImpl });
    assert.equal(calls[0].url, "https://awesomemap-data.haggai-shachar.workers.dev/domains");
  } finally {
    process.env.AWESOMEMAP_DATA_API_URL = original;
  }
});

test("loadAllDomains also defaults to the live production API when AWESOMEMAP_DATA_API_URL is set but empty", async () => {
  // Regression test: GitHub Actions injects a workflow env var as an empty
  // string (not an absent variable) when the secret it references from
  // `${{ secrets.FOO }}` doesn't exist — this broke deploy.yml in
  // production (run 33898487635) when AWESOMEMAP_DATA_API_URL's secret
  // was removed from the repo; `??` didn't catch the empty string.
  const original = process.env.AWESOMEMAP_DATA_API_URL;
  process.env.AWESOMEMAP_DATA_API_URL = "";
  try {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: [] }]);
    await loadAllDomains({ fetchImpl });
    assert.equal(calls[0].url, "https://awesomemap-data.haggai-shachar.workers.dev/domains");
  } finally {
    process.env.AWESOMEMAP_DATA_API_URL = original;
  }
});
