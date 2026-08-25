const DEFAULT_MODEL = "google/gemini-3.7-flash";

const CLASSIFY_TOOL = {
  type: "function",
  function: {
    name: "classify_candidates",
    description: "Classify each candidate project into the domain's existing category tree, or flag that it needs a new category.",
    parameters: {
      type: "object",
      properties: {
        classifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              fits: { type: "boolean" },
              path: { type: "array", items: { type: "string" } },
              confidence: { type: "number" },
              suggestedNewCategory: { type: "string" },
              reason: { type: "string" },
            },
            required: ["id", "fits", "confidence", "reason"],
          },
        },
      },
      required: ["classifications"],
    },
  },
};

/**
 * Dedups every `path` array already present in a domain's projects into a
 * sorted, "/"-joined breadcrumb list (e.g. "LLM Infrastructure / LLM
 * Frameworks & Runtimes"), for embedding in the classification prompt and
 * for validating the LLM's response against real categories.
 */
export function buildCategoryTree(domain) {
  const seen = new Set(domain.projects.map((project) => project.path.join(" / ")));
  return [...seen].sort();
}

/**
 * Builds the { system, candidatesText } content for one domain's
 * classification request: the domain's name/description, its existing
 * category tree, and every candidate's id/description/topics. Kept as
 * plain strings rather than a provider-specific message shape, so
 * `callOpenRouterApi` is the only place that knows the request format.
 */
export function buildClassificationPrompt(domain, categoryTree, candidates) {
  const system = [
    `You are classifying candidate GitHub projects for the "${domain.name}" map on awesomemap.dev.`,
    `Domain description: ${domain.description}`,
    "",
    "Existing categories (breadcrumb paths from root to leaf):",
    ...categoryTree.map((path) => `- ${path}`),
    "",
    "For each candidate, decide whether it genuinely fits this domain. If it does, pick the existing category path that fits best, reusing one exactly as listed above whenever possible. If none fits well, omit path and set suggestedNewCategory to a short new category name instead. Always include a confidence score from 0 to 1 and a one-sentence reason.",
  ].join("\n");

  const candidatesText = candidates.map((c) => `id: ${c.id}\ndescription: ${c.description}\ntopics: ${(c.topics ?? []).join(", ")}`).join("\n\n");

  return { system, candidatesText };
}

/**
 * Calls OpenRouter's OpenAI-compatible chat-completions endpoint, forcing
 * a `classify_candidates` tool call so the response is always structured
 * JSON, never free-text to regex against. `fetchImpl` is injected for
 * testability (same pattern as enrich-domain.mjs's createGetJson).
 * `model` defaults to the OPENROUTER_MODEL env var, falling back to a
 * current, cheap Gemini Flash model — this call's input (a category tree
 * plus a handful of short candidate descriptions) and output (a small
 * JSON array) don't need a frontier model.
 */
export async function callOpenRouterApi(prompt, { apiKey, model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL, fetchImpl = fetch } = {}) {
  const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.candidatesText },
      ],
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "function", function: { name: "classify_candidates" } },
    }),
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText ?? ""} from OpenRouter`.trim());
  }

  const body = await res.json();
  const call = body.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("OpenRouter response had no classify_candidates tool call");
  return JSON.parse(call.function.arguments).classifications;
}

/**
 * True when a classification entry has the required shape: boolean
 * `fits`, a numeric `confidence` in [0, 1], a string `reason`, and — if
 * `fits` is true — either a `path` breadcrumb that exactly matches or
 * extends an existing `categoryTree` entry, or a `suggestedNewCategory`.
 * A `fits: true` entry with neither `path` nor `suggestedNewCategory` is
 * invalid too, not just an entry with a bad `path` — otherwise it would
 * sail through `routeCandidate` as `"qualifies"` and get auto-committed
 * with `path: null`, which breaks every consumer expecting `path` to be
 * an array (see CONTRIBUTING.md's schema).
 */
function isValidClassification(entry, categoryTree) {
  if (!entry || typeof entry.fits !== "boolean") return false;
  if (typeof entry.confidence !== "number" || entry.confidence < 0 || entry.confidence > 1) return false;
  if (typeof entry.reason !== "string") return false;
  if (entry.fits && !entry.path && !entry.suggestedNewCategory) return false;
  if (entry.path != null) {
    if (!Array.isArray(entry.path) || entry.path.length === 0) return false;
    const breadcrumb = entry.path.join(" / ");
    const matchesExisting = categoryTree.some(
      (existing) => existing === breadcrumb || existing.startsWith(`${breadcrumb} / `) || breadcrumb.startsWith(`${existing} / `),
    );
    if (!matchesExisting && !entry.suggestedNewCategory) return false;
  }
  return true;
}

/**
 * Classifies one domain's quality-passing candidates via `callLlm`
 * (propagates a whole-call failure straight through — the caller wraps
 * this in retry logic and decides whether to skip the domain for the
 * day, per discover-projects.mjs). Validates the response per candidate:
 * a candidate missing from the response, or whose entry fails
 * `isValidClassification`, is never dropped — it comes back with
 * `{ fits: null, reason: "unparseable classification" }` so it still
 * reaches the review queue rather than being silently discarded or
 * auto-committed on bad data.
 */
export async function classifyCandidates(domain, candidates, { callLlm }) {
  const categoryTree = buildCategoryTree(domain);
  const prompt = buildClassificationPrompt(domain, categoryTree, candidates);
  const raw = await callLlm(prompt);

  const byId = new Map((Array.isArray(raw) ? raw : []).map((entry) => [entry?.id, entry]));

  return candidates.map((candidate) => {
    const entry = byId.get(candidate.id);
    if (isValidClassification(entry, categoryTree)) {
      return {
        id: candidate.id,
        fits: entry.fits,
        path: entry.path ?? null,
        confidence: entry.confidence,
        suggestedNewCategory: entry.suggestedNewCategory ?? null,
        reason: entry.reason,
      };
    }
    return { id: candidate.id, fits: null, path: null, confidence: 0, suggestedNewCategory: null, reason: "unparseable classification" };
  });
}
