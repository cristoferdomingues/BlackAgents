---
type: Reference
title: API Reference
description: All /api routes and payloads
tags:
  - blackagents
  - api
  - reference
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/04%20-%20API%20Reference/API%20Reference.md
    title: API Reference
    last_modified: '2026-10-15T00:00:00Z'
generated:
  by: 'agent:cursor'
  at: '2026-10-19T13:47:00Z'
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:47Z'
  - by: 'human:local'
    at: '2026-10-20T00:00:39Z'
status: draft
---

# API Reference

All client–disk interaction goes through Next.js route handlers under `app/api/`. The client never touches the filesystem directly; the routes own path safety via [fs-service](../architecture/workspace-filesystem-safety.md).

## Response Envelope (`lib/api-response.ts`)

```ts
// success
{ success: true, data: T }
// failure
{ success: false, error: string }
```

The client wrapper `lib/api.ts` unwraps `data` and throws on `success: false`.

## Workspace

The workspace is no longer a single path — it is a **saved list plus an active selection**. GET returns `{ active, workspaces }`.

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/workspace` | `{ active: Workspace \| null, workspaces: Workspace[] }` |
| POST | `/api/workspace` | **Add** a workspace to the list (validates it is a directory; activates only if none is active) |
| PUT | `/api/workspace` | **Set active** workspace (adds it if missing) |
| DELETE | `/api/workspace` | **Remove** a workspace (active falls back to first remaining) |
| GET | `/api/workspace/check?path=` | Validate dir + detect platforms |

> [!note] Add vs. Set-active
> `POST` and `PUT` both validate the directory. `POST` only changes the active workspace when there wasn't one; use `PUT` to deliberately switch. The client (`WorkspaceProvider`) re-fetches artifacts whenever the active path changes.

## Artifacts

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/artifacts` | List all artifacts in the workspace |
| POST | `/api/artifacts` | Create an artifact |
| GET | `/api/artifacts/[type]/[name]` | Fetch one artifact |
| PUT | `/api/artifacts/[type]/[name]` | Update (supports rename) |
| DELETE | `/api/artifacts/[type]/[name]` | Delete (folder for skills) |

> [!note] Rename semantics
> PUT with a changed `name` writes the new path, then removes the old one — an atomic-feeling move handled server-side.

### Assisted authoring

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/artifacts/draft-body` | Draft an artifact `body` from `name` + `description`, or from YouTube transcripts |
| POST | `/api/artifacts/validate` | Review an artifact against the standards and return read-only findings |

**Draft** — Body: `{ type, name, description, provider, model, sources? }`. `description` may be empty only when `sources` has at least one video. Each source is `{ videoId, url, title, channel, transcript }` (at most 5; the url must be that YouTube video). The route validates the input, reads the key **server-side** (missing credentials → **412**), injects `buildSystemContext()`, and asks the model for a single ` ```artifact ` block. Transcripts are quoted as data, not instructions. It then parses `{ body, description, extra }` with `extractDraft()`, appends a `## Sources` section when the model omitted one (`ensureSourcesSection`), and detects which existing artifacts the draft links to by running the [[Relationship Graph|reference extractor]] over the workspace plus a synthetic node for the new artifact.

**Response:** `{ body, description, extra: { parallel, alwaysApply, globs }, links: { to, toName, kind }[] }`. Powers the editor's [[UI Overview|**Draft with assistant**]] button. See [[YouTube Sources]].

**Validate** — Body: `{ type, name, description, body, extra?, provider, model }`. Same server-side key path and **412** behavior. It injects `buildSystemContext()` and asks the model to *review* (not rewrite) the artifact, parsing a ` ```validation ` block with `extractValidation()` (`lib/llm/validation.ts`). If the model ignores the protocol, its prose becomes a single `info` finding rather than an error.

**Response:** `{ summary?, findings: { severity: "error" | "warning" | "info", section?, message, suggestion? }[] }`. Powers the editor's [**Validate with assistant**](../ui/ui-overview.md) button (create + edit). Full design: [Assisted Artifact Drafting](../specs/assisted-artifact-drafting.md).

## Standards

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/standards` | Load standards (workspace override or default) |
| PUT | `/api/standards` | Save workspace override |
| DELETE | `/api/standards` | Reset to baseline |

