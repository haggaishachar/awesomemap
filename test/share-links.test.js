import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTwitterShareUrl, buildLinkedInShareUrl, buildRedditShareUrl } from "../app/shared/share-links.js";

test("buildTwitterShareUrl encodes the url and title as tweet intent params", () => {
  const url = buildTwitterShareUrl("https://awesomemap.dev/data-science/", "Data Science");
  assert.equal(url, "https://twitter.com/intent/tweet?url=https%3A%2F%2Fawesomemap.dev%2Fdata-science%2F&text=Data+Science");
});

test("buildLinkedInShareUrl encodes only the url, matching LinkedIn's share-offsite endpoint", () => {
  const url = buildLinkedInShareUrl("https://awesomemap.dev/data-science/");
  assert.equal(url, "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fawesomemap.dev%2Fdata-science%2F");
});

test("buildRedditShareUrl encodes the url and title as submit params", () => {
  const url = buildRedditShareUrl("https://awesomemap.dev/data-science/", "Data Science");
  assert.equal(url, "https://www.reddit.com/submit?url=https%3A%2F%2Fawesomemap.dev%2Fdata-science%2F&title=Data+Science");
});

test("share URL builders percent-encode a title containing '&' so it can't break out of the query string", () => {
  const url = buildTwitterShareUrl("https://awesomemap.dev/data-science/", "R&D Tools");
  assert.equal(url, "https://twitter.com/intent/tweet?url=https%3A%2F%2Fawesomemap.dev%2Fdata-science%2F&text=R%26D+Tools");
});
