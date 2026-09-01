// app/shared/search.js
import { rankProjects } from "./search-match.js";
import { formatStarCount } from "./star-history.js";
import { refreshCompareButtons } from "./compare-cart.js";

// How long to wait, after the last keystroke, before re-filtering and
// updating the URL — filtering hundreds of records and touching
// history.replaceState on every keystroke of a fast typist is wasted work
// for intermediate states nobody ever sees.
const FILTER_DEBOUNCE_MS = 150;

/**
 * Mounts the /search/ page into `container`. Fetches `searchIndexUrl`
 * (dist/compare-index.json — the same cross-domain project index the
 * /compare/ page already ships) once, then filters/ranks it client-side via
 * `rankProjects` as the visitor types. `onQueryChange(query)` fires
 * (debounced, see FILTER_DEBOUNCE_MS) whenever the query changes, so the
 * caller can reflect it in the URL without this module touching
 * `history`/`location` itself — the same split render-page.mjs's inline
 * bootstrap script keeps for the treemap and /compare/ (see zoom-url.js,
 * compare-url.js).
 */
export function mountSearch(container, { searchIndexUrl, basePath = "", initialQuery = "", onQueryChange }) {
  const root = document.createElement("div");
  root.className = "search-page";
  container.appendChild(root);

  const box = document.createElement("div");
  box.className = "search-box";
  const input = document.createElement("input");
  input.type = "search";
  input.className = "search-input";
  input.placeholder = "Search by name, tag, or description…";
  input.setAttribute("aria-label", "Search projects");
  input.value = initialQuery;
  box.appendChild(input);
  root.appendChild(box);

  const status = document.createElement("p");
  status.className = "search-status";
  status.setAttribute("role", "status");
  root.appendChild(status);

  const resultsEl = document.createElement("div");
  root.appendChild(resultsEl);

  let records = null;

  const indexLoaded = fetch(searchIndexUrl)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((index) => {
      records = Object.values(index);
    })
    .catch(() => {
      status.textContent = "Couldn't load the project index. Please try reloading the page.";
    });

  indexLoaded.then(() => {
    if (records) renderResults(input.value);
  });

  function renderResults(query) {
    const trimmed = query.trim();

    if (trimmed === "") {
      status.textContent = records ? `Search across ${records.length.toLocaleString("en-US")} projects.` : "Loading…";
      resultsEl.innerHTML = "";
      return;
    }

    const matches = rankProjects(records, trimmed);
    if (matches.length === 0) {
      status.textContent = `No projects match "${trimmed}".`;
      resultsEl.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "search-empty";
      const link = document.createElement("a");
      link.className = "search-empty-link";
      link.href = `${basePath}/submit/`;
      link.textContent = "Don't see it? Suggest a project →";
      empty.appendChild(link);
      resultsEl.appendChild(empty);
      return;
    }

    status.textContent = `${matches.length.toLocaleString("en-US")} project${matches.length === 1 ? "" : "s"} match "${trimmed}".`;
    resultsEl.innerHTML = "";
    resultsEl.appendChild(renderRows(matches));
    // Rows just entered the DOM with fresh + Compare buttons — sync their
    // Added/not-added state to the cart (initCompareCartUI's own call ran
    // before these existed).
    refreshCompareButtons();
  }

  function renderRows(matches) {
    const list = document.createElement("ol");
    list.className = "search-rows-list";
    for (const record of matches) list.appendChild(renderRow(record));
    return list;
  }

  function renderRow(record) {
    const li = document.createElement("li");
    li.className = "search-row";

    if (record.image) {
      const icon = document.createElement("img");
      icon.className = "search-row-icon";
      icon.src = record.image;
      icon.alt = "";
      icon.loading = "lazy";
      icon.onerror = () => icon.remove();
      li.appendChild(icon);
    }

    const body = document.createElement("div");
    body.className = "search-row-body";

    const titleLine = document.createElement("div");
    titleLine.className = "search-row-title-line";

    const name = document.createElement("a");
    name.className = "search-row-name";
    name.href = `${basePath}/projects/${record.id}/`;
    name.textContent = record.name;
    titleLine.appendChild(name);

    const domain = document.createElement("span");
    domain.className = "search-row-domain";
    domain.title = record.domainShort;
    domain.textContent = record.domainShort;
    titleLine.appendChild(domain);

    const stars = document.createElement("span");
    stars.className = "search-row-stars";
    stars.textContent = `★ ${formatStarCount(record.weight) ?? "—"}`;
    titleLine.appendChild(stars);

    body.appendChild(titleLine);

    if (record.desc) {
      const desc = document.createElement("p");
      desc.className = "search-row-desc";
      desc.textContent = record.desc;
      body.appendChild(desc);
    }

    li.appendChild(body);

    const compareToggle = document.createElement("button");
    compareToggle.type = "button";
    compareToggle.className = "search-row-compare compare-toggle";
    compareToggle.dataset.compareId = record.id;
    compareToggle.setAttribute("aria-pressed", "false");
    compareToggle.textContent = "+ Compare";
    li.appendChild(compareToggle);

    return li;
  }

  let debounceTimer = null;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = input.value;
      if (records) renderResults(query);
      onQueryChange?.(query.trim());
    }, FILTER_DEBOUNCE_MS);
  });

  if (initialQuery.trim() !== "") status.textContent = "Loading…";
}
