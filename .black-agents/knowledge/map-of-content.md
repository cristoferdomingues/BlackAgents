---
type: Reference
title: Map of content
description: Single source of truth for the BlackAgents project.
tags:
  - moc
  - blackagents
  - ai-agents
  - toolkit
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/00%20-%20MOC.md
    title: 00 - MOC
    last_modified: '2026-10-15T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:16:05Z'
---

# BlackAgents — Knowledge Base

> [!info] Purpose
> Single source of truth for the **BlackAgents** project. It gives AI agents and developers the context to implement features, fix bugs, and make architectural decisions.

## Project Identity

| Property | Value |
|----------|-------|
| **Name** | BlackAgents |
| **Type** | Local-first AI agent artifact manager (GUI) |
| **Manages** | Agents, Commands, Rules, Skills, and OKF knowledge concepts |
| **Framework** | Next.js 16 (App Router) + React 19 |
| **Language** | TypeScript 5 (strict) |
| **Storage** | Local filesystem (no cloud in v1) |
| **Repo** | `/Users/cristoferdomingues/Dev/Personal/BlackAgents` |
| **Remote** | https://github.com/cristoferdomingues/BlackAgents |

> [!abstract] One-liner
> A generic, multi-platform evolution of the `edu-sidekick` toolkit: the same `commands → agents → rules → skills` model, exposed through a graphical UI instead of hand-edited Markdown, with an editable authoring-standards baseline and an Obsidian-style relationship graph.

---

## Navigation

### Project Foundation
- [Overview](./overview/overview.md) — What BlackAgents is and what it does
- [Tech Stack](./overview/tech-stack.md) — Frameworks, libraries, and tools
- [Getting Started](./overview/getting-started.md) — Setup, installation, and first run
- [Testing](./overview/testing.md) — Vitest unit/integration + Playwright E2E

### Architecture
- [Architecture Overview](./architecture/architecture-overview.md) — High-level system design and layers
- [Domain Model](./architecture/domain-model.md) — The platform-agnostic `Artifact` model
- [Workspace & Filesystem Safety](./architecture/workspace-filesystem-safety.md) — How a project folder is opened and guarded
- [Relationship Graph](./architecture/relationship-graph.md) — How cross-references are extracted and drawn
- [LLM Integration](./architecture/llm-integration.md) — Provider contract, protocols, chat SSE, and security
- [Agent Runtime & Approvals](./architecture/agent-runtime-approvals.md) — Tool loop, tool risk, approval gate, MCP trust
- [MCP Servers](./architecture/mcp-servers.md) — `.black-agents/mcp.json`, `${secret:…}` refs, transports, trust
- [Jev Decision Engine](./architecture/jev-decision-engine.md) — Optional fast classifier (routing, gates, learning)
- [Workflows](./architecture/workflows.md) — Local agent teams, runs, scheduler
- [Second Brain](./architecture/second-brain.md) — Feedback → proposals → approved memory/skills/rules
- [Knowledge (OKF)](./architecture/knowledge-okf.md) — Durable facts as OKF 0.2 concepts, separate from memory
- [Electron Desktop](./architecture/electron-desktop.md) — Desktop runtime, packaging, updates, and security

### Artifact Model
- [Artifact Types Overview](./artifacts/artifact-types-overview.md) — The four types and how they relate
- [Authoring Standards](./artifacts/authoring-standards.md) — The editable baseline that guides creation
- [Agents](./artifacts/agents.md) — Single-responsibility workers
- [Commands](./artifacts/commands.md) — Orchestration layer
- [Rules](./artifacts/rules.md) — Short guardrails
- [Skills](./artifacts/skills.md) — Deep reference packages

### Reference
- [API Reference](./api/api-reference.md) — All `/api` routes and payloads
- [UI Overview](./ui/ui-overview.md) — Shell, editor, wizard, graph, chat, workflows, brain
- [Future Phases](./roadmap/future-phases.md) — What shipped and what is still open

### DevOps & Infrastructure
- [DevOps Overview](./devops/devops-overview.md) — local-first shipping: no hosted server
- [CI-CD Pipeline](./devops/ci-cd-pipeline.md) — type-check, lint, tests, build, Playwright
- [Releases](./devops/releases.md) — release pull request, tag, desktop installers
- [GitHub Pages](./devops/github-pages.md) — the public landing page

### Specs
- [Assisted Artifact Drafting](./specs/assisted-artifact-drafting.md) — Draft the body with the LLM from name + description
- [YouTube Sources](./specs/youtube-sources.md) — captions as a reference for a new skill and for chat
- [Artifact Mentions](./specs/artifact-mentions.md) — `@` to link artifacts, grouped by type
- [Browser Automation](./specs/browser-automation.md) — Desktop Playwright MCP: record / coach → flows → `browser_run_flow`
- [Model Routing](./specs/model-routing.md) — different models per agent / step / task kind (umbrella, phases 1–4)
  - [Agent Models](./specs/agent-models.md) — phase 2: `model:` / `provider:` in agent frontmatter
  - [Workflow Step Models](./specs/workflow-step-models.md) — phase 3: per-step override
  - [Task Model Kinds](./specs/task-model-kinds.md) — phase 4: `task:vision` etc. from Settings → AI

