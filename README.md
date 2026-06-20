# BlackAgents

A **local-first** manager for AI agent artifacts — **agents, commands, rules, and skills** — with a graphical UI. BlackAgents reads and writes the real `.md` / `.mdc` files in a project folder on your machine, uses an editable **authoring-standards** baseline to guide creation, and visualizes how artifacts reference each other in an Obsidian-style relationship graph.

It is a generic, multi-platform evolution of the `edu-sidekick` toolkit: the same `commands → agents → rules → skills` model, exposed through a GUI instead of hand-edited Markdown.

## Concepts

| Type | Purpose | File |
| --- | --- | --- |
| **Command** | Orchestration layer — sequences agents. | `.cursor/commands/<name>.md` |
| **Agent** | Single-responsibility worker with a persona. | `.cursor/agents/<name>.md` |
| **Rule** | Short declarative guardrail (auto/glob applied). | `.cursor/rules/<name>.mdc` |
| **Skill** | Deep reference package with supporting files. | `.cursor/skills/<name>/SKILL.md` |

Cross-references between artifacts (a command invoking an agent, an agent reading a skill, etc.) are detected automatically and rendered as a graph.

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 3.4** + **shadcn/ui** (Radix + CVA) + **next-themes**
- **gray-matter** + **fast-glob** for artifact parsing
- **react-force-graph-2d** for the relationship graph
- **CodeMirror** for the markdown body editor
- Persistence: the local **filesystem** (your workspace). App settings live in `~/.black-agents/config.json`.

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, go to **Settings**, and point BlackAgents at a project folder (e.g. a repo containing a `.cursor/` directory).

## Roadmap

- **v1 (current):** workspace selection, artifact CRUD, authoring-standards baseline, guided creation wizard, relationship graph.
- **Later:** in-app chat with bring-your-own-key LLMs that generates artifacts, and multi-platform export (`.cursor` / `.claude` / `.windsurf`).

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Lint |
| `npm run type-check` | TypeScript check |
