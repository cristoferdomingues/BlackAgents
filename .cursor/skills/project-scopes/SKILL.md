---
name: project-scopes
description: >-
  Reference for BlackAgents project scopes — one-level sub-scopes inside a
  workspace (e.g. MyHome → MyHealthCare), the project.json whitelist, scope
  resolution order, and the exact code seams to touch in the BlackAgents source.
  Read when adding, changing, or debugging projects inside a workspace.
---

## When to Apply

Read this when you are implementing, changing, or debugging **project scopes** — the feature that lets a workspace contain one level of named projects (e.g. workspace `MyHome` containing project `MyHealthCare`), where a project owns its own agents/commands/rules/skills and may **inherit** a whitelisted subset of the parent workspace's services.

Do NOT use this for multi-workspace setups (that is the existing workspace switcher) or for nested projects (project inside a project) — nesting beyond one level is explicitly out of scope.

## Concepts

- **Workspace** — the root folder BlackAgents is confined to. Unchanged: it still owns `.black-agents/mcp.json`, `.black-agents/workflows/`, `.black-agents/knowledge/`, `.black-agents/brain/`.
- **Project** — a one-level sub-scope at `.black-agents/projects/<project-id>/`. It has its own artifact source tree and its own data, and it *sees* the parent workspace only through an explicit whitelist.
- **Scope** — the resolution context of a request: `project` first, then `workspace`. Project-local entries always win on name collision.
- **Whitelist (`inherits`)** — the only way a project gains access to parent services. Nothing is inherited by default; absence from the list means no access.

## Directory layout

```
.black-agents/
├── artifacts/                     # workspace scope (parent services)
├── mcp.json                       # workspace MCP servers
├── workflows/                     # workspace workflows
├── knowledge/  brain/             # workspace knowledge + memory (never scoped)
└── projects/
    └── myhealthcare/
        ├── project.json           # manifest (spec below)
        ├── artifacts/             # project agents/commands/rules/skills
        │   ├── agents/  commands/  rules/  skills/
        ├── mcp.json               # optional project MCP servers
        ├── workflows/             # optional project workflows
        └── data/                  # project-only files
```

The project artifact tree reuses `SOURCE_LAYOUT` verbatim — only the root prefix changes from `.black-agents/artifacts` to `.black-agents/projects/<id>/artifacts`.

## project.json spec (zod, server-validated)

```json
{
  "id": "myhealthcare",            // kebab-case, must equal the folder name
  "name": "MyHealthCare",
  "description": "Personal health tracking",
  "inherits": ["mcp", "skills", "rules", "workflows"],  // whitelist, default []
  "createdAt": "2026-10-16T00:00:00.000Z"
}
```

Allowed `inherits` tokens — a closed set, reject anything else:

| token | grants the project access to |
|---|---|
| `mcp` | workspace `.black-agents/mcp.json` servers (project entries win on name collision) |
| `skills` | workspace `.black-agents/artifacts/skills/` |
| `rules` | workspace `.black-agents/artifacts/rules/` |
| `commands` | workspace `.black-agents/artifacts/commands/` |
| `agents` | workspace `.black-agents/artifacts/agents/` |
| `workflows` | workspace `.black-agents/workflows/` |
| `knowledge` | workspace `.black-agents/knowledge/` registry in system context |

**Never inheritable:** `brain` (memory/inbox stays workspace-level), secrets, and IDE export folders. Knowledge bodies are read-only when inherited; only the Inbox approval flow may mark concepts verified (see `brain-memory-vs-knowledge` rule).

## Resolution algorithm

1. Determine the active scope: none (workspace mode) or one project id. Persist it next to the active workspace in `~/.black-agents/config.json` as `activeProject`.
2. **Artifacts:** scan the project source tree, then — per whitelisted artifact token — scan the workspace source tree. Dedupe by `type:name`, project entry first (mirrors the existing source→IDE dedupe in `scanWorkspace`).
3. **MCP:** load project `mcp.json` if present; if `mcp` is inherited, merge workspace servers underneath, project wins on name.
4. **Workflows / knowledge:** same merge pattern, gated by their token.
5. Anything not in `inherits` resolves to *nothing*, not to the parent. Fail closed.

## Code seams (BlackAgents source)

| file | change |
|---|---|
| `lib/artifacts/source.ts` | parameterize `SOURCE_ROOT`: `sourceRoot(projectId?)` → `.black-agents/projects/<id>/artifacts`; keep `SOURCE_LAYOUT` shared |
| `lib/artifacts/types.ts` | `Artifact` gains `scope?: { project: string }` — derived from the scan root, never authored in frontmatter |
| `lib/artifacts/parser.ts` | `scanWorkspace(root, scope?)` — scan project source, then merge whitelisted workspace passes; reuse the existing dedupe loop |
| `lib/artifacts/serializer.ts` + `lib/fs-service.ts` | writes resolve against the *scope root*; `resolveInWorkspace` already blocks `..` traversal, so a project root is just a nested root — no new guard needed, but add a test proving `../../` escapes fail |
| `lib/mcp/config.ts` | `MCP_CONFIG_REL_PATH` becomes a function of scope; merge order project → workspace |
| `lib/workflows/`, `lib/knowledge/` | scope-aware loaders gated by the whitelist tokens |
| `lib/config.ts` | `activeProject` field, cleared when the workspace changes |
| `app/` + `components/` | project switcher beside the workspace switcher; artifact lists badge origin (project vs inherited) |
| `lib/artifacts/graph.ts` / `mentions.ts` | resolve `@mentions` scope-first, then parent — cross-scope links become visible edges |

## Invariants

- **One level only.** No `projects/<id>/projects/…`. Reject at parse time with a clear error.
- **Fail closed.** Missing manifest, unknown token, or folder/id mismatch → the project does not load; never fall back to full inheritance.
- **Project id is path-derived** from the folder name; `project.json.id` must match or the project is rejected.
- **Workspace confinement holds.** All project paths go through `resolveInWorkspace`; a project may never read or write outside its workspace root.
- **No frontmatter changes.** Existing artifacts keep working untouched; `scope` is injected by the scanner.

## How to Use

- **Implementing the feature:** follow the seam table top-down — domain (`source.ts`, `types.ts`) → parser → loaders (`mcp`, `workflows`, `knowledge`) → config → UI. Write tests alongside each layer (see `testing-patterns` skill).
- **Debugging a scope issue:** first check `project.json` validity and the `inherits` whitelist — most "my project can't see X" reports are a missing token or a fail-closed rejection.
- **Adding a new inheritable service:** add the token to the closed set, gate the loader, document it in the table above, and add a fail-closed test for the unknown-token path.
- **Related:** `nextjs-app-patterns` skill (layered architecture, API envelope), `plugin-system` skill (contribution kinds follow the same merge-over pattern), `brain-memory-vs-knowledge` rule (what may never be scoped).
