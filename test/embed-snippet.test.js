import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEmbedSnippet } from "../app/shared/embed-snippet.js";

test("buildEmbedSnippet returns a copy-pasteable iframe tag with the given src, matching README's documented attributes", () => {
  const snippet = buildEmbedSnippet("https://awesomemap.dev/embed/data-science/", "Data Science");
  assert.equal(
    snippet,
    '<iframe src="https://awesomemap.dev/embed/data-science/" width="100%" height="600" style="border:0" title="Data Science on awesomemap"></iframe>'
  );
});

test("buildEmbedSnippet escapes '\"' and '<' in the domain name so it can't break out of the title attribute", () => {
  const snippet = buildEmbedSnippet("https://awesomemap.dev/embed/evil/", 'Evil"><script>alert(1)</script>');
  assert.doesNotMatch(snippet, /<script>/);
  assert.match(snippet, /title="Evil&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; on awesomemap"/);
});

test("buildEmbedSnippet honors a custom width/height", () => {
  const snippet = buildEmbedSnippet("https://awesomemap.dev/embed/data-science/", "Data Science", { width: "800", height: 400 });
  assert.match(snippet, /width="800" height="400"/);
});