---

## Quick Reference

### File Structure
```
BlackAgents/
├── app/                → App Router pages + API routes
│   ├── agents/ commands/ rules/ skills/   → list + new + [name]
│   ├── graph/ standards/ settings/ new/ chat/
│   ├── workflows/ (list, new, [name], runs/[id])   brain/   sync/
│   └── api/             → workspace, artifacts, standards, graph, export, sync, chat,
│                          approvals, mcp, browser, settings/ai, workflows, runs, brain,
│                          knowledge/import, assistant/transcribe, sources/youtube
├── components/
│   ├── ui/             → shadcn/ui primitives
│   ├── layout/         → sidebar, header, theme
│   ├── providers/      → workspace context
│   └── features/       → dashboard, artifacts, editor, wizard, graph, standards, settings,
│                          chat, approvals, workflows, brain
├── hooks/              → use-graph, use-voice-input
├── electron/           → desktop shell, lifecycle helpers, icon + package
├── lib/
│   ├── artifacts/      → types, layout, parser, serializer, graph, schemas, constants, mentions
│   ├── standards/      → default-standards, loader
│   ├── export/         → multi-platform adapter
│   ├── llm/            → provider contract, registry, context, draft/validation/bundle/workflow protocols, transcribe
│   ├── chat/           → attachments (text, image, PDF, YouTube), conversation history
│   ├── sources/        → YouTube link → caption transcript
│   ├── audio/          → wav encoder (voice fallback)
│   ├── runtime/        → agent loop, approvals, tool risk, tools (fs, shell, mcp, browser_run_flow)
│   ├── assistant/      → chat service, SSE events, turn artifacts
│   ├── decision/       → Jev client + classifiers
│   ├── mcp/            → MCP client (stdio, HTTP, SSE), headers, secret refs, trust policy
│   ├── browser/        → Playwright MCP setup, flows, recording, profile, binding
│   ├── workflows/      → schema, store, executor, runner, handoff
│   ├── brain/          → store, learn, context
│   ├── knowledge/      → OKF 0.2 schema, store, bundle reader, import, export
│   ├── fs-service.ts   config.ts  settings.ts  secrets.ts  sse.ts  sse-client.ts
├── instrumentation.ts  → starts the workflow runner
├── tests/              → unit + integration (Vitest); e2e/ (Playwright)
└── docs/ARCHITECTURE.md
```

### Key Entry Points
| What | Path |
|------|------|
| App shell | `app/layout.tsx` |
| Dashboard | `app/page.tsx` |
| Domain model | `lib/artifacts/types.ts` |
| Platform layout map | `lib/artifacts/layout.ts` |
| Parser | `lib/artifacts/parser.ts` |
| Graph extractor | `lib/artifacts/graph.ts` |
| Standards baseline | `lib/standards/default-standards.ts` |
| Filesystem guard | `lib/fs-service.ts` |
| Local config | `~/.black-agents/config.json` |
| AI settings | `~/.black-agents/settings.json` (keys in `secrets.json`) |
| Agent loop | `lib/runtime/agent-loop.ts` |
| Chat service | `lib/assistant/chat-service.ts` |
| Chat files | `lib/chat/attachments.ts` |
| YouTube sources | `lib/sources/youtube.ts`, `POST /api/sources/youtube` |
| MCP config / secrets | `.black-agents/mcp.json`, `lib/mcp/config.ts`, `lib/mcp/secret-refs.ts` |
| MCP transports | `lib/mcp/transport.ts`, `lib/mcp/headers.ts` |
| Browser automation | `lib/browser/`, `POST /api/browser`, Settings → Browser |
| Voice fallback | `app/api/assistant/transcribe/route.ts` |
| Workflow from chat | `lib/llm/workflow-draft.ts`, `lib/workflows/invocation.ts` |
| Workflow runner | `lib/workflows/runner.ts` (booted by `instrumentation.ts`) |
| Brain learning | `lib/brain/learn.ts` |
| Knowledge (OKF) | `lib/knowledge/`, `.black-agents/knowledge/` |
| Artifact source | `.black-agents/artifacts/` (IDE folders are export copies) |
| Workspace data | `.black-agents/` (artifacts, knowledge, workflows, runs, brain, export.json, mcp.json, browser-flows/) |
| Browser profiles | `~/.black-agents/browser-profiles/` (desktop Chromium user-data) |
| Electron entry point | `electron/main.cjs` |

> [!tip] Lineage
> BlackAgents generalizes [the sidekick authoring standards](./artifacts/authoring-standards.md). When in doubt about an artifact's purpose, the rule of thumb is: **commands wire, agents execute, rules constrain, skills educate.**
