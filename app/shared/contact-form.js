/**
 * Pure helpers for the /contact/ page's form. Framework- and DOM-free (no
 * `window`/`location` access), same convention as submit-project.js.
 *
 * There's no write-capable backend on this static site, so — same as
 * submit-project.js hands its write off to a prefilled GitHub issue URL —
 * this hands the actual delivery off to the visitor's own mail client via a
 * prefilled `mailto:` URL. Nothing is sent from here or from any server;
 * the visitor still has to hit "send" in whatever mail app opens.
 */

/** Loose but sufficient check for "looks like an email address" — not RFC 5322 validation, just enough to catch an empty or obviously-wrong value before building a mailto: URL. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when `email` looks like an email address and `message` isn't blank. `name` is optional. */
export function isValidContactInput({ email, message }) {
  return EMAIL_PATTERN.test((email ?? "").trim()) && (message ?? "").trim().length > 0;
}

/**
 * Builds the mailto: body: sender's name and email (so the "awesome@"
 * inbox knows who to reply to and how, since a mailto: link's own From
 * address is whatever the visitor's mail client is configured with) followed
 * by their message. `name` falls back to placeholder text rather than an
 * empty field, matching submit-project.js's buildSubmissionIssueBody
 * convention for optional fields.
 */
export function buildContactMailtoBody({ name, email, message }) {
  return [`Name: ${name?.trim() || "(not given)"}`, `Email: ${email?.trim() || ""}`, "", message?.trim() || ""].join("\n");
}

/**
 * Builds the full `mailto:` URL for `to` (defaults to this site's inbox).
 * Callers validate via isValidContactInput first. Subject names the sender
 * when given, so the inbox doesn't just see a wall of identical subjects.
 *
 * Encodes `subject`/`body` with `encodeURIComponent` rather than
 * `URLSearchParams` — a mailto: URI's hfields are percent-encoded per RFC
 * 6068, not `application/x-www-form-urlencoded` like an HTTP query string
 * (which is what /submit/'s GitHub-issue URL is, and why that one *can* use
 * URLSearchParams). URLSearchParams would encode spaces as `+`, which a
 * mailto: URI has no special meaning for — most mail clients would show a
 * literal "+" instead of a space.
 */
export function buildContactMailtoUrl({ name, email, message }, { to = "awesome@awesomemap.dev" } = {}) {
  const trimmedName = name?.trim();
  const subject = trimmedName ? `Message from ${trimmedName} via awesomemap` : "Message via awesomemap contact form";
  const body = buildContactMailtoBody({ name, email, message });
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
