---
type: How To
title: Getting Started
description: 'Setup, installation, and first run'
tags:
  - blackagents
  - setup
  - getting-started
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/01%20-%20Project%20Overview/Getting%20Started.md
    title: Getting Started
    last_modified: '2026-07-24T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:16:01Z'
---

# Getting Started

## Prerequisites

- Node.js 20+ and npm
- A project folder to manage (any repo with a `.cursor/` or `.claude/` directory — e.g. `edu-sidekick`)

## Install & Run

```bash
cd /Users/cristoferdomingues/Dev/Personal/BlackAgents
npm install
npm run dev
```

Open http://localhost:3000.

### Run as a desktop app

```bash
npm run desktop:dev
```

This opens Electron against the Next.js development server. Source changes use
normal Next.js hot reload.

To produce a local unpacked application or distributable installer:

```bash
npm run desktop:dir
npm run desktop:pack
```

Desktop artifacts are written to `dist-electron/`. Installed builds embed the
code present at build time; source changes require a new package. See
[Electron Desktop](../architecture/electron-desktop.md) for the runtime architecture, targets, signing status, and
future auto-update requirements.

## First Run

1. Go to **Settings**.
2. Under **Add a workspace**, paste the absolute path to a project folder. The field validates live and shows which platforms (`.cursor` / `.claude`) it detected.
3. Click **Add**. The path is saved to `~/.black-agents/config.json`. The first workspace you add becomes active automatically.
4. Manage the **active** workspace from the "Your workspaces" list or the header switcher. The dashboard shows counts per artifact type for the active workspace.

> [!tip] No `.cursor` yet? That's fine
> You can open any folder. BlackAgents will create the `.cursor/...` directories the first time you save an artifact there.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run desktop:dev` | Next dev server inside Electron |
| `npm run desktop:dir` | Build an unpacked desktop application |
| `npm run desktop:pack` | Build installers/archives for the current OS |
| `npm run lint` | Lint |
| `npm run type-check` | `tsc --noEmit` |

## Where Things Live

| Concern | Location |
|---------|----------|
| Saved workspaces + active selection | `~/.black-agents/config.json` |
| Workspace artifacts | `<workspace>/.cursor/...` |
| Per-workspace standards override | `<workspace>/.black-agents/standards.md` |

> [!warning] Local-first means real writes
> Saving or deleting an artifact writes/removes real files in the selected workspace. All I/O is confined to the workspace root — see [Workspace & Filesystem Safety](../architecture/workspace-filesystem-safety.md) — but the changes are real. Use version control on the workspace repo.

## Related

- [Overview](./overview.md)
- [Tech Stack](./tech-stack.md)
- [Authoring Standards](../artifacts/authoring-standards.md)
- [Electron Desktop](../architecture/electron-desktop.md)
