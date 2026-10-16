---
type: Reference
title: Tech Stack
description: 'Frameworks, libraries, and tools'
tags:
  - blackagents
  - tech-stack
  - dependencies
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/01%20-%20Project%20Overview/Tech%20Stack.md
    title: Tech Stack
    last_modified: '2026-10-13T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:16:00Z'
---

# Tech Stack

The stack mirrors [BlackLionFi's structure](./overview.md) but **drops Firebase** — BlackAgents is local-first and persists to the filesystem.

## Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Next.js** | ^16.0.1 | App Router, server components, API routes |
| **React** | ^19.2.0 | UI library |
| **TypeScript** | ^5.7 | Strict typing throughout |

## Styling & UI

| Technology | Purpose |
|-----------|---------|
| **Tailwind CSS** ^3.4.17 | Utility-first CSS, dark mode `["class"]` |
| **Radix UI** | Accessible headless primitives |
| **shadcn/ui** | Component layer (hand-authored, neutral base) |
| **Lucide React** | Icon library |
| **next-themes** | Dark/Light/System theming |
| **class-variance-authority**, **tailwind-merge**, **clsx** | Variant + class utilities |
| **tailwindcss-animate** | Animation utilities |
| **sonner** | Toast notifications |

## Forms & Tables

| Technology | Purpose |
|-----------|---------|
| **React Hook Form** | Frontmatter form state |
| **@hookform/resolvers** + **Zod** | Schema-first validation |
| **@tanstack/react-table** | Typed artifact list tables |

## Editor & Markdown

| Technology | Purpose |
|-----------|---------|
| **@uiw/react-codemirror** | Markdown body editor (dynamic, client-only) |
| **@codemirror/lang-markdown**, **@codemirror/lang-yaml** | CodeMirror languages |
| **@codemirror/autocomplete** (+ `view`/`state`) | `@`-mention autocomplete ([Artifact Mentions](../specs/artifact-mentions.md)) |
| **@uiw/codemirror-theme-github** | Editor theme (dark/light) |
| **react-markdown** + **remark-gfm** | Live Markdown preview |

## Graph

| Technology | Purpose |
|-----------|---------|
| **react-force-graph-2d** | Force-directed Obsidian-style graph (canvas) |

## AI & Agents

| Technology | Purpose |
|-----------|---------|
| **@modelcontextprotocol/sdk** ^1.30 | MCP client — stdio, streamable HTTP, and SSE ([Agent Runtime & Approvals](../architecture/agent-runtime-approvals.md)) |
| **@typesafe-ai/sdk** ^0.6 | Optional [Jev](../architecture/jev-decision-engine.md) classifier (only imported by `lib/decision/*`) |
| Server-Sent Events (native) | Chat and run streaming (`lib/sse.ts`, `lib/sse-client.ts`) |

## Testing

| Technology | Purpose |
|-----------|---------|
| **Vitest** + **@vitest/coverage-v8** | Unit + API-route integration tests (`lib/` ~89% coverage) |
| **@playwright/test** | End-to-end flows against an isolated dev server |

See [Testing](./testing.md) for scripts, layout, and the temp-workspace isolation pattern.

## Desktop & Packaging

| Technology | Purpose |
|-----------|---------|
| **Electron** | Native application lifecycle and sandboxed `BrowserWindow` |
| **electron-builder** | macOS DMG/ZIP, Windows NSIS, Linux AppImage packaging |
| **electron-log** | Main-process startup and server lifecycle logs |
| **concurrently** + **wait-on** + **cross-env** | Desktop development orchestration |
| **Next.js standalone output** | Self-contained production server embedded in the app |

The desktop build retains the Next.js API server rather than replacing route
handlers with Electron IPC. See [Electron Desktop](../architecture/electron-desktop.md).

## Parsing & Filesystem

| Technology | Purpose |
|-----------|---------|
| **gray-matter** | Frontmatter parse/serialize |
| **fast-glob** | Directory scanning helper |
| **node:fs/promises**, **node:path**, **node:os** | Server-side I/O (API routes) |

> [!note] No global state library, no database
> State is local React context (`WorkspaceProvider`) + per-page hooks. Persistence is the filesystem; app settings live in `~/.black-agents/` (`config.json`, `settings.json`, `secrets.json`) and workspace data in `.black-agents/`. There is **no Firebase, Redux, or Zustand**.

## Configuration Files

| File | Purpose |
|------|---------|
| `next.config.mjs` | Next.js config (`reactStrictMode`, standalone output) |
| `tsconfig.json` | Strict mode, `@/*` path alias to project root |
| `tailwind.config.ts` | Theme tokens, type-accent colors, dark mode |
| `postcss.config.mjs` | Tailwind + autoprefixer |
| `components.json` | shadcn/ui aliases + icon library |
| `.npmrc` | `legacy-peer-deps=true` (React 19 peer ranges) |
| `electron/main.cjs` | Desktop lifecycle and secure window |
| `electron/package.json` | Minimal packaged desktop runtime |
| `package.json` (`build`) | electron-builder targets and embedded resources |

## Related

- [Getting Started](./getting-started.md)
- [Architecture Overview](../architecture/architecture-overview.md)
- [UI Overview](../ui/ui-overview.md)
- [Testing](./testing.md)
- [Electron Desktop](../architecture/electron-desktop.md)
