/**
 * Pure builders for the social share-intent URLs a domain page's share row
 * links out to. Kept separate from render-page.mjs (which just interpolates
 * these into plain `<a href>`s — no client JS needed for X/LinkedIn/Reddit)
 * so the URL shape itself — the encoding, the param names each network
 * expects — is unit-testable without rendering a whole page.
 */

/** Twitter/X's tweet-intent URL, pre-filled with the page url and a title. */
export function buildTwitterShareUrl(url, title) {
  const params = new URLSearchParams({ url, text: title });
  return `https://twitter.com/intent/tweet?${params}`;
}

/**
 * LinkedIn's share-offsite URL. LinkedIn scrapes the page's own og:title/
 * og:description for the post preview, so — unlike Twitter/Reddit — this
 * endpoint takes no title param of its own.
 */
export function buildLinkedInShareUrl(url) {
  const params = new URLSearchParams({ url });
  return `https://www.linkedin.com/sharing/share-offsite/?${params}`;
}

/** Reddit's submit URL, pre-filled with the page url and a suggested title. */
export function buildRedditShareUrl(url, title) {
  const params = new URLSearchParams({ url, title });
  return `https://www.reddit.com/submit?${params}`;
}
