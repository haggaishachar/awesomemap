/**
 * Creates a slide-in detail panel appended to `container`. `imageBaseUrl`
 * resolves the leaf's `image` filename. Returns { open(leafData), close() }.
 */
export function createDetailPanel(container, imageBaseUrl) {
  const panel = document.createElement("aside");
  panel.className = "detail-panel";
  container.appendChild(panel);

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
      img.src = imageBaseUrl + leafData.image;
      img.alt = leafData.name;
      img.onerror = () => img.remove();
      panel.appendChild(img);
    }

    const title = document.createElement("h2");
    title.textContent = leafData.name;
    panel.appendChild(title);

    if (leafData.desc) {
      const desc = document.createElement("p");
      desc.textContent = leafData.desc;
      panel.appendChild(desc);
    }

    if (leafData.gh) {
      const ghFrame = document.createElement("iframe");
      ghFrame.className = "detail-panel-gh-button";
      ghFrame.src = githubStarButtonUrl(leafData.gh);
      ghFrame.width = "170";
      ghFrame.height = "30";
      ghFrame.frameBorder = "0";
      ghFrame.scrolling = "no";
      ghFrame.title = "GitHub Stars";
      panel.appendChild(ghFrame);
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
 * Builds a ghbtns.com star-count button URL from a github.com repo URL.
 * Using the iframe embed (rather than the buttons.github.io script, which
 * only scans the DOM once at page load) works correctly for buttons added
 * dynamically after the page has loaded.
 */
function githubStarButtonUrl(repoUrl) {
  const [, user, repo] = new URL(repoUrl).pathname.split("/");
  return `https://ghbtns.com/github-btn.html?user=${user}&repo=${repo}&type=star&count=true`;
}
