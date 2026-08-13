# awesomemap

[![Deploy](https://github.com/haggaishachar/awesomemap/actions/workflows/deploy.yml/badge.svg)](https://github.com/haggaishachar/awesomemap/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/haggaishachar/awesomemap?style=social)](https://github.com/haggaishachar/awesomemap/stargazers)

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

## Maps

| Map | Description | Projects |
| --- | --- | --- |
| [Data Science](https://haggaishachar.github.io/awesomemap/data-science/) | Machine learning, deep learning, NLP, computer vision, and more. | 44 |
| [Security](https://haggaishachar.github.io/awesomemap/security/) | Scanning, exploitation, SIEM, secrets management, forensics, and more. | 51 |
| [Web Development](https://haggaishachar.github.io/awesomemap/web-dev/) | Frontend frameworks, build tools, styling, backend frameworks, and more. | 50 |
| [Mobile Development](https://haggaishachar.github.io/awesomemap/mobile-dev/) | Cross-platform frameworks, native tooling, testing, state management, and more. | 46 |
| [DevOps & Infrastructure](https://haggaishachar.github.io/awesomemap/devops-infra/) | Containers, orchestration, CI/CD, infrastructure as code, observability, and more. | 50 |
| [Generative AI & LLMs](https://haggaishachar.github.io/awesomemap/generative-ai/) | LLM frameworks, AI agents, RAG, vector databases, coding assistants, and more. | 50 |
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
