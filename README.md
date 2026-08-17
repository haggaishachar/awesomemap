# awesomemap

[![Deploy](https://github.com/haggaishachar/awesomemap/actions/workflows/deploy.yml/badge.svg)](https://github.com/haggaishachar/awesomemap/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/haggaishachar/awesomemap?style=social)](https://github.com/haggaishachar/awesomemap/stargazers)

![awesomemap demo — zooming into Deep Learning, opening TensorFlow's detail panel, then switching to Rising mode](docs/media/demo.gif)

**[→ Explore the live maps](https://haggaishachar.github.io/awesomemap/)**

Interactive, zoomable treemaps of open-source project ecosystems. Every
rectangle is a project; its size reflects adoption, and its place in the map
is its category. Zoom into a category to see what's inside it, click any
project to see what it does and jump to its GitHub repo or homepage.

## Popular vs. Rising

Every map has two modes:

- **Popular** sizes each project by total adoption — the established players.
- **Rising** sizes each project by star-growth *velocity* over the last 7,
  30, or 90 days, computed from daily star-history snapshots — surfaces
  what's accelerating right now, before it shows up on the "popular"
  radar.

## This week's biggest risers

Star-growth leaders over the last 7 days, refreshed every Monday by the
[social digest workflow](.github/workflows/social-digest.yml) — for live,
interactive rankings across any window, use Rising mode in the maps below.

<!-- risers:start -->
1. **[Transformers](https://huggingface.co/transformers/)** (Best Data Science Open Source Projects) — +643 stars (+0.4%)
2. **[shadcn/ui](https://ui.shadcn.com)** (Best Web Development Open Source Projects) — +519 stars (+0.4%)
3. **[Playwright](https://playwright.dev)** (Best Web Development Open Source Projects) — +322 stars (+0.3%)
4. **[Supabase](https://supabase.com/)** (Best Mobile Development Open Source Projects) — +307 stars (+0.3%)
5. **[Ghidra](https://ghidra-sre.org/)** (Best Security Open Source Projects) — +260 stars (+0.4%)
<!-- risers:end -->

## Maps

| Map | Description | Projects |
| --- | --- | --- |
| [Data Science](https://haggaishachar.github.io/awesomemap/data-science/) | Machine learning, deep learning, NLP, computer vision, and more. | 51 |
| [Security](https://haggaishachar.github.io/awesomemap/security/) | Scanning, exploitation, SIEM, secrets management, forensics, and more. | 51 |
| [Web Development](https://haggaishachar.github.io/awesomemap/web-dev/) | Frontend frameworks, build tools, styling, backend frameworks, and more. | 50 |
| [Mobile Development](https://haggaishachar.github.io/awesomemap/mobile-dev/) | Cross-platform frameworks, native tooling, testing, state management, and more. | 46 |
| [DevOps & Infrastructure](https://haggaishachar.github.io/awesomemap/devops-infra/) | Containers, orchestration, CI/CD, infrastructure as code, observability, and more. | 50 |
| [Artificial Intelligence](https://haggaishachar.github.io/awesomemap/artificial-intelligence/) | LLM frameworks, AI agents, RAG, vector databases, coding assistants, and more. | 53 |
| [Databases & Data Infrastructure](https://haggaishachar.github.io/awesomemap/databases/) | Relational, NoSQL, caching, search, streaming, analytics, and more. | 49 |

More domains are on the way.

## How it works

- Each map is a curated, hand-weighted dataset of projects grouped by category.
- Click a category to zoom in; use the breadcrumb to zoom back out.
- Click any project for a detail panel with its description, GitHub link, and homepage.
- Toggle Popular/Rising and pick a growth window to see what's trending.

## Embed a map

Every map has a bare, chrome-free embed version, meant for dropping into
a blog post or another site via `<iframe>`:

```html
<iframe
  src="https://haggaishachar.github.io/awesomemap/embed/data-science/"
  width="100%" height="600" style="border:0"
></iframe>
```

Swap `data-science` for any slug from the table above.

## Contributing

Want to add a project, fix a map, or run awesomemap locally? See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=haggaishachar/awesomemap&type=Date)](https://star-history.com/#haggaishachar/awesomemap&Date)
