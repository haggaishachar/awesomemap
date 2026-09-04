/**
 * Copies `text` to the clipboard, used by the share row's "Copy link" and
 * the embed panel's "Copy" button. Prefers the async Clipboard API; falls
 * back to a hidden, off-screen `<textarea>` + `execCommand("copy")` for a
 * browser (or non-secure/http context) where `navigator.clipboard` isn't
 * available. `clipboard`/`doc` are injectable — mirrors compare-cart.js's
 * `storage` parameter — so the fallback path is exercisable from
 * `node --test` without a real DOM.
 */
export async function copyToClipboard(text, clipboard = globalThis.navigator?.clipboard, doc = globalThis.document) {
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return;
  }
  const textarea = doc.createElement("textarea");
  textarea.value = text;
  // Off-screen rather than `display: none` — some browsers refuse to
  // select() (and so copy) an element that isn't actually rendered.
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  doc.body.appendChild(textarea);
  textarea.select();
  doc.execCommand("copy");
  doc.body.removeChild(textarea);
}
