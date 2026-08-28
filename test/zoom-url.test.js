import { test } from "node:test";
import assert from "node:assert/strict";
import { parseZoomState, formatZoomState } from "../app/shared/zoom-url.js";

const VALID_WINDOWS = [7, 30, 90];
const ROOT_ID = "web-frameworks";

test("parseZoomState defaults to root/popular/first window when the query string is empty", () => {
  const state = parseZoomState(new URLSearchParams(""), { rootId: ROOT_ID, validWindows: VALID_WINDOWS });
  assert.deepEqual(state, { mode: "popular", window: 7, idPath: [ROOT_ID] });
});

test("parseZoomState reads mode, window, and repeated path segments in order", () => {
  const state = parseZoomState(new URLSearchParams("mode=rising&window=30&path=frontend&path=react-ecosystem"), {
    rootId: ROOT_ID,
    validWindows: VALID_WINDOWS,
  });
  assert.deepEqual(state, { mode: "rising", window: 30, idPath: [ROOT_ID, "frontend", "react-ecosystem"] });
});

test("parseZoomState falls back to popular for an unrecognized mode value", () => {
  const state = parseZoomState(new URLSearchParams("mode=bogus"), { rootId: ROOT_ID, validWindows: VALID_WINDOWS });
  assert.equal(state.mode, "popular");
});

test("parseZoomState falls back to the first valid window for an out-of-range window value", () => {
  const state = parseZoomState(new URLSearchParams("mode=rising&window=999"), {
    rootId: ROOT_ID,
    validWindows: VALID_WINDOWS,
  });
  assert.equal(state.window, 7);
});

test("parseZoomState decodes a percent-encoded path segment", () => {
  const state = parseZoomState(new URLSearchParams("path=a%20b"), { rootId: ROOT_ID, validWindows: VALID_WINDOWS });
  assert.deepEqual(state.idPath, [ROOT_ID, "a b"]);
});

test("formatZoomState returns an empty string for the root/popular/default-window state", () => {
  const query = formatZoomState(
    { mode: "popular", window: 7, idPath: [ROOT_ID] },
    { rootId: ROOT_ID, validWindows: VALID_WINDOWS }
  );
  assert.equal(query, "");
});

test("formatZoomState encodes a zoomed-in rising state with a non-default window", () => {
  const query = formatZoomState(
    { mode: "rising", window: 30, idPath: [ROOT_ID, "frontend", "react-ecosystem"] },
    { rootId: ROOT_ID, validWindows: VALID_WINDOWS }
  );
  assert.equal(query, "?path=frontend&path=react-ecosystem&mode=rising&window=30");
});

test("formatZoomState omits window when mode is popular, even if a rising window was previously set", () => {
  const query = formatZoomState(
    { mode: "popular", window: 30, idPath: [ROOT_ID] },
    { rootId: ROOT_ID, validWindows: VALID_WINDOWS }
  );
  assert.equal(query, "");
});

test("round-trips a category id containing a literal slash (e.g. a 'CI/CD' category name)", () => {
  const original = { mode: "popular", window: 7, idPath: [ROOT_ID, "CI/CD"] };
  const query = formatZoomState(original, { rootId: ROOT_ID, validWindows: VALID_WINDOWS });
  const parsed = parseZoomState(new URLSearchParams(query.slice(1)), { rootId: ROOT_ID, validWindows: VALID_WINDOWS });
  assert.deepEqual(parsed, original);
});

test("round-trips a multi-level zoomed rising state through format then parse", () => {
  const original = { mode: "rising", window: 90, idPath: [ROOT_ID, "frontend", "react-ecosystem"] };
  const query = formatZoomState(original, { rootId: ROOT_ID, validWindows: VALID_WINDOWS });
  const parsed = parseZoomState(new URLSearchParams(query.slice(1)), { rootId: ROOT_ID, validWindows: VALID_WINDOWS });
  assert.deepEqual(parsed, original);
});
