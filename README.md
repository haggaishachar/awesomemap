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

## Top risers this week

The top 100 projects by 7-day [Rising score](https://awesomemap.dev/methodology/),
recomputed daily — the arrow shows how each project's rank moved since the
previous run, and 📰 links to the external mention (Hacker News, Reddit,
Product Hunt, or a blog post) explaining a spike, when one was found. See
the full, filterable [Rising leaderboard](https://awesomemap.dev/rising/)
for every window and every domain.

<!-- RISERS:START -->
_Not enough star-history yet to rank this week's risers._
<!-- RISERS:END -->

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
