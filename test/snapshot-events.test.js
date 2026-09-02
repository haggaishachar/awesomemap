import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hnHitMatchesRepo,
  mapHnHit,
  buildHnSearchUrl,
  fetchHnEvents,
  isPublishedRelease,
  mapRelease,
  fetchReleaseEvents,
  appendEventEntries,
} from "../scripts/snapshot-events.mjs";

test("hnHitMatchesRepo accepts a hit whose url contains github.com/<owner>/<repo>", () => {
  const hit = { url: "https://github.com/facebook/react/releases/tag/v19.0.0" };
  assert.equal(hnHitMatchesRepo(hit, "facebook", "react"), true);
});

test("hnHitMatchesRepo is case-insensitive", () => {
  const hit = { url: "https://GitHub.com/Facebook/React" };
  assert.equal(hnHitMatchesRepo(hit, "facebook", "react"), true);
});

test("hnHitMatchesRepo rejects a hit whose url is a different repo entirely (Algolia's tokenized search false positive)", () => {
  const hit = { url: "https://github.com/someone-else/react-native-thing" };
  assert.equal(hnHitMatchesRepo(hit, "facebook", "react"), false);
});

test("hnHitMatchesRepo rejects a hit with no url at all (e.g. a text-only Ask HN post)", () => {
  assert.equal(hnHitMatchesRepo({ url: null }, "facebook", "react"), false);
});

test("mapHnHit maps an Algolia hit onto an event entry, linking to the HN discussion itself", () => {
  const hit = {
    objectID: "12345",
    title: "Show HN: React 19",
    created_at: "2026-08-07T14:32:00.000Z",
    points: 312,
  };
  assert.deepEqual(mapHnHit(hit), {
    date: "2026-08-07",
    type: "hn",
    title: "Show HN: React 19",
    url: "https://news.ycombinator.com/item?id=12345",
    points: 312,
  });
});

test("buildHnSearchUrl restricts the search to the url field and requests the story tag", () => {
  const url = buildHnSearchUrl("facebook", "react");
  assert.match(url, /^https:\/\/hn\.algolia\.com\/api\/v1\/search\?/);
  assert.match(url, /query=facebook%2Freact/);
  assert.match(url, /restrictSearchableAttributes=url/);
  assert.match(url, /tags=story/);
});

test("fetchHnEvents keeps only matching, above-threshold hits, mapped to event entries", async () => {
  const hits = [
    { objectID: "1", url: "https://github.com/facebook/react", title: "Front page", created_at: "2026-08-07T00:00:00.000Z", points: 312 },
    { objectID: "2", url: "https://github.com/facebook/react", title: "Below threshold", created_at: "2026-08-08T00:00:00.000Z", points: 4 },
    { objectID: "3", url: "https://github.com/someone-else/react", title: "Unrelated repo", created_at: "2026-08-09T00:00:00.000Z", points: 500 },
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ hits }) });

  const result = await fetchHnEvents("facebook", "react", { fetchImpl, pointsThreshold: 50 });

  assert.deepEqual(result, [
    { date: "2026-08-07", type: "hn", title: "Front page", url: "https://news.ycombinator.com/item?id=1", points: 312 },
  ]);
});

test("fetchHnEvents throws with the response status when the request fails", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, statusText: "Too Many Requests" });
  await assert.rejects(
    () => fetchHnEvents("facebook", "react", { fetchImpl, pointsThreshold: 50 }),
    (err) => err.status === 429
  );
});

test("isPublishedRelease rejects drafts and prereleases, accepts everything else", () => {
  assert.equal(isPublishedRelease({ draft: false, prerelease: false }), true);
  assert.equal(isPublishedRelease({ draft: true, prerelease: false }), false);
  assert.equal(isPublishedRelease({ draft: false, prerelease: true }), false);
});

test("mapRelease maps a GitHub release onto an event entry, preferring the release name over the tag", () => {
  const release = {
    name: "v19.0.0 — Actions",
    tag_name: "v19.0.0",
    html_url: "https://github.com/facebook/react/releases/tag/v19.0.0",
    published_at: "2026-08-07T14:32:00.000Z",
  };
  assert.deepEqual(mapRelease(release), {
    date: "2026-08-07",
    type: "release",
    title: "v19.0.0 — Actions",
    url: "https://github.com/facebook/react/releases/tag/v19.0.0",
    points: null,
  });
});

test("mapRelease falls back to the tag name when the release has no name", () => {
  const release = { name: "", tag_name: "v19.0.0", html_url: "https://x/y", published_at: "2026-08-07T00:00:00.000Z" };
  assert.equal(mapRelease(release).title, "v19.0.0");
});

test("fetchReleaseEvents drops drafts/prereleases and maps the rest", async () => {
  const releases = [
    { name: "v2.0", tag_name: "v2.0", html_url: "https://x/2", published_at: "2026-08-01T00:00:00.000Z", draft: false, prerelease: false },
    { name: "v2.1-rc1", tag_name: "v2.1-rc1", html_url: "https://x/rc1", published_at: "2026-08-05T00:00:00.000Z", draft: false, prerelease: true },
  ];
  const getJson = async () => releases;

  const result = await fetchReleaseEvents("facebook", "react", getJson);

  assert.deepEqual(result, [{ date: "2026-08-01", type: "release", title: "v2.0", url: "https://x/2", points: null }]);
});

test("appendEventEntries merges new events into existing ones, sorted by date", () => {
  const existing = [{ date: "2026-08-01", type: "release", title: "v2.0", url: "https://x/2", points: null }];
  const incoming = [{ date: "2026-07-01", type: "hn", title: "Launch", url: "https://hn/1", points: 200 }];
  assert.deepEqual(appendEventEntries(existing, incoming), [
    { date: "2026-07-01", type: "hn", title: "Launch", url: "https://hn/1", points: 200 },
    { date: "2026-08-01", type: "release", title: "v2.0", url: "https://x/2", points: null },
  ]);
});

test("appendEventEntries dedupes by url, letting the new value win (e.g. an HN post's points climbing)", () => {
  const existing = [{ date: "2026-08-01", type: "hn", title: "Launch", url: "https://hn/1", points: 120 }];
  const incoming = [{ date: "2026-08-01", type: "hn", title: "Launch", url: "https://hn/1", points: 340 }];
  assert.deepEqual(appendEventEntries(existing, incoming), [
    { date: "2026-08-01", type: "hn", title: "Launch", url: "https://hn/1", points: 340 },
  ]);
});

test("appendEventEntries treats a missing existing array as empty", () => {
  const incoming = [{ date: "2026-08-01", type: "release", title: "v2.0", url: "https://x/2", points: null }];
  assert.deepEqual(appendEventEntries(undefined, incoming), incoming);
});
