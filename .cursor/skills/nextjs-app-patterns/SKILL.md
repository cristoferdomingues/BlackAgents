---
name: nextjs-app-patterns
description: Reference for building BlackAgents features — the layered architecture, App Router page/route conventions, the API envelope + zod recipe, the lib/artifacts domain, and the workspace-confined filesystem path. Read when adding or changing app behavior, API routes, or domain logic.
---

# BlackAgents App Patterns

## When to Apply

Read this when implementing a feature or fix that touches `app/**`, `app/api/**`, or `lib/**`. The hard constraints live in the `typescript-strict` and `api-response-format` rules; this file explains the layers and the recipes.

## Architecture (respect the layers)

```
UI (components/features/, client) ──fetch──▶ API routes (app/api/**/route.ts)
                                                    │  { success, data | error }
                                              Domain (lib/artifacts/, lib/standards/)
                                                    │  parse / serialize / graph
                                              Filesystem (lib/fs-service.ts)
                                                    │  resolveInWorkspace (no escape)
                                              Workspace folder (.cursor / .claude ...)
```

Rules of the road:
- Pure, platform-agnostic logic lives in `lib/artifacts/**`. It never imports React or `next/server`.
- HTTP concerns live only in `app/api/**/route.ts`.
- All disk access goes through `lib/fs-service.ts`; never call `node:fs` directly from a route.

## App Router Conventions

- Pages are **server components** by default; add `"use client"` only for interactivity/state/effects.
- Route groups: `/agents`, `/commands`, `/rules`, `/skills` each have a list page, a `[name]` edit page, and a `new` page; `/new` is the guided wizard. Other routes: `/graph`, `/standards`, `/export`, `/sync`, `/chat`, `/providers`, `/settings`.
- Client feature components fetch through `apiFetch` (`lib/api.ts`) and read active-workspace state from `WorkspaceProvider` — no raw `fetch` and no direct config reads in the client.

## API Route Recipe

```ts
import { ok, fail, handle } from "@/lib/api-response"
import { artifactInputSchema } from "@/lib/artifacts/schemas"

export async function POST(req: Request) {
  return handle(async () => {
    const parsed = artifactInputSchema.safeParse(await req.json())
    if (!parsed.success) return fail(parsed.error.issues[0].message, 400)
    // ...domain work via lib/artifacts + lib/fs-service...
    return ok({ /* data */ })
  })
}
```

- Always return via `ok` / `fail`; wrap in `handle` so throws become a `500` envelope.
- Read the workspace root from config (`lib/config.ts`), then use `resolveInWorkspace(root, relPath)`.
- Read secrets with `lib/secrets.ts` **server-side only**; missing credentials → `fail("...", 412)`.

## The Domain Model

`lib/artifacts/`:
- `types.ts` — `Artifact`, `ArtifactType`, `Platform`, `ArtifactFrontmatter` (tool-agnostic).
- `layout.ts` — `PLATFORM_LAYOUTS` + `artifactRelPath()` / `artifactDeletePath()`; the only place that knows a platform's folders/extensions. `ACTIVE_PLATFORMS = ["cursor", "claude"]`, default `cursor`.
- `parser.ts` — `scanWorkspace(root)` and `parseArtifact` (via `gray-matter`); skills are a `<name>/SKILL.md` dir walked recursively.
- `serializer.ts` — `serializeArtifact(input)` writes frontmatter + body; **rules omit `name`** (identified by filename).
- `schemas.ts` — `nameSchema` (kebab-case), `artifactInputSchema`, `normalizeExtra` (per-type frontmatter).
- `graph.ts` — extracts cross-references from the authoring conventions.

## Cross-Reference Conventions (what the graph reads)

| From → To | Convention in body |
|-----------|--------------------|
| Command → Agent | **agent-name** (bold) |
| Agent → Rule | `` `rule-name` `` rule |
| Agent → Skill | `` `skill-name` `` skill |
| Rule → Rule | `Related rules: a, b.` |
| Rule → Skill | `See also: x skill.` |

Write bodies with these exact conventions so the relationship graph and the assistant's link detection pick them up.

## Filesystem Safety

```ts
export function resolveInWorkspace(root: string, relativePath: string): string {
  // resolves relativePath under root and throws WorkspaceError if it escapes
}
```

Every read/write must be built from a workspace-relative path through this function. Never concatenate absolute paths or accept a client-supplied absolute path.

## Persistence Outside the Workspace

- `~/.black-agents/config.json` — saved workspaces + active `currentPath` (`lib/config.ts`).
- `~/.black-agents/secrets.json` — LLM keys, mode `0600`, server-only (`lib/secrets.ts`).
- `<workspace>/.black-agents/standards.md` — per-workspace authoring-standards override.
- Override the config dir with `BLACK_AGENTS_CONFIG_DIR` (useful in tests).

## How to Use

Reference-only. The persona and workflow live in the **feature-developer** agent; the guardrails live in the `typescript-strict` and `api-response-format` rules. Use this file to place logic in the right layer and copy the route recipe, then hand UI to the **uiux-designer** agent and coverage to the **tester** agent.
