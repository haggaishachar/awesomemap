import { githubRepoUrl, formatStarCount, starHistoryFor, buildSparklinePath, starHistoryCaption } from "./star-history.js";

// Popular mode has no "active" rising window of its own, but every leaf
// still carries growth data for every window (see velocity.mjs's
// computeProjectSizing) — defaulting to the shortest window here is what
// makes momentum visible in Popular mode, not just Rising mode. Duplicated
// from scripts/velocity.mjs's RISING_WINDOWS_DAYS[0] rather than imported,
// for the same reason treemap.js's own copy of that list is duplicated:
// scripts/ is build-time-only and never copied into dist/.
const DEFAULT_MOMENTUM_WINDOW_DAYS = 7;

/**
 * Turns a raw tag string into its URL path segment. Mirrors
 * `render-page.mjs`'s identical `tagSlug` — duplicated rather than
 * shared, since this file runs in the browser and can't import the
 * server-side module; both sides are a one-line `encodeURIComponent`, so
 * the duplication is cheap to keep in sync.
 */
function tagSlug(tag) {
  return encodeURIComponent(tag);
}

/** Builds the row of tag chips shown on a project's detail panel, or `null` when it has no tags. Each chip links to that tag's `/tags/<slug>/` page. */
function renderTagChips(tags, basePath) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const list = document.createElement("div");
  list.className = "detail-panel-tags";
  for (const tag of tags) {
    const chip = document.createElement("a");
    chip.className = "detail-panel-tag";
    chip.href = `${basePath}/tags/${tagSlug(tag)}/`;
    chip.textContent = tag;
    list.appendChild(chip);
  }
  return list;
}

/**
 * Creates a slide-in detail panel appended to `container`. A leaf's
 * `image`, when present, is already a direct URL into its source repo.
 * `leafData` passed to `open()` may carry an `activeSizeKey` field (set by
 * treemap.js) naming the size mode active when the leaf was clicked; a
 * growth-stat line is always shown, using the leaf's `growth`/
 * `hasEnoughHistory` data for whichever window is active — when
 * `activeSizeKey` names a "rising*" key that window is used, otherwise
 * (Popular mode, which has no "active" rising window of its own) it falls
 * back to `DEFAULT_MOMENTUM_WINDOW_DAYS`. `historyUrl`, when given, is the
 * domain's `history.json` (see render-page.mjs) — fetched lazily and
 * cached on first use to draw a leaf's star-history sparkline.
 * `showProjectPageLink` (default `true`) controls whether a "View full
 * project page" link to the leaf's `/projects/<id>/` page is rendered;
 * pass `false` when embedding the panel somewhere that page would be
 * redundant (e.g. the project page itself). Returns { open(leafData), close() }.
 */
