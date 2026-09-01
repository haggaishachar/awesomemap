// app/shared/compare.js
import { renderTagChips } from "./detail-panel.js";
import { normalizeProjectId, MAX_COMPARE_IDS } from "./compare-url.js";
import { formatCount, formatGrowthCell } from "./compare-format.js";
import { formatStarCount, githubRepoUrl } from "./star-history.js";
import { removeFromCart, refreshCompareButtons } from "./compare-cart.js";

// scripts/ is build-time-only and never copied into dist/, so this is its
// own copy of the rising-window list generate.mjs's RISING_WINDOWS_DAYS
// produces — same reason detail-panel.js keeps its own
// DEFAULT_MOMENTUM_WINDOW_DAYS copy.
const RISING_WINDOWS_DAYS = [7, 30, 90];

/**
 * The stats table's rows, in display order. Each row knows how to render
 * its own cell text (`cell`) and, for rows where "biggest number wins" is
 * an unambiguous claim, how to pull the comparable number out of a record
 * (`winnerValue`) so `winnersForRow` can highlight the best column(s).
 * `winnerValue` is `null` for rows where a bigger number isn't obviously
 * "better" (a narrative sentence, or an open-issue count) — no winner is
 * ever computed or highlighted for those.
 */
const STAT_ROWS = [
  {
    label: "Stars",
    cell: (record) => `★ ${formatStarCount(record.weight) ?? "—"}`,
    winnerValue: (record) => record.weight,
  },
  ...RISING_WINDOWS_DAYS.map((windowDays) => {
    const key = `rising${windowDays}`;
    return {
      label: `${windowDays}d growth`,
      cell: (record) => formatGrowthCell(record.growth[key], record.hasEnoughHistory[key]),
      // Only a window with enough history is a trustworthy comparison point
      // — matches formatGrowthCell's own "Not enough history yet" gate.
      winnerValue: (record) => (record.hasEnoughHistory[key] ? record.growth[key]?.percentDelta : null),
    };
  }),
  {
    label: "Momentum",
    cell: (record) => record.signalHeadline ?? "—",
    winnerValue: null, // a narrative sentence, not a single comparable number
  },
  {
    label: "Forks",
    cell: (record) => formatCount(record.forks),
    winnerValue: (record) => (typeof record.forks === "number" ? record.forks : null),
  },
  {
    label: "Open issues",
    cell: (record) => formatCount(record.openIssues),
    winnerValue: null, // more open issues isn't unambiguously better or worse, unlike stars/growth/forks
  },
];

/**
 * Mounts the /compare/ page's table into `container`. Fetches
 * `compareIndexUrl` once (cached for the mount's lifetime), renders one
 * header card per id in `initialIds` plus an "add project" card, and calls
 * `onIdsChange(ids)` whenever the visible id list changes via the add box
 * or a column's remove button — this function never touches
 * `history`/`location` itself, the same split render-page.mjs's inline
 * bootstrap script already keeps for the treemap (see zoom-url.js).
 * Returns `{ applyIds(ids) }` so the caller can re-render after a
 * popstate navigation.
 */
