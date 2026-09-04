import { test } from "node:test";
import assert from "node:assert/strict";
import { copyToClipboard } from "../app/shared/clipboard.js";

/** Minimal fake matching the bit of the Clipboard API this module calls. */
function fakeClipboard() {
  const calls = [];
  return { calls, writeText: async (text) => calls.push(text) };
}

/** Minimal fake matching the bit of `document` the execCommand fallback needs. */
function fakeDocument() {
  const commands = [];
  const body = {
    children: [],
    appendChild(el) {
      this.children.push(el);
    },
    removeChild(el) {
      this.children = this.children.filter((c) => c !== el);
    },
  };
  return {
    body,
    commands,
    execCommand: (command) => commands.push(command),
    createElement: () => ({ style: {}, select() {} }),
  };
}

test("copyToClipboard writes the text via the Clipboard API when available", async () => {
  const clipboard = fakeClipboard();
  await copyToClipboard("hello", clipboard, fakeDocument());
  assert.deepEqual(clipboard.calls, ["hello"]);
});

test("copyToClipboard falls back to a hidden textarea + execCommand('copy') when there's no Clipboard API", async () => {
  const doc = fakeDocument();
  await copyToClipboard("hello", undefined, doc);
  assert.deepEqual(doc.commands, ["copy"]);
});

test("copyToClipboard's fallback removes the textarea it created, leaving the document unchanged", async () => {
  const doc = fakeDocument();
  await copyToClipboard("hello", undefined, doc);
  assert.deepEqual(doc.body.children, []);
});
