# BlackAgents

<div align="center">
  <img src="public/images/black-agents-logo.png" alt="BlackAgents" width="480" />

  [![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
  [![React](https://img.shields.io/badge/React-19-blue)](https://reactjs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8)](https://tailwindcss.com/)
  [![Local-first](https://img.shields.io/badge/Local--first-7c3aed)](#)
</div>

---

A **local-first** manager for AI agent artifacts — **agents, commands, rules, and skills** — with a graphical UI. BlackAgents reads and writes the real `.md` / `.mdc` files in a project folder on your machine, uses an editable **authoring-standards** baseline to guide creation, and visualizes how artifacts reference each other in an Obsidian-style relationship graph.

It is a generic, multi-platform evolution of the `edu-sidekick` toolkit: the same `commands → agents → rules → skills` model, exposed through a GUI instead of hand-edited Markdown.

## Features

- **Artifact CRUD** — create, edit, rename, and delete agents, commands, rules, and skills with a Markdown editor (live preview) and type-aware frontmatter fields.
- **Authoring standards** — an editable, per-workspace standards baseline that drives inline hints (required sections, anti-patterns) as you write.
- **Guided wizard** — a Type → Details → Body → Review flow for creating artifacts.
- **Relationship graph** — an Obsidian-style force-directed graph of the cross-references between artifacts.
- **Multiple workspaces** — save several project folders and switch the active one from the header; settings persist to `~/.black-agents/config.json`.
- **Multi-platform export** — re-emit a workspace's artifacts in another platform's layout (`.cursor` / `.claude` / `.windsurf`) with a per-file diff (create / overwrite / unchanged), a cross-repo target folder, and a `.zip` download.
- **Drift / sync view** — a read-only, per-platform report of which on-disk files are in-sync, drifted, or missing (semantic comparison, so cosmetic re-serialization isn't flagged).
- **Chat assistant (bring your own key)** — describe an artifact in plain language and the assistant proposes a standards-compliant draft you can open straight in the editor. Keys are stored locally and never leave your machine.

## Concepts

| Type | Purpose | File |
| --- | --- | --- |
| **Command** | Orchestration layer — sequences agents. | `.cursor/commands/<name>.md` |
| **Agent** | Single-responsibility worker with a persona. | `.cursor/agents/<name>.md` |
| **Rule** | Short declarative guardrail (auto/glob applied). | `.cursor/rules/<name>.mdc` |
| **Skill** | Deep reference package with supporting files. | `.cursor/skills/<name>/SKILL.md` |

Cross-references between artifacts (a command invoking an agent, an agent reading a skill, etc.) are detected automatically and rendered as a graph.

The internal model is platform-agnostic, so the same artifacts can be exported to other tools' layouts:

| Platform | Root | Notes |
| --- | --- | --- |
| **Cursor** | `.cursor/` | Source of truth; rules use `.mdc` + `alwaysApply` / `globs`. |
| **Claude** | `.claude/` | Keeps `name` + `description`; no rule-activation keys. |
| **Windsurf** | `.windsurf/` | Maps rule activation onto `trigger`; commands become workflows. |

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 3.4** + **shadcn/ui** (Radix + CVA) + **next-themes**
- **gray-matter** + **fast-glob** for artifact parsing
- **react-force-graph-2d** for the relationship graph
- **CodeMirror** for the markdown body editor
- **zod** for input validation, **jszip** for the `.zip` export
- Persistence: the local **filesystem** (your workspace). App settings live in `~/.black-agents/config.json`; LLM API keys live in `~/.black-agents/secrets.json` (written `0600`, never sent to the browser).

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and add a project folder (e.g. a repo containing a `.cursor/` directory) — from the workspace switcher in the header or under **Settings**. Switch the active workspace at any time from the header.

### Using the chat assistant

1. Go to **AI Providers** and add a key for **OpenAI**, **Anthropic**, or a **Custom** OpenAI-compatible endpoint (e.g. OpenRouter at `https://openrouter.ai/api/v1`, or a local Ollama / LM Studio server).
2. Open **Assistant**, pick the provider and model, and describe the artifact you want.
3. When the assistant proposes a draft, click **Open in editor** to review and save it.

## Roadmap

- **Shipped:** multiple workspaces, artifact CRUD, authoring-standards baseline, guided creation wizard, relationship graph, multi-platform export (diff + `.zip` + cross-repo target), drift/sync view, and the bring-your-own-key chat assistant.
- **Next:** streaming chat responses, multi-turn editing of existing artifacts in chat, and a default provider/model picker in the Providers UI.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Lint |
| `npm run type-check` | TypeScript check |
