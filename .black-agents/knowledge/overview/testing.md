---
type: Reference
title: Testing
description: Vitest unit/integration + Playwright E2E
tags:
  - blackagents
  - testing
  - quality
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/01%20-%20Project%20Overview/Testing.md
    title: Testing
    last_modified: '2026-10-13T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:59Z'
---

# Testing

> [!abstract] One-liner
> BlackAgents is covered by a **Vitest** suite (unit + API-route integration, 336 tests) with a **Playwright** E2E layer (19 tests). The `lib/` domain sits at ~89% line coverage (as of 2026-10-07); every test runs against an **isolated temp workspace**, never the developer's real `~/.black-agents`.

## Stack

| Level | Tool | Scope |
|-------|------|-------|
| Unit | Vitest | `lib/artifacts/**`, `lib/standards`, `lib/llm`, `lib/sources`, `lib/export`, `lib/{runtime,assistant,decision,mcp,workflows,brain}`, `lib/{config,secrets,fs-service,sse,api,utils}` |
| Desktop unit | Vitest | Electron port allocation, readiness polling, external URL safety |
| Integration | Vitest (route handlers called directly) | `app/api/**/route.ts` |
| E2E | Playwright | app shell / flows against an isolated dev server |

## Scripts

| Command | Runs |
|---------|------|
| `npm test` | `vitest run` (unit + integration) |
| `npm run test:watch` | `vitest` in watch mode |
| `npm run test:cov` | `vitest run --coverage` (v8, scoped to `lib/`) |
| `npm run test:e2e` | `playwright test` (needs `npx playwright install` once) |

## Layout

```
tests/
├── helpers/
│   ├── workspace.ts         → makeTempEnv, seedArtifact, jsonRequest
│   ├── runtime.ts           → scripted fake LLM provider for the agent loop
│   └── jev.ts               → fake Jev client
├── unit/                    → lib/ pure + fs-backed logic
│   ├── artifacts/           → schemas, layout, serializer, parser, graph, constants, mentions, agent tools frontmatter
│   ├── llm/                 → draft, validation, bundle, registry, context
│   ├── runtime/             → agent loop, approvals, tools
│   ├── assistant/ decision/ mcp/   → includes decision/skill-suggest.test.ts
│   ├── workflows/           → schema/store, executor, runner
│   ├── brain/               → store, learn, context
│   ├── electron/            → desktop server lifecycle utilities
│   ├── export/adapter, fs-service, config, secrets, standards, sse, api, utils
└── integration/             → artifacts, workspace, standards-graph, providers, mcp,
                               chat (persona + stream), settings-ai, skills-jev, workflows, brain routes
e2e/
├── support/stubs.ts         → SSE + API stubs (no real LLM)
├── smoke.spec.ts            → app shell + standards nav
├── agent-persona-chat.spec.ts
├── assistant-power.spec.ts  → tools, approvals, context badges, bundles
├── workflows.spec.ts        → builder, run, approvals, cancel
├── brain.spec.ts            → inbox, approve/reject, memory
└── skill-triggers.spec.ts   → suggest a skill, check a new skill before save
```

- `vitest.config.ts` — node env, `@/` alias, coverage `include: ["lib/**"]`.
- `playwright.config.ts` — starts `next dev -p 3100` with its own `BLACK_AGENTS_CONFIG_DIR` so E2E is isolated.

## Isolation pattern

Tests never touch the real config or workspaces. `makeTempEnv()` creates a temp `configDir` + `workspace`, points `BLACK_AGENTS_CONFIG_DIR` at it, and writes a `config.json` — because [config resolution](../architecture/workspace-filesystem-safety.md) reads the env var dynamically, route handlers and `lib` functions transparently operate on the temp dir.

```ts
const env = await makeTempEnv()   // isolated ~/.black-agents + workspace
await seedArtifact(env.workspace, ".cursor/agents/tester.md", "…")
// … call GET/POST route handlers directly …
await env.cleanup()               // unset env + rm temp dir
```

Integration tests call the exported `GET`/`POST`/`PUT`/`DELETE` handlers with a `Request` and assert the `{ success, data | error }` envelope plus HTTP status.

## What's covered

- **Domain** — artifact round-trip (rules omit `name`, nested skills), kebab-case validation, per-platform layout, [reference extraction](../architecture/relationship-graph.md) (all five conventions + dedupe/self-ref), [mention](../specs/artifact-mentions.md) token formatting, export frontmatter mapping.
- **Filesystem** — `resolveInWorkspace` **path-traversal rejection**, read/write/walk round-trips.
- **Config & secrets** — legacy migration, add/switch/remove workspace, secrets written **`0600`** and redacted to `configured + last4`.
- **LLM** — `extractDraft` / `extractValidation` / `extractWorkflowDraft` parsing + failure modes, provider registry, `buildSystemContext` (including the workflow registry), OpenAI and Anthropic attachment parts, transcription (OpenAI multipart, custom `input_audio`, Anthropic rejected).
- **Chat files, voice, and workflows** — attachment schema and size caps, `toChatMessage`, WAV encoding, history stores file metadata only, workflow-draft ability checks, and stopped partial replies. E2E in `e2e/assistant-files-voice-workflows.spec.ts`: attach and send, reject a bad type, mic becomes Send, a fake speech engine fills the field, save or repair a workflow draft, `/name input` starts a run without calling the model, and Stop both before and after reply text arrives.
- **YouTube sources** — link parsing, caption JSON/XML, transcript cut, language pick, no follow of a caption URL off `youtube.com`. Route tests for `/api/sources/youtube` and `draft-body` with sources. E2E in `e2e/youtube-sources.spec.ts`: draft a new skill from a stubbed video, paste a transcript when captions are missing, add a video in chat.
- **MCP HTTP** — header rows, `http` vs `sse` vs `stdio`, saving an Authorization header. E2E in `e2e/mcp-http.spec.ts`.
- **Runtime** — turn limits, tool timeouts and truncation, risk + approvals (deny on timeout, remember exec), shell regex, blocked write paths, folder-vs-missing `fs_read` errors, MCP trust.
- **Jev** — fail-open on unavailable/error, confidence thresholds, skill suggest, and trigger verdicts (too wide, never triggers, unclear, ready).
- **Workflows** — schema, handoff, gates/retries, timeouts, cancel, scheduler `isDue`, interrupted-run recovery, `parseWorkflowInvocation` (`/<name>`, `start @name`, `@workflow:name`; unknown names and mid-sentence `/name` are ignored).
- **Brain** — caps, Jev on/off paths, proposal validation, approve/reject/edit, notes cap.
- **API routes** — create (201) / invalid (400) / duplicate (409), rename + type-change guard, standards save/reset, graph edge building.
- **Desktop** — bindable dynamic port selection, packaged-server readiness, safe external-link protocols. Packaged UI startup is verified separately against the built standalone server.

> [!note] Definition of done
> This suite is the enforcement arm of the workspace's own `testing-required` rule (see the artifacts under `.cursor/`): unit for `lib/`, integration for API routes, E2E for flows — happy path, edges, and error paths.

## Related

- [Tech Stack](./tech-stack.md) — the tools this builds on
- [Artifact Mentions](../specs/artifact-mentions.md), [Assisted Artifact Drafting](../specs/assisted-artifact-drafting.md), [YouTube Sources](../specs/youtube-sources.md) — features whose logic is covered here
- [API Reference](../api/api-reference.md) — the routes exercised by the integration tests
- [Workspace & Filesystem Safety](../architecture/workspace-filesystem-safety.md) — the guard the fs tests exercise
- [Electron Desktop](../architecture/electron-desktop.md) — packaging and runtime verification