## Graph

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/graph` | `GraphData { nodes, links }` for the workspace |

## Drift

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/drift` | Per-platform sync report for the active workspace |

Returns `{ platforms: [{ platform, label, summary: { total, "in-sync", drifted, missing }, files: [{ id, name, type, path, status }] }] }`. Comparison is **semantic** (managed frontmatter keys + trimmed body), so the source platform isn't flagged for cosmetic re-serialization. Powers the [`/sync` view](../ui/ui-overview.md).

## Export

Multi-platform export is implemented (see [Future Phases](../roadmap/future-phases.md)).

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/export?platform=<id>` | Raw manifest. `platform=okf` lists the knowledge bundle under `okf/` |
| POST | `/api/export` | Diff + write. Body: `{ platform, mode: "dry-run" \| "write", overwrite?: boolean, targetPath?: string }` |

> [!tip] Cross-repo target
> `targetPath` (optional) writes the bundle into a folder **other than** the active workspace. Artifacts are always read from the active workspace; only the write/diff root changes. It's validated as a directory and traversal-guarded against the target root.

**POST response:**

```jsonc
{
  "platform": "claude",
  "mode": "dry-run",
  "overwrite": true,
  "summary": { "total": 93, "create": 93, "overwrite": 0, "unchanged": 0, "written": 0 },
  "files": [{ "path": ".claude/agents/x.md", "status": "create", "applied": false }]
}
```

- `mode: "dry-run"` (default) computes a per-file `status` (`create` / `overwrite` / `unchanged`) against what's on disk — no writes.
- `mode: "write"` applies it via the workspace-confined `fs-service`. `overwrite: false` skips changed files; `unchanged` files are never rewritten (idempotent).
- Files are written **into the active workspace** (e.g. `.claude/` alongside `.cursor/`).

## Providers (BYO LLM key)

Key management for the chat assistant. **Raw keys are never returned** — only a redacted status (`configured` + last-4).

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/providers` | `{ providers: descriptor[], status: { id, configured, last4?, baseUrl? }[], defaults }` |
| POST | `/api/providers` | Store/replace a key. Body: `{ id, apiKey, baseUrl? }` |
| PUT | `/api/providers` | Set default `{ provider?, model? }` |
| DELETE | `/api/providers?id=<id>` | Remove a stored key |

Keys persist in `~/.black-agents/secrets.json` (written `0600`) via `lib/secrets.ts` — a separate file from the workspace config. The `custom` provider requires `baseUrl` (any OpenAI-compatible endpoint) and treats the key as optional.

## Chat

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/chat` | Body: `{ provider, model?, messages: {role, content, attachments?}[], temperature?, agent?, allowWrites?, allowFileWrites? }` |
| POST | `/api/assistant/transcribe` | Body: `{ provider, model?, audio, format: "wav", language? }` → `{ text }` |

The route reads the key **server-side** from `secrets.json`, builds the system context (standards + artifact registry + loaded artifacts + [memory notes](../architecture/second-brain.md) + protocols) and runs the [agent loop](../architecture/agent-runtime-approvals.md). Missing-credential cases return **412**; upstream provider errors keep their status.

- **SSE** (`Accept: text/event-stream`): events `context`, `token`, `tool_call`, `approval_required`, `approval_resolved`, `tool_result`, `done`, `error` (see [LLM Integration](../architecture/llm-integration.md)). `context.model` is `{ provider, model, source, task? }`.
- **JSON** (other callers): `{ content, model, toolExecutions?, artifacts }`. Gated tool calls are denied.
- `agent` = chat as that workspace agent (its tools, MCP servers, linked artifacts, brain, and optional model/task choice). An unverified agent provider returns **412**.
- `allowWrites` = auto-approve `write` calls for this message; `exec` still asks.
- A user message's `attachments` are `{ kind: "text", name, mimeType, text }`, `{ kind: "image", name, mimeType, data }`, `{ kind: "pdf", name, data }`, or `{ kind: "youtube", videoId, url, title, channel, transcript }`. At most 5 files, 20 MB together. Bad data is **400**. Text and YouTube transcripts are quoted into the prompt; images and PDFs become provider parts. See [LLM Integration](../architecture/llm-integration.md) and [YouTube Sources](../specs/youtube-sources.md).
- The reply may hold an ` ```artifact `, ` ```bundle `, or ` ```workflow ` block; the [`/chat` view](../ui/ui-overview.md) shows an editor hand-off, a bundle card, or a workflow card.
- **Transcribe** is the voice fallback. It uses the selected provider's verified key. OpenAI calls `/v1/audio/transcriptions` (`whisper-1`). A custom provider sends `input_audio`; the model comes from Settings → AI → Models by task → Voice (default `google/gemini-2.5-flash` on OpenRouter; 412 when none can be found). Anthropic, a missing key, and an unverified key return **412**. A 401/403 marks the stored key invalid. Audio must be base64 WAV, at most about 6 million characters.

