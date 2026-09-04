# awesomemap

[![Deploy](https://github.com/haggaishachar/awesomemap/actions/workflows/deploy.yml/badge.svg)](https://github.com/haggaishachar/awesomemap/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/haggaishachar/awesomemap?style=social)](https://github.com/haggaishachar/awesomemap/stargazers)

![awesomemap demo — zooming into Deep Learning, opening TensorFlow's detail panel, then switching to Rising mode](docs/media/demo.gif)

**[→ Explore the live maps](https://awesomemap.dev/)**

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

Star-growth leaders over the last 7 days. The
[social digest workflow](.github/workflows/social-digest.yml) that used to
refresh this list every Monday is currently paused pending a cross-repo
re-wiring into `awesomemap-data` (see "How project data gets added" in
[`CONTRIBUTING.md`](CONTRIBUTING.md#how-project-data-gets-added)) — for live,
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
| [Data Science](https://awesomemap.dev/data-science/) | Machine learning, deep learning, NLP, computer vision, and more. | 140 |
| [Security](https://awesomemap.dev/security/) | Scanning, exploitation, SIEM, secrets management, forensics, and more. | 158 |
| [Web Development](https://awesomemap.dev/web-dev/) | Frontend frameworks, build tools, styling, backend frameworks, and more. | 174 |
| [Mobile Development](https://awesomemap.dev/mobile-dev/) | Cross-platform frameworks, native tooling, testing, state management, and more. | 187 |
| [DevOps & Infrastructure](https://awesomemap.dev/devops-infra/) | Containers, orchestration, CI/CD, infrastructure as code, observability, and more. | 116 |
| [Artificial Intelligence](https://awesomemap.dev/artificial-intelligence/) | LLM frameworks, AI agents, RAG, vector databases, coding assistants, and more. | 176 |
| [Databases & Data Infrastructure](https://awesomemap.dev/databases/) | Relational, NoSQL, caching, search, streaming, analytics, and more. | 98 |
| [Automation & No-Code](https://awesomemap.dev/automation/) | Workflow automation, RPA, no-code app builders, and business process tooling. | 89 |
| [IoT & Smart Home](https://awesomemap.dev/smart-home/) | Home automation platforms, embedded firmware, robotics, and device protocols. | 190 |

More domains are on the way. Project data is now maintained via [awesomemap-data](https://github.com/haggaishachar/awesomemap-data); counts here reflect the latest deploy.

## How it works

- Each map is a curated, hand-weighted dataset of projects grouped by category.
- Click a category to zoom in; use the breadcrumb to zoom back out.
- Click any project for a detail panel with its description, GitHub link, and homepage.
- Toggle Popular/Rising and pick a growth window to see what's trending.
- [Search](https://awesomemap.dev/search/) any project by name, tag, or description, or browse the [full tag index](https://awesomemap.dev/tags/).
- [Compare](https://awesomemap.dev/compare/) up to four projects side by side — stars, growth, and momentum in one table.
- Curious exactly how growth, the Rising score, and "this week's signals" are computed? See [How we rank](https://awesomemap.dev/methodology/).

## Embed a map

Every map has a bare, chrome-free embed version, meant for dropping into
a blog post or another site via `<iframe>`:

```html
<iframe
  src="https://awesomemap.dev/embed/data-science/"
  width="100%" height="600" style="border:0"
></iframe>
```

Swap `data-science` for any slug from the table above.

## Contributing

Know a project that belongs on one of the maps? Suggest it at
[awesomemap.dev/submit/](https://awesomemap.dev/submit/) — no PR needed,
it's reviewed automatically within minutes. Want to improve the site
itself or run it locally? See [CONTRIBUTING.md](CONTRIBUTING.md).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=haggaishachar/awesomemap&type=Date)](https://star-history.com/#haggaishachar/awesomemap&Date)
