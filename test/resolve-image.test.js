import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveImage } from "../scripts/resolve-image.mjs";

test("matches an id to a .png file", () => {
  assert.equal(resolveImage("scikit-learn", ["scikit-learn.png", "xgboost.png"]), "scikit-learn.png");
});

test("matches an id to a non-png extension", () => {
  assert.equal(resolveImage("facenet", ["facenet.jfif", "other.png"]), "facenet.jfif");
});

test("returns null when no file matches the id", () => {
  assert.equal(resolveImage("missing-tool", ["scikit-learn.png"]), null);
});

test("does not false-match an id that's a prefix of a different file's basename", () => {
  assert.equal(resolveImage("ray", ["raytracer.png"]), null);
});

test("matches correctly when a real match coexists with a prefix decoy", () => {
  assert.equal(resolveImage("ray", ["ray.png", "raytracer.png"]), "ray.png");
});