## Approvals

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/approvals` | `{ approvals: PendingApproval[] }` (tool, args, risk, scope chat/run) |
| POST | `/api/approvals/[id]` | Body: `{ approved, remember? }` → `{ id, approved, remember }`. 404 when no longer pending. `remember` only for exec |

## YouTube

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/sources/youtube` | Body: `{ url, language? }` → title, channel, and caption transcript |

**YouTube** never calls the LLM. **400** bad link, **404** no captions / not found / private, **502** when YouTube fails. See [YouTube Sources](../specs/youtube-sources.md).

## MCP

Config lives in **`.black-agents/mcp.json`** (not `.cursor/mcp.json`). See [MCP Servers](../architecture/mcp-servers.md).

| Method | Route | Purpose |
|--------|-------|---------|
| GET / POST / DELETE | `/api/mcp` | List servers + tools, add/update a server, remove one |
| GET | `/api/mcp/policy` | `{ servers: { [name]: "trusted" \| "ask" \| "risky" } }` |
| PUT | `/api/mcp/policy` | Body: `{ server, trust }` (412 without a workspace) |

**Add / update a server** — Body: `{ name, config, secretHeaders?, secretEnv? }`.

- `config` is `{ command, args?, env? }` for stdio, or `{ url, transport: "http" \| "sse", headers? }` for a remote server. A URL with no transport is treated as HTTP when the app connects.
- Header names must be valid tokens and values cannot contain line breaks; a bad header is **400**.
- `secretHeaders` / `secretEnv` list which values are promoted into `~/.black-agents/secrets.json` as `${secret:mcp.<name>.…}` placeholders in mcp.json. Missing secret when a ref is required → **412**.
- GET returns redacted `secretStatuses` (`configured` + `last4`), never raw tokens.
- DELETE also removes `mcp.<name>.*` keys from secrets.

See [Agent Runtime & Approvals](../architecture/agent-runtime-approvals.md) and [MCP Servers](../architecture/mcp-servers.md).

## Browser automation (desktop)

Electron / `BLACK_AGENTS_DESKTOP=1` only. Without the desktop gate, setup and record return **412**. Full design: [Browser Automation](../specs/browser-automation.md).

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/browser` | Desktop flag, MCP configured?, profile path, flow summaries, active recording |
| POST | `/api/browser` | Body: `{ action: "setup", profile? }` — register Playwright MCP + risky trust |
| POST | `/api/browser/record` | `{ action: "start" \| "status" \| "stop" }`; stop may `saveAs`, `description`, `bind` |
| GET / POST | `/api/browser/flows` | List flows; save a flow body |
| GET / DELETE | `/api/browser/flows/[name]` | Read or delete one flow |
| POST | `/api/browser/flows/from-traces` | Coach mode: `{ name, traces, description?, bind? }` → saved flow |
| POST | `/api/browser/bind` | Skill/agent for a flow; optional `daily: { workflowName, at, task }` |
| GET / PUT | `/api/browser/secrets` | Redacted `browser.*` flow secrets; PUT `{ secrets, removeIds? }` |

`GET /api/browser` also returns `updateFlowsOnHeal` and `secretStatuses`. Heal writeback is toggled via `PUT /api/settings/ai` `{ browser: { updateFlowsOnHeal } }`.

## AI Settings

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/settings/ai` | `maxToolTurns` + Jev status (`enabled`, `provider`, key configured/last4 — never the key) |
| PUT | `/api/settings/ai` | Update turns, Jev on/off, provider, Jev key, and task models. Voice is `id \| null`; Vision/Fast/Reasoning are `{ provider, model } \| null` |
| GET | `/api/settings/ai/models?task=<task>&provider=<id>` | Models that fit Voice, Vision, Fast, or Reasoning; chat tasks also return verified provider choices, `saved`, and `effective`. 400 unknown task/provider |
| POST | `/api/settings/ai/jev-test` | One test call to [Jev](../architecture/jev-decision-engine.md); 412 not set up, 502 Jev error |

