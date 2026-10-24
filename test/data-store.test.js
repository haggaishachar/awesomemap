import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAllDomains, loadAllProjectEntities, joinDomainProjects, loadLeaderboardSnapshots, loadLeaderboardSnapshot, SCHEMA_VERSION, rebaseProjectDates } from "../scripts/data-store.mjs";

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

test("loadAllProjectEntities drops blog events that don't name the project, keeping its other events", async () => {
  const events = [
    { date: "2026-10-01", type: "blog", title: "Kacey Musgraves Tinsel Ponytail", url: "https://www.nylon.com/beauty/tinsel-ponytail" },
    { date: "2026-10-02", type: "blog", title: "DietrichGebert/ponytail — RepoX", url: "https://repox.fun/repo/DietrichGebert/ponytail" },
    { date: "2026-10-03", type: "hn", title: "Show HN: Ponytail", url: "https://news.ycombinator.com/item?id=1", points: 120 },
  ];
  const { fetchImpl } = fakeFetch([{ status: 200, body: [{ id: "DietrichGebert/ponytail", name: "ponytail", events }] }]);
  const byId = await loadAllProjectEntities({ fetchImpl });
  assert.deepEqual(byId.get("DietrichGebert/ponytail").events.map((e) => e.date), ["2026-10-02", "2026-10-03"]);
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

test("loadLeaderboardSnapshots fetches /leaderboard-snapshots and returns [] when the server has nothing", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body: [] }]);
  const weeks = await loadLeaderboardSnapshots({ fetchImpl });
  assert.deepEqual(weeks, []);
  assert.equal(calls[0].url, "http://example.test/leaderboard-snapshots");
});

test("loadLeaderboardSnapshots returns the server's weeks as-is", async () => {
  const body = [{ isoWeek: "2026-W39", generatedAt: "2026-09-28T08:00:00.000Z" }];
  const { fetchImpl } = fakeFetch([{ status: 200, body }]);
  const weeks = await loadLeaderboardSnapshots({ fetchImpl });
  assert.deepEqual(weeks, body);
});

test("loadLeaderboardSnapshot fetches one week by ISO week label", async () => {
  const body = { isoWeek: "2026-W39", generatedAt: "2026-09-28T08:00:00.000Z", scopes: { global: [] } };
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body }]);
  const snapshot = await loadLeaderboardSnapshot("2026-W39", { fetchImpl });
  assert.deepEqual(snapshot, body);
  assert.equal(calls[0].url, "http://example.test/leaderboard-snapshots/2026-W39");
});

// --- Fixture mode (AWESOMEMAP_DATA_FIXTURE_DIR): reads saved API responses
// from disk instead of the network, so pr-check.yml's build doesn't depend
// on the live awesomemap-data Worker being up. ---

const FIXTURE_DIR = new URL("./fixtures/api", import.meta.url).pathname;
const noNetwork = async (url) => {
  throw new Error(`fixture mode must not fetch, but fetched ${url}`);
};

async function withFixtureDir(dir, fn) {
  process.env.AWESOMEMAP_DATA_FIXTURE_DIR = dir;
  try {
    return await fn();
  } finally {
    delete process.env.AWESOMEMAP_DATA_FIXTURE_DIR;
  }
}

test("fixture mode reads domains from the fixture dir and never touches the network", async () => {
  const domains = await withFixtureDir(FIXTURE_DIR, () => loadAllDomains({ fetchImpl: noNetwork }));
  assert.deepEqual(domains.map((d) => d.slug), ["databases", "security"]);
});

test("fixture mode reads the leaderboard archive list and each listed week", async () => {
  await withFixtureDir(FIXTURE_DIR, async () => {
    const weeks = await loadLeaderboardSnapshots({ fetchImpl: noNetwork });
    assert.ok(weeks.length > 0);
    const snapshot = await loadLeaderboardSnapshot(weeks[0].isoWeek, { fetchImpl: noNetwork });
    assert.equal(snapshot.isoWeek, weeks[0].isoWeek);
    assert.ok(Array.isArray(snapshot.scopes.global));
  });
});

test("fixture mode throws a clear error naming the missing fixture file", async () => {
  await withFixtureDir("/nonexistent-fixture-dir", async () => {
    await assert.rejects(loadAllDomains({ fetchImpl: noNetwork }), /\/nonexistent-fixture-dir\/domains\.json/);
  });
});

test("every committed fixture domain's membership resolves to a fixture project", async () => {
  await withFixtureDir(FIXTURE_DIR, async () => {
    const domains = await loadAllDomains({ fetchImpl: noNetwork });
    const byId = await loadAllProjectEntities({ fetchImpl: noNetwork });
    for (const domain of domains) assert.doesNotThrow(() => joinDomainProjects(domain, byId));
  });
});

test("rebaseProjectDates shifts every history and event date so the newest history date becomes today", () => {
  const projects = [
    { id: "a/a", history: [{ date: "2026-10-20", stars: 1 }, { date: "2026-10-24", stars: 2 }], events: [{ date: "2026-10-21", type: "hn" }] },
    { id: "b/b", history: [{ date: "2026-10-22", stars: 5 }] },
  ];
  const rebased = rebaseProjectDates(projects, new Date("2026-12-01T09:30:00Z"));
  assert.deepEqual(rebased[0].history.map((h) => h.date), ["2026-11-27", "2026-12-01"]);
  assert.deepEqual(rebased[0].events.map((e) => e.date), ["2026-11-28"]);
  assert.deepEqual(rebased[1].history.map((h) => h.date), ["2026-11-29"]);
  assert.equal(rebased[0].history[1].stars, 2);
  assert.equal(projects[0].history[1].date, "2026-10-24", "input is not mutated");
});

test("rebaseProjectDates returns projects unchanged when none has history", () => {
  const projects = [{ id: "a/a", history: [] }, { id: "b/b" }];
  assert.deepEqual(rebaseProjectDates(projects, new Date("2026-12-01T00:00:00Z")), projects);
});

test("fixture mode rebases project dates to today, so growth windows aren't empty as the fixture ages", async () => {
  const byId = await withFixtureDir(FIXTURE_DIR, () => loadAllProjectEntities({ fetchImpl: noNetwork }));
  const today = new Date().toISOString().slice(0, 10);
  const newest = [...byId.values()].flatMap((p) => (p.history ?? []).map((h) => h.date)).sort().at(-1);
  assert.equal(newest, today);
});
