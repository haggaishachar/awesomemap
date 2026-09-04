import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidContactInput, buildContactMailtoBody, buildContactMailtoUrl } from "../app/shared/contact-form.js";

test("isValidContactInput accepts a plausible email with a non-empty message", () => {
  assert.equal(isValidContactInput({ name: "Ada", email: "ada@example.com", message: "Hello" }), true);
});

test("isValidContactInput rejects a malformed email", () => {
  assert.equal(isValidContactInput({ name: "Ada", email: "not-an-email", message: "Hello" }), false);
  assert.equal(isValidContactInput({ name: "Ada", email: "", message: "Hello" }), false);
});

test("isValidContactInput rejects a blank or whitespace-only message", () => {
  assert.equal(isValidContactInput({ name: "Ada", email: "ada@example.com", message: "" }), false);
  assert.equal(isValidContactInput({ name: "Ada", email: "ada@example.com", message: "   " }), false);
});

test("isValidContactInput does not require a name", () => {
  assert.equal(isValidContactInput({ name: "", email: "ada@example.com", message: "Hello" }), true);
});

test("buildContactMailtoBody includes the sender's name, email, and message, in that order", () => {
  const body = buildContactMailtoBody({ name: "Ada Lovelace", email: "ada@example.com", message: "Love the site!" });
  assert.match(body, /Name: Ada Lovelace/);
  assert.match(body, /Email: ada@example\.com/);
  assert.match(body, /Love the site!/);
  assert.ok(body.indexOf("Name:") < body.indexOf("Email:") && body.indexOf("Email:") < body.indexOf("Love the site!"));
});

test("buildContactMailtoBody falls back to placeholder text for a blank name", () => {
  const body = buildContactMailtoBody({ name: "", email: "ada@example.com", message: "Hi" });
  assert.match(body, /Name: \(not given\)/);
});

test("buildContactMailtoUrl points at awesome@awesomemap.dev with the subject and body encoded as query params", () => {
  const url = buildContactMailtoUrl({ name: "Ada Lovelace", email: "ada@example.com", message: "Love the site!" });
  assert.match(url, /^mailto:awesome@awesomemap\.dev\?/);
  const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
  assert.equal(params.get("subject"), "Message from Ada Lovelace via awesomemap");
  assert.match(params.get("body"), /Love the site!/);
});

test("buildContactMailtoUrl uses a generic subject when no name is given", () => {
  const url = buildContactMailtoUrl({ name: "", email: "ada@example.com", message: "Hi" });
  const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
  assert.equal(params.get("subject"), "Message via awesomemap contact form");
});
