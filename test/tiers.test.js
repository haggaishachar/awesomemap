// test/tiers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TIERS, DEFAULT_TIER, SPIKING_TAB, tierForStars, composeTeaser, TEASER_MIN_BREAKOUT } from "../scripts/tiers.mjs";

test("TIERS are breakout/climbing/giants in order, contiguous, with breakout as the default", () => {
  assert.deepEqual(TIERS.map((t) => t.key), ["breakout", "climbing", "giants"]);
  assert.equal(DEFAULT_TIER, "breakout");
  assert.equal(SPIKING_TAB.key, "spiking");
  for (let i = 1; i < TIERS.length; i++) assert.equal(TIERS[i].minStars, TIERS[i - 1].maxStars);
});

test("tierForStars puts each boundary in the upper tier", () => {
  assert.equal(tierForStars(0), "breakout");
  assert.equal(tierForStars(9_999), "breakout");
  assert.equal(tierForStars(10_000), "climbing");
  assert.equal(tierForStars(49_999), "climbing");
  assert.equal(tierForStars(50_000), "giants");
  assert.equal(tierForStars(400_000), "giants");
});

const row = (id, tier = "breakout") => ({ id, tier });

test("composeTeaser returns up to `limit` Breakout rows when there are at least minBreakout", () => {
  const breakout = ["a", "b", "c", "d", "e", "f"].map((id) => row(id));
  const climbing = [row("x", "climbing")];
  assert.deepEqual(composeTeaser(breakout, climbing).map((r) => r.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(composeTeaser(breakout.slice(0, TEASER_MIN_BREAKOUT), climbing).map((r) => r.id), ["a", "b", "c"]);
});

test("composeTeaser fills from Climbing up to `limit` when Breakout has fewer than minBreakout rows", () => {
  const breakout = [row("a"), row("b")];
  const climbing = ["x", "y", "z", "w"].map((id) => row(id, "climbing"));
  assert.deepEqual(composeTeaser(breakout, climbing).map((r) => r.id), ["a", "b", "x", "y", "z"]);
});

test("composeTeaser returns an empty list when both tiers are empty", () => {
  assert.deepEqual(composeTeaser([], []), []);
});
