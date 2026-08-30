// app/shared/compare.js
import { renderTagChips } from "./detail-panel.js";
import { normalizeProjectId, MAX_COMPARE_IDS } from "./compare-url.js";
import { formatCount, formatGrowthCell } from "./compare-format.js";
import { formatStarCount, githubRepoUrl } from "./star-history.js";

// scripts/ is build-time-only and never copied into dist/, so this is its
// own copy of the rising-window list generate.mjs's RISING_WINDOWS_DAYS
// produces — same reason detail-panel.js keeps its own
// DEFAULT_MOMENTUM_WINDOW_DAYS copy.
const RISING_WINDOWS_DAYS = [7, 30, 90];

/**
 * Mounts the /compare/ page's table into `container`. Fetches
 * `compareIndexUrl` once (cached for the mount's lifetime), renders one
 * column per id in `initialIds` plus an "add project" column, and calls
 * `onIdsChange(ids)` whenever the visible id list changes via the add box
 * or a column's remove button — this function never touches
 * `history`/`location` itself, the same split render-page.mjs's inline
 * bootstrap script already keeps for the treemap (see zoom-url.js).
 * Returns `{ applyIds(ids) }` so the caller can re-render after a
 * popstate navigation.
 */
export function mountCompare(container, { compareIndexUrl, basePath = "", initialIds, onIdsChange }) {
  const root = document.createElement("div");
  root.className = "compare-grid";
  container.appendChild(root);

  let index = null;
  let currentIds = initialIds;

  // The fetch/parse chain's .catch() is deliberately scoped to just this
  // chain (fetch + json parse + assigning `index`), not to the render()
  // call below — otherwise a bug inside render() itself would surface as
  // "Couldn't load comparison data", which is wrong: the data loaded fine,
  // rendering it is what failed.
  const indexLoaded = fetch(compareIndexUrl)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((data) => {
      index = data;
    })
    .catch(() => {
      root.innerHTML = "";
      const error = document.createElement("p");
      error.className = "compare-error";
      error.textContent = "Couldn't load comparison data. Please try reloading the page.";
      root.appendChild(error);
    });

  indexLoaded.then(() => {
    if (index) render();
  });

  function render() {
    root.innerHTML = "";
    for (const id of currentIds) {
      // `index` is a JSON.parse result, so it inherits from Object.prototype
      // — a truthy `index[id]` check would treat inherited keys like
      // "constructor"/"toString" as found records. Object.hasOwn checks own
      // enumerable-or-not properties only, so an id that merely collides
      // with a prototype member correctly falls through to "not found".
      root.appendChild(Object.hasOwn(index, id) ? renderColumn(index[id]) : renderNotFoundColumn(id));
    }
    if (currentIds.length < MAX_COMPARE_IDS) {
      root.appendChild(renderAddColumn());
    }
  }

  function removeButton(id) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "compare-remove";
    button.textContent = "×";
    button.setAttribute("aria-label", `Remove ${id} from comparison`);
    button.addEventListener("click", () => {
      currentIds = currentIds.filter((existing) => existing !== id);
      onIdsChange(currentIds);
      render();
    });
    return button;
  }

  function renderNotFoundColumn(id) {
    const column = document.createElement("div");
    column.className = "compare-column compare-column-missing";
    column.appendChild(removeButton(id));
    const message = document.createElement("p");
    message.textContent = `"${id}" wasn't found.`;
    column.appendChild(message);
    return column;
  }

  function renderColumn(record) {
    const column = document.createElement("div");
    column.className = "compare-column";
    column.appendChild(removeButton(record.id));

    if (record.image) {
      const img = document.createElement("img");
      img.className = "detail-panel-logo";
      img.src = record.image;
      img.alt = record.name;
      img.onerror = () => img.remove();
      column.appendChild(img);
    }

    const name = document.createElement("h2");
    const nameLink = document.createElement("a");
    nameLink.href = `${basePath}/projects/${record.id}/`;
    nameLink.textContent = record.name;
    name.appendChild(nameLink);
    column.appendChild(name);

    const domain = document.createElement("a");
    domain.className = "compare-domain";
    domain.href = `${basePath}/${record.domainSlug}/`;
    domain.textContent = record.domainShort;
    column.appendChild(domain);

    if (record.desc) {
      const desc = document.createElement("p");
      desc.className = "compare-desc";
      desc.textContent = record.desc;
      column.appendChild(desc);
    }

    const tagList = renderTagChips(record.tags, basePath);
    if (tagList) column.appendChild(tagList);

    column.appendChild(statRow("Stars", `★ ${formatStarCount(record.weight) ?? "—"}`));
    for (const windowDays of RISING_WINDOWS_DAYS) {
      const key = `rising${windowDays}`;
      column.appendChild(statRow(`${windowDays}d growth`, formatGrowthCell(record.growth[key], record.hasEnoughHistory[key])));
    }
    if (record.signalHeadline) {
      const signal = document.createElement("p");
      signal.className = "compare-stat compare-signal";
      signal.textContent = record.signalHeadline;
      column.appendChild(signal);
    }
    column.appendChild(statRow("Forks", formatCount(record.forks)));
    column.appendChild(statRow("Open issues", formatCount(record.openIssues)));

    if (record.link) {
      const siteLink = document.createElement("a");
      siteLink.className = "detail-panel-link";
      siteLink.href = record.link;
      siteLink.target = "_blank";
      siteLink.rel = "noopener";
      siteLink.textContent = "Visit site ↗";
      column.appendChild(siteLink);
    }

    const githubLink = document.createElement("a");
    githubLink.className = "detail-panel-link";
    githubLink.href = githubRepoUrl(record.id);
    githubLink.target = "_blank";
    githubLink.rel = "noopener";
    githubLink.textContent = "View on GitHub ↗";
    column.appendChild(githubLink);

    return column;
  }

  /** One labeled stat row, e.g. "Stars" / "★ 12,400" — the compare table's basic building block, reused for every numeric/growth row. */
  function statRow(label, value) {
    const row = document.createElement("p");
    row.className = "compare-stat";
    const labelEl = document.createElement("span");
    labelEl.className = "compare-stat-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);
    row.appendChild(document.createTextNode(value));
    return row;
  }

  function renderAddColumn() {
    const column = document.createElement("div");
    column.className = "compare-column compare-add-column";

    const form = document.createElement("form");
    form.className = "compare-add-form";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "owner/repo or GitHub URL";
    input.setAttribute("aria-label", "Add a project to compare");
    form.appendChild(input);

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Add";
    form.appendChild(submit);

    const error = document.createElement("p");
    error.className = "compare-add-error";
    form.appendChild(error);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.textContent = "";
      const id = normalizeProjectId(input.value);
      if (!id) return;
      if (!index || !Object.hasOwn(index, id)) {
        error.textContent = `Couldn't find "${id}".`;
        return;
      }
      if (currentIds.includes(id)) {
        error.textContent = `"${id}" is already in this comparison.`;
        return;
      }
      currentIds = [...currentIds, id];
      onIdsChange(currentIds);
      render();
    });

    column.appendChild(form);
    return column;
  }

  return {
    applyIds(ids) {
      currentIds = ids;
      if (index) render();
    },
  };
}
