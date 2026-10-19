// test/rising-filters.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRisingHash, buildRisingHash, effectiveWindow, DEFAULT_RISING_STATE } from "../app/shared/rising-filters.js";

const OPTS = { tierKeys: ["breakout", "climbing", "giants", "spiking"], domainSlugs: ["artificial-intelligence", "security"] };

test("parseRisingHash reads a domain, a tier, or both, in either order", () => {
  assert.deepEqual(parseRisingHash("#artificial-intelligence", OPTS), { ...DEFAULT_RISING_STATE, domain: "artificial-intelligence" });
  assert.deepEqual(parseRisingHash("#spiking", OPTS), { ...DEFAULT_RISING_STATE, tier: "spiking" });
  assert.deepEqual(parseRisingHash("#security/giants", OPTS), { ...DEFAULT_RISING_STATE, domain: "security", tier: "giants" });
  assert.deepEqual(parseRisingHash("#giants/security", OPTS), { ...DEFAULT_RISING_STATE, domain: "security", tier: "giants" });
});

test("parseRisingHash falls back to the default view for empty, unknown, or malformed hashes", () => {
  for (const hash of ["", "#", "#nope", "#zzz/qqq", "#%E0%A4%A"]) {
    assert.deepEqual(parseRisingHash(hash, OPTS), DEFAULT_RISING_STATE, hash);
  }
  assert.deepEqual(parseRisingHash("#security/zzz", OPTS), { ...DEFAULT_RISING_STATE, domain: "security" });
});

test("buildRisingHash omits defaults, so the default view has no hash", () => {
  assert.equal(buildRisingHash(DEFAULT_RISING_STATE), "");
  assert.equal(buildRisingHash({ ...DEFAULT_RISING_STATE, domain: "security" }), "#security");
  assert.equal(buildRisingHash({ ...DEFAULT_RISING_STATE, tier: "spiking" }), "#spiking");
  assert.equal(buildRisingHash({ ...DEFAULT_RISING_STATE, domain: "security", tier: "giants", window: "30" }), "#security/giants");
});

test("effectiveWindow forces Spiking to the first window but leaves the chosen window intact for size tiers", () => {
  assert.equal(effectiveWindow({ tier: "spiking", window: "30" }, "7"), "7");
  assert.equal(effectiveWindow({ tier: "breakout", window: "30" }, "7"), "30");
});
