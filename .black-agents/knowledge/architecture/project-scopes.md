---
type: Reference
title: Project Scopes
description: >-
  One-level .black-agents/projects/<id>/ scopes, project.json whitelist, ?scope=
  API
tags:
  - blackagents
  - architecture
  - projects
  - workspace
verified:
  - by: 'human:local'
    at: '2026-10-20T00:00:36Z'
status: draft
---

# Project Scopes

> [!abstract] One-liner
> A workspace can hold one level of **projects** at `.black-agents/projects/<id>/`. A project sees its own items plus the workspace items its `project.json` whitelist allows. The workspace never sees projects, and projects never see each other.

## Manifest (`project.json`)

```json
{ "id": "health", "name": "MyHealthCare", "inherits": ["rules", "skills"] }
```

| Field | Rule |
|-------|------|
| `id` | kebab-case, must equal the folder name |
| `name`, `description`, `createdAt` | optional |
| `inherits` | closed set: `mcp`, `skills`, `rules`, `commands`, `agents`, `workflows`, `knowledge` |

Fail closed: a missing or invalid manifest, an id mismatch, or a nested `projects/` folder means the project does not load and inherits nothing. Invalid folders are listed in Settings with the reason. The brain and secrets are never inherited.

## Resolution

| Order | Source |
|-------|--------|
| 1 | Project source: `.black-agents/projects/<id>/artifacts/…` |
| 2 | Workspace source and IDE folders, only for whitelisted kinds |

On a name clash the project item wins. Inherited items are read-only from a project (`403` on PUT/DELETE). Writes in a project never export to IDE folders.

## API

| Route | Role |
|-------|------|
| `GET/POST /api/projects` | list (+ `invalid`, `activeProject`) / create (`409` on duplicate) |
| `GET/PATCH/DELETE /api/projects/[id]` | read / update manifest / remove |
| `GET/PUT /api/projects/active` | read / set `{ id: string \| null }` (`404` if it does not load) |
| `?scope=<id>` on `/api/artifacts`, `/api/artifacts/[type]/[name]`, `/api/artifacts/preview` | explicit scope; `400` bad id, `404` not loadable |

The server never guesses the scope. The client adds `?scope=` with `scoped(url)` from the workspace provider. `activeProject` is saved in `~/.black-agents/config.json` and cleared when the workspace changes.

## UI

- Header **project switcher** next to the workspace menu ("Whole workspace" or a project).
- Artifact lists show **Project** / **Inherited** badges; the editor shows a read-only banner for inherited items.
- **Settings → Projects** (`/settings#projects`): create, edit the whitelist, delete, and see broken folders.

## Not scoped yet

Chat, the assistant context, the workflow runtime, the graph route, and the MCP settings panel still use the whole workspace.

## Key files

| Path | Role |
|------|------|
| `lib/artifacts/projects.ts` | load, list, create, update, delete, `inheritsScopeToken` |
| `lib/artifacts/scope-request.ts` | `?scope=` parse + load check |
| `lib/artifacts/parser.ts` | scope-first scan and lookup |
| `lib/artifacts/graph.ts` | scope-aware node ids and links |
| `lib/mcp/config.ts`, `lib/workflows/store.ts`, `lib/knowledge/store.ts` | scoped readers and writers |
| `lib/artifacts/projects-explain.ts` | UI copy and helpers |
| `components/layout/project-switcher.tsx`, `components/features/settings/projects-panel.tsx` | UI |

## Related

- [Workspace & Filesystem Safety](./workspace-filesystem-safety.md)
- [Domain Model](./domain-model.md)
- [MCP Servers](./mcp-servers.md)