export function createDetailPanel(container, { historyUrl, basePath = "", showProjectPageLink = true } = {}) {
  const panel = document.createElement("aside");
  panel.className = "detail-panel";
  container.appendChild(panel);

  // Cached across opens so the domain's history.json is fetched at most
  // once per page load, not once per leaf click.
  let historyPromise = null;
  function loadHistory() {
    if (!historyUrl) return Promise.resolve({});
    if (!historyPromise) {
      historyPromise = fetch(historyUrl)
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({}));
    }
    return historyPromise;
  }

  // Renders the sparkline (and its caption) into `chartContainer` once the
  // domain's history resolves. `chartContainer` is unique per `open()`
  // call, and gets detached by the next `open()`'s `panel.innerHTML = ""`
  // (or by `close()`) — the `isConnected` check drops a stale fetch that
  // resolves after the panel has already moved on to a different leaf.
  function attachStarHistoryChart(chartContainer, id) {
    loadHistory().then((historyData) => {
      if (!chartContainer.isConnected) return;

      const series = starHistoryFor(historyData, id);
      const spark = buildSparklinePath(series);
      if (!spark) return;

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("detail-panel-star-chart-svg");
      svg.setAttribute("viewBox", `0 0 ${spark.width} ${spark.height}`);
      svg.setAttribute("width", spark.width);
      svg.setAttribute("height", spark.height);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", spark.path);
      svg.appendChild(path);
      chartContainer.appendChild(svg);

      const caption = document.createElement("p");
      caption.className = "detail-panel-star-chart-caption";
      caption.textContent = starHistoryCaption(series);
      chartContainer.appendChild(caption);
    });
  }

  function close() {
    panel.classList.remove("detail-panel-open");
    panel.innerHTML = "";
  }

  function open(leafData) {
    panel.innerHTML = "";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "detail-panel-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.addEventListener("click", close);
    panel.appendChild(closeButton);

    if (leafData.image) {
      const img = document.createElement("img");
      img.className = "detail-panel-logo";
      img.src = leafData.image;
      img.alt = leafData.name;
      img.onerror = () => img.remove();
      panel.appendChild(img);
    }

    const title = document.createElement("h2");
    title.textContent = leafData.name;
    panel.appendChild(title);

    const growthLine = renderGrowthLine(leafData);
    if (growthLine) panel.appendChild(growthLine);

    const rankLine = renderDomainRankLine(leafData);
    if (rankLine) panel.appendChild(rankLine);

    if (leafData.desc) {
      const desc = document.createElement("p");
      desc.textContent = leafData.desc;
      panel.appendChild(desc);
    }

    const tagList = renderTagChips(leafData.tags, basePath);
    if (tagList) panel.appendChild(tagList);

    if (leafData.id) {
      const starsLink = document.createElement("a");
      starsLink.className = "detail-panel-stars";
      starsLink.href = githubRepoUrl(leafData.id);
      starsLink.target = "_blank";
      starsLink.rel = "noopener";
      const starCount = formatStarCount(leafData.weight);
      starsLink.textContent = starCount ? `★ ${starCount} stars on GitHub` : "★ View on GitHub";
      panel.appendChild(starsLink);

      const chartContainer = document.createElement("div");
      chartContainer.className = "detail-panel-star-chart";
      panel.appendChild(chartContainer);
      attachStarHistoryChart(chartContainer, leafData.id);
    }

    if (leafData.link) {
      const link = document.createElement("a");
      link.className = "detail-panel-link";
      link.href = leafData.link;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Visit site ↗";
      panel.appendChild(link);
    }

    if (showProjectPageLink && leafData.id) {
      const projectLink = document.createElement("a");
      projectLink.className = "detail-panel-link";
      projectLink.href = `${basePath}/projects/${leafData.id}/`;
      projectLink.textContent = "View full project page →";
      panel.appendChild(projectLink);
    }

    panel.classList.add("detail-panel-open");
  }

  return { open, close };
}

/**
 * Builds the growth line ("+340 stars (+18%) in 30 days", or an
 * insufficient-history notice) for `leafData.activeSizeKey`. In Popular
 * mode (no `activeSizeKey`, or `"popular"`) this falls back to
 * DEFAULT_MOMENTUM_WINDOW_DAYS rather than showing nothing — Popular is the
 * mode every visitor lands in by default, so it's the one place a momentum
 * blind spot mattered most.
 */
function renderGrowthLine(leafData) {
  const key =
    leafData.activeSizeKey && leafData.activeSizeKey !== "popular"
      ? leafData.activeSizeKey
      : `rising${DEFAULT_MOMENTUM_WINDOW_DAYS}`;

  const paragraph = document.createElement("p");
  paragraph.className = "detail-panel-growth";

  const windowDays = key.replace("rising", "");
  const stats = leafData.growth?.[key];

  if (leafData.hasEnoughHistory?.[key] === false) {
    paragraph.textContent = stats?.oldestDate
      ? `Not enough history yet — first tracked ${stats.oldestDate}.`
      : "Not enough history yet.";
    return paragraph;
  }

  if (!stats) return null;

  const sign = stats.starDelta >= 0 ? "+" : "";
  const percent = Math.round(stats.percentDelta);
  paragraph.textContent = `${sign}${stats.starDelta} stars (${sign}${percent}%) in ${windowDays} days`;
  return paragraph;
}

/**
 * Builds the Rising-mode rank line ("#3 rising in AI over 7 days") from the
 * per-window `domainRank` stamped on each leaf at build time.
 *
 * This is the context a GitHub Trending card can't carry: Trending ranks a
 * repo against everything on GitHub at once, so a specialised tool that leads
 * its own field is indistinguishable from one that's merely mid-pack. Keyed by
 * the active window like `renderGrowthLine`, so it stays truthful when the
 * visitor switches windows; returns `null` in Popular mode or when the project
 * doesn't rank in the current window.
 */
function renderDomainRankLine(leafData) {
  const key = leafData.activeSizeKey;
  if (!key || key === "popular") return null;

  const rank = leafData.domainRank?.[key];
  if (typeof rank !== "number") return null;

  const windowDays = key.replace("rising", "");
  const domain = leafData.domainShort;
  const paragraph = document.createElement("p");
  paragraph.className = "detail-panel-rank";
  paragraph.textContent = domain
    ? `#${rank} rising in ${domain} over ${windowDays} days`
    : `#${rank} rising in this domain over ${windowDays} days`;
  return paragraph;
}
