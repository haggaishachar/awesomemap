import { githubRepoUrl, formatStarCount, starHistoryFor, buildSparklinePath, starHistoryCaption } from "./star-history.js";

/**
 * Creates a slide-in detail panel appended to `container`. A leaf's
 * `image`, when present, is already a direct URL into its source repo.
 * `leafData` passed to `open()` may carry an `activeSizeKey` field (set by
 * treemap.js) naming the size mode active when the leaf was clicked; when
 * it's a "rising*" key, a growth-stat line is shown using the leaf's
 * `growth`/`hasEnoughHistory` data for that window. `historyUrl`, when
 * given, is the domain's `history.json` (see render-page.mjs) — fetched
 * lazily and cached on first use to draw a leaf's star-history sparkline.
 * Returns { open(leafData), close() }.
 */
export function createDetailPanel(container, { historyUrl } = {}) {
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

    if (leafData.desc) {
      const desc = document.createElement("p");
      desc.textContent = leafData.desc;
      panel.appendChild(desc);
    }

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

    panel.classList.add("detail-panel-open");
  }

  return { open, close };
}

/**
 * Builds the Rising-mode growth line ("+340 stars (+18%) in 30 days", or
 * an insufficient-history notice) for `leafData.activeSizeKey`. Returns
 * `null` for Popular mode (no `activeSizeKey`, or `"popular"`) — there's
 * no growth stat to show there.
 */
function renderGrowthLine(leafData) {
  const key = leafData.activeSizeKey;
  if (!key || key === "popular") return null;

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
