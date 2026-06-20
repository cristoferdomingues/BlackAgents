# Architecture

BlackAgents is a **local-first** Next.js app that reads and writes AI-agent
artifact files in a project folder on disk. The core idea is a single
**platform-agnostic domain model** with thin adapters at the edges.

## Layers

```
UI (client components, features/)        -> fetch /api/*
  │
API routes (app/api/**/route.ts)         -> { success, data, error } envelope
  │
Domain (lib/artifacts/, lib/standards/)  -> parse / serialize / graph / standards
  │
Filesystem (lib/fs-service.ts)           -> I/O confined to the workspace root
  │
Workspace folder (.cursor / .claude ...) -> the real .md / .mdc files
```

- **Domain model** (`lib/artifacts/types.ts`): `Artifact` is independent of any
  tool's folder layout.
- **Layout map** (`lib/artifacts/layout.ts`): the single adapter mapping the
  model to a concrete platform's directories/extensions (`.cursor`, `.claude`,
  `.windsurf`).
- **Parser/serializer**: `gray-matter` to read/write frontmatter + body.
- **Graph** (`lib/artifacts/graph.ts`): derives cross-references from the
  authoring conventions and feeds the force-directed view.
- **Standards** (`lib/standards/`): a built-in editable baseline, overridable
  per workspace at `.black-agents/standards.md`.

## Safety

All filesystem access goes through `resolveInWorkspace`, which rejects any path
that escapes the selected workspace root. The app is intended to run on the
user's own machine; there is no remote storage in v1.

## Future phases (extension points already in place)

### Multi-platform export

`lib/export/adapter.ts` + `GET /api/export?platform=<id>` already produce the
file manifest for re-emitting the workspace's artifacts to any platform in the
layout map. A future UI adds write-to-disk and `.zip` download on top of this,
plus copying skill supporting files.

### Chat with bring-your-own-key LLMs

`lib/llm/types.ts` defines the provider contract. The planned chat screen will:

1. Let the user choose a provider (OpenAI / Anthropic / custom) and store the
   API key locally.
2. Send the authoring standards (`/api/standards`) and the artifact registry as
   system context.
3. Have the assistant generate or edit artifacts through the existing
   `/api/artifacts` routes — the same write path the manual editor uses.

Because generation reuses the existing artifact write path and standards
context, the chat feature is additive and does not change the domain model.
