import { test } from "node:test";
import assert from "node:assert/strict";
import { slugFromPath } from "../public/shared/router.js";

test("extracts a slug from a plain path", () => {
  assert.equal(slugFromPath("/data-science"), "data-science");
});

test("extracts a slug from a path with a trailing slash", () => {
  assert.equal(slugFromPath("/data-science/"), "data-science");
});

test("returns an empty string for the root path", () => {
  assert.equal(slugFromPath("/"), "");
});
