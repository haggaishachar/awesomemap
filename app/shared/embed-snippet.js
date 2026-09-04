/**
 * Builds the copy-pasteable `<iframe>` snippet a domain page's Embed panel
 * shows — the same shape README.md's "Embed a map" section documents by
 * hand (width/height/style), plus a `title` attribute for accessibility.
 * Pure and DOM-free so the markup shape is unit-testable; render-page.mjs
 * is the only caller, and re-escapes the result itself when placing it
 * inside a `<textarea>` (a different concern — displaying HTML source as
 * literal text — from this function's own attribute-escaping below).
 */

/** Escapes text for safe interpolation into an HTML attribute value. */
function escapeAttr(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * `embedUrl` is the domain's `/embed/<slug>/` page. `domainName` becomes
 * the iframe's accessible `title` ("<name> on awesomemap"). `width`/
 * `height` match README's documented defaults (a 100%-wide, 600px-tall
 * frame) but are overridable for a caller that knows its own layout.
 */
export function buildEmbedSnippet(embedUrl, domainName, { width = "100%", height = 600 } = {}) {
  const src = escapeAttr(embedUrl);
  const title = escapeAttr(`${domainName} on awesomemap`);
  return `<iframe src="${src}" width="${width}" height="${height}" style="border:0" title="${title}"></iframe>`;
}