## Skill Suggest and Trigger Check

Both need a workspace and Jev. **400** bad body, **412** no workspace or Jev off, **502** Jev error. Nothing is written.

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/skills/suggest` | Body: `{ prompt }` (1–2000 chars). Picks one saved skill, or `none` / `empty` |
| POST | `/api/skills/eval` | Body: `{ name, description, positive?, negative? }`. Checks a draft or saved skill. Returns verdict, warning, probes, and counts |

## Workflows & Runs

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/workflows` | `{ workflows }` with last run |
| POST | `/api/workflows` | Create (201); 409 if the name exists |
| GET | `/api/workflows/[name]` | `{ workflow, active }` |
| PUT | `/api/workflows/[name]` | Save; rename not supported |
| DELETE | `/api/workflows/[name]` | Delete; 409 while a run is active |
| GET | `/api/workflows/[name]/runs` | `{ runs }` (summaries) |
| POST | `/api/workflows/[name]/runs` | Body `{ task? }` → `{ run }` (201, queued) |
| GET | `/api/runs/[id]` | `{ run }` |
| DELETE | `/api/runs/[id]` | Cancel; 409 if finished or not active |
| GET | `/api/runs/[id]/events` | **SSE** `run` snapshots until the run finishes, plus a `ping` every 15s (`{ serverTime }`) |
| GET | `/api/runs/[id]/audit` | `{ events, runId }`. Query: `stepId`, `group` (`ai` \| `tools` \| `approvals` \| `errors` \| `lifecycle`), or `type`. `format=jsonl` downloads the raw log |
| POST | `/api/runs/[id]/login` | Body `{ username, password }` or `{ alreadyLoggedIn: true }` resumes a step that is waiting for a login |

See [Workflows](../architecture/workflows.md).

## Brain

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/brain` | `{ proposals, workspaceNotes, agents }` |
| POST | `/api/brain/feedback` | Body: `{ source: chat\|run, kind?: feedback\|self, agent?, rating?: up\|down, comment?, userMessage, reply, … }` → `recorded` or `proposed` |
| POST | `/api/brain/proposals/[id]` | Body: `{ action: approve\|reject, edits?: { content?, description? } }` → `{ proposal }`; 404 / 409 |
| POST | `/api/brain/promote` | Body: `{ id, type, content, title?, description? }` → `{ proposalId, title, kind }` (201). Queues the inbox item. Does not write the knowledge file |

## Knowledge

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/knowledge/import` | `{ action: "preview", path }` reads a folder (200, no writes). `{ action: "queue", path, id }` adds an inbox proposal (201). Bad version → 400. Missing folder → 404. Already saved → 409 |

See [Second Brain](../architecture/second-brain.md) and [Knowledge (OKF)](../architecture/knowledge-okf.md).

## Validation

Inputs are validated with Zod (`lib/artifacts/schemas.ts`): kebab-case `name`, type-specific extras normalized before serialization. Invalid input returns `{ success: false, error }` with a 400.

## Related

- [Architecture Overview](../architecture/architecture-overview.md)
- [MCP Servers](../architecture/mcp-servers.md) · [Browser Automation](../specs/browser-automation.md)
- [YouTube Sources](../specs/youtube-sources.md)
- [LLM Integration](../architecture/llm-integration.md)
- [Agent Runtime & Approvals](../architecture/agent-runtime-approvals.md) · [Workflows](../architecture/workflows.md) · [Second Brain](../architecture/second-brain.md) · [Jev Decision Engine](../architecture/jev-decision-engine.md)
- [Domain Model](../architecture/domain-model.md)
- [Workspace & Filesystem Safety](../architecture/workspace-filesystem-safety.md)
- [Relationship Graph](../architecture/relationship-graph.md)