export function mountCompare(container, { compareIndexUrl, basePath = "", initialIds, onIdsChange }) {
  const root = document.createElement("div");
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

  // `index` is a JSON.parse result, so it inherits from Object.prototype —
  // a truthy `index[id]` check would treat inherited keys like
  // "constructor"/"toString" as found records. Object.hasOwn checks own
  // enumerable-or-not properties only, so an id that merely collides with a
  // prototype member correctly falls through to "not found".
  function recordFor(id) {
    return index && Object.hasOwn(index, id) ? index[id] : null;
  }

  /**
   * Builds the whole comparison as a single CSS Grid — identity cards and
   * stat rows share one `grid-template-columns`, so a project's header
   * card sits directly above its own stat cells instead of the two
   * living as visually separate components that merely happen to be the
   * same width. Each "row" (header + one per STAT_ROWS entry) is a
   * `display: contents` wrapper — invisible as a box, but its cells still
   * flow into the shared grid in document order, the standard way to get
   * real HTML-table-like rows (and their `role="row"` grouping for
   * assistive tech) out of CSS Grid. See `.compare-grid` in treemap.css
   * for the column template and the mobile carousel (scroll-snap) rules.
   */
  function render() {
    root.innerHTML = "";

    const showAddColumn = currentIds.length < MAX_COMPARE_IDS;
    const columnCount = currentIds.length + (showAddColumn ? 1 : 0);
    // Zero resolved records (e.g. every id in the URL is stale) means
    // there's nothing to tabulate either — the header row's "not found"
    // placeholders already say so, and a stats grid with only a label
    // column would just be noise on top of that.
    const hasStats = currentIds.some((id) => recordFor(id));

    const wrap = document.createElement("div");
    wrap.className = "compare-grid-wrap";

    const grid = document.createElement("div");
    grid.className = "compare-grid";
    grid.style.setProperty("--compare-columns", columnCount);
    grid.setAttribute("role", "table");
    grid.setAttribute("aria-label", "Project comparison");

    const headerRow = document.createElement("div");
    headerRow.className = "compare-row compare-header-row";
    headerRow.setAttribute("role", "row");
    headerRow.appendChild(labelCell("", { role: "columnheader", spacer: true }));
    for (const id of currentIds) {
      const record = recordFor(id);
      headerRow.appendChild(record ? renderHeaderCell(record) : renderNotFoundCell(id));
    }
    if (showAddColumn) headerRow.appendChild(renderAddCell());
    grid.appendChild(headerRow);

    if (hasStats) {
      for (const row of STAT_ROWS) {
        grid.appendChild(renderStatRow(row, { showAddColumn }));
      }
    }

    wrap.appendChild(grid);
    root.appendChild(wrap);
  }

  /** Builds the `{ [id]: winning }` map for one STAT_ROWS row: the set of ids tied for the row's best value, or `null` when the row has no `winnerValue` getter, fewer than two comparable values, or every comparable value ties. */
  function winnersForRow(getValue) {
    const values = [];
    for (const id of currentIds) {
      const record = recordFor(id);
      if (!record) continue;
      const value = getValue(record);
      if (typeof value === "number" && Number.isFinite(value)) values.push([id, value]);
    }
    if (values.length < 2) return null;
    const max = Math.max(...values.map(([, value]) => value));
    if (values.every(([, value]) => value === max)) return null; // an across-the-board tie has nothing to highlight
    return new Set(values.filter(([, value]) => value === max).map(([id]) => id));
  }

  /**
   * One stat row: a sticky label cell followed by one cell per id in
   * `currentIds` (a "—" cell for an id that didn't resolve, so columns
   * stay aligned with every other row), with the row's best value(s)
   * highlighted. `display: contents` on the returned wrapper — see
   * `render`'s doc comment — so these cells land in the same grid
   * columns the header cards above already occupy.
   */
  function renderStatRow(row, { showAddColumn }) {
    const tr = document.createElement("div");
    tr.className = "compare-row";
    tr.setAttribute("role", "row");
    const winners = row.winnerValue ? winnersForRow(row.winnerValue) : null;

    tr.appendChild(labelCell(row.label, { role: "rowheader" }));

    for (const id of currentIds) {
      const record = recordFor(id);
      const td = document.createElement("div");
      td.className = "compare-cell";
      td.setAttribute("role", "cell");
      if (record) {
        td.textContent = row.cell(record);
        if (winners?.has(id)) td.classList.add("compare-winner");
      } else {
        td.textContent = "—";
        td.classList.add("compare-cell-empty");
      }
      tr.appendChild(td);
    }
    if (showAddColumn) {
      // Keeps this row under the add column, empty since it has nothing to add.
      const empty = document.createElement("div");
      empty.className = "compare-cell";
      empty.setAttribute("role", "cell");
      tr.appendChild(empty);
    }
    return tr;
  }

  /** The grid's sticky left-hand label cell — a stat's name for a stat row, or an empty spacer reserving the same column's width in the header row (see `render`). */
  function labelCell(text, { role, spacer = false }) {
    const cell = document.createElement("div");
    cell.className = "compare-cell compare-label-cell";
    cell.setAttribute("role", role);
    if (spacer) cell.classList.add("compare-label-spacer");
    else cell.textContent = text;
    return cell;
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
      // Removing here and toggling a + Compare button elsewhere are two
      // controls for the same underlying set — without this, removing a
      // column here would leave it stranded in the cart, so clicking the
      // header's "Compare (n)" link again later would silently resurrect
      // it. refreshCompareButtons updates any compare-toggle buttons
      // already on this page (there are none on /compare/ itself today,
      // but the header's Compare link is one) to match.
      removeFromCart(id);
      refreshCompareButtons();
      render();
    });
    return button;
  }

  function renderNotFoundCell(id) {
    const cell = document.createElement("div");
    cell.className = "compare-cell compare-column compare-column-missing";
    cell.setAttribute("role", "columnheader");
    cell.appendChild(removeButton(id));
    const message = document.createElement("p");
    message.textContent = `"${id}" wasn't found.`;
    cell.appendChild(message);
    return cell;
  }

  /** The header row's per-project cell: identity (logo, name, domain, description, tags) and outbound links. Numeric stats live in the rows below, not here — see STAT_ROWS. */
  function renderHeaderCell(record) {
    const column = document.createElement("div");
    column.className = "compare-cell compare-column";
    column.setAttribute("role", "columnheader");
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

  function renderAddCell() {
    const column = document.createElement("div");
    column.className = "compare-cell compare-column compare-add-column";
    column.setAttribute("role", "columnheader");

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
      if (!recordFor(id)) {
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
