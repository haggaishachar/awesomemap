import { test } from "node:test";
import assert from "node:assert/strict";
import { readCart, addToCart, removeFromCart, toggleCart } from "../app/shared/compare-cart.js";

/** Minimal in-memory Storage-shaped fake — avoids depending on a real `localStorage` global existing in the test runner. */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
  };
}

test("readCart returns an empty array when nothing is stored", () => {
  assert.deepEqual(readCart(fakeStorage()), []);
});

test("readCart returns an empty array for corrupted JSON", () => {
  const storage = fakeStorage({ "awesomemap:compare": "not json" });
  assert.deepEqual(readCart(storage), []);
});

test("readCart ignores non-string entries in a corrupted-but-parseable value", () => {
  const storage = fakeStorage({ "awesomemap:compare": JSON.stringify(["a/b", 42, null, "c/d"]) });
  assert.deepEqual(readCart(storage), ["a/b", "c/d"]);
});

test("addToCart adds a new id and persists it", () => {
  const storage = fakeStorage();
  const result = addToCart("facebook/react", storage);
  assert.deepEqual(result, ["facebook/react"]);
  assert.deepEqual(readCart(storage), ["facebook/react"]);
});

test("addToCart is a no-op when the id is already present", () => {
  const storage = fakeStorage({ "awesomemap:compare": JSON.stringify(["a/b"]) });
  const result = addToCart("a/b", storage);
  assert.deepEqual(result, ["a/b"]);
});

test("addToCart is a no-op once the cart already holds 4 ids", () => {
  const storage = fakeStorage({ "awesomemap:compare": JSON.stringify(["a/1", "a/2", "a/3", "a/4"]) });
  const result = addToCart("a/5", storage);
  assert.deepEqual(result, ["a/1", "a/2", "a/3", "a/4"]);
});

test("removeFromCart removes a present id and persists it", () => {
  const storage = fakeStorage({ "awesomemap:compare": JSON.stringify(["a/b", "c/d"]) });
  const result = removeFromCart("a/b", storage);
  assert.deepEqual(result, ["c/d"]);
  assert.deepEqual(readCart(storage), ["c/d"]);
});

test("removeFromCart is a no-op when the id isn't present", () => {
  const storage = fakeStorage({ "awesomemap:compare": JSON.stringify(["c/d"]) });
  const result = removeFromCart("a/b", storage);
  assert.deepEqual(result, ["c/d"]);
});

test("toggleCart adds an absent id", () => {
  const storage = fakeStorage();
  assert.deepEqual(toggleCart("a/b", storage), ["a/b"]);
});

test("toggleCart removes a present id", () => {
  const storage = fakeStorage({ "awesomemap:compare": JSON.stringify(["a/b"]) });
  assert.deepEqual(toggleCart("a/b", storage), []);
});

test("toggleCart does not add past the 4-id cap", () => {
  const storage = fakeStorage({ "awesomemap:compare": JSON.stringify(["a/1", "a/2", "a/3", "a/4"]) });
  assert.deepEqual(toggleCart("a/5", storage), ["a/1", "a/2", "a/3", "a/4"]);
});
