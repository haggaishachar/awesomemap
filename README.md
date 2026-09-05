# awesomemap

[![Deploy](https://github.com/haggaishachar/awesomemap/actions/workflows/deploy.yml/badge.svg)](https://github.com/haggaishachar/awesomemap/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/haggaishachar/awesomemap?style=social)](https://github.com/haggaishachar/awesomemap/stargazers)

![awesomemap demo — zooming into Deep Learning, opening TensorFlow's detail panel, then switching to Rising mode](docs/media/demo.gif)

**[→ Explore the live maps](https://awesomemap.dev/)**

Interactive, zoomable treemaps of open-source project ecosystems. Every
rectangle is a project; its size reflects adoption, and its place in the
map is its category. Zoom into a category to see what's inside it, click
any project to see what it does and jump to its GitHub repo or homepage.
Flip any map to **Rising** mode and rectangles resize by star-growth
*velocity* instead — what's accelerating right now, before it's big enough
to show up on the popular view.

Nine domains, ~1,300 projects, and a full daily star-history snapshot
behind every growth number on the site — nothing here is a one-time
scrape.

## This week's signals

Every deploy — on push, and daily via [a scheduled workflow
run](.github/workflows/deploy.yml) — recomputes four highlights from that
day's star-history and surfaces them on [the homepage](https://awesomemap.dev/):

- 🔥 **Biggest mover** — the largest absolute star gain this week.
- 🚀 **Unexpected breakout** — growing fastest relative to its own
  category, i.e. outperforming its neighbors, not just growing in
  absolute terms.
- 📈 **Heating up** — the highest percentage growth in the pool.
- 👀 **One to watch** — the highest percentage growth among projects
  still under 5,000 stars — the ones worth catching early.

A snapshot from a recent deploy — the live page updates daily, this won't:

| Signal | Project | Why |
| --- | --- | --- |
| 🔥 Biggest mover | [Hermes Agent](https://awesomemap.dev/projects/NousResearch/hermes-agent/) | +3,776 stars (+1.6%) this week — AI |
| 🚀 Unexpected breakout | [Coil](https://awesomemap.dev/projects/coil-kt/coil/) | 11.4× faster than Native Android Libraries this week — Mobile Dev |
| 📈 Heating up | [MoneyPrinterTurbo](https://awesomemap.dev/projects/harry0703/MoneyPrinterTurbo/) | +2.0% this week — AI |
| 👀 One to watch | [Gazebo](https://awesomemap.dev/projects/gazebosim/gz-sim/) | +0.9% this week · ★ 1,485 — IoT & Smart Home |

See it live (filterable by domain), browse the full [Rising
leaderboard](https://awesomemap.dev/rising/) across any window, or read
[How we rank](https://awesomemap.dev/methodology/) for the exact math
behind every one of these picks.

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

More domains are on the way. Project data is maintained via
[awesomemap-data](https://github.com/haggaishachar/awesomemap-data), which
discovers, classifies, and snapshots projects on its own schedule; counts
here reflect the latest deploy.

## How it works

- Each map is a curated, hand-weighted dataset of projects grouped by category.
- Click a category to zoom in; use the breadcrumb to zoom back out.
- Click any project for a detail panel with its description, GitHub link, and homepage.
- Toggle Popular/Rising and pick a growth window to see what's trending.
- [Search](https://awesomemap.dev/search/) any project by name, tag, or description, or browse the [full tag index](https://awesomemap.dev/tags/).
- [Compare](https://awesomemap.dev/compare/) up to four projects side by side — stars, growth, and momentum in one table.
- Curious exactly how growth, the Rising score, and "this week's signals" are computed? See [How we rank](https://awesomemap.dev/methodology/).
- Share a map to X, LinkedIn, or Reddit, or copy its link, with the buttons above each map.

## Embed a map

Every map has a bare, chrome-free embed version, meant for dropping into
a blog post or another site via `<iframe>`. Click **Embed** above any map
for a ready-to-paste snippet, or write your own:

```html
<iframe
  src="https://awesomemap.dev/embed/data-science/"
  width="100%" height="600" style="border:0"
></iframe>
```

Swap `data-science` for any slug from the table above.
