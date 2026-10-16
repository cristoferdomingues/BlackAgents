---
type: Spec
title: Agent Models
description: 'phase 2: model: / provider: in agent frontmatter'
tags:
  - blackagents
  - spec
  - llm
  - agents
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/07%20-%20Specs/Agent%20Models.md
    title: Agent Models
    last_modified: '2026-10-11T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:46Z'
---

# Agent Models (phase 2)

> [!abstract] One-liner
> An agent can say which model it runs on, with `model:` (and optional `provider:`) in its frontmatter. Chat with that agent and workflow steps that use it run on that model.

> [!success] Shipped
> Implemented on 2026-10-11. The agent editor, chat resolver/header, workflow inheritance, exports, and tests described here are complete.

Read [Model Routing](./model-routing.md) first: it defines `ModelRef`, the precedence rule, the errors, and the shared file `lib/llm/model-ref.ts`, which **this phase creates**.

## Requirements

- Agent frontmatter accepts optional `model` and `provider`.
- The agent editor can set them. "Inherit" (the default) writes nothing.
- Chat with an agent uses the agent's model; the header shows it.
- Workflow steps use the agent's model when the workflow step has none (phase 3 adds the step layer; in this phase the order is agent → workflow → defaults).
- Export keeps `model` for Cursor and Claude Code, where it means the same thing.
- No change for agents without `model`.

## Frontmatter

```yaml
---
name: reviewer
description: Reviews pull requests
model: claude-sonnet-4-20250514
provider: anthropic   # optional; without it the caller's provider is used
---
```

| Value | Meaning in BlackAgents |
|-------|------------------------|
| no `model`, or `model: inherit` | use the caller's model |
| `model: <id>` | that model id; provider = `provider:` or the caller's provider |
| `model: sonnet` / `opus` / `haiku` / `fast` | **inherit** — these are Claude Code / Cursor aliases. Keep them on disk; do not try to run them. |
| `model: task:<kind>` | error until [Task Model Kinds](./task-model-kinds.md) (phase 4) |

## Decisions

| Question | Decision |
|----------|----------|
| One key (`openai/gpt-4o`) or two keys? | **Two keys.** OpenRouter ids already contain `/`, so splitting one key is ambiguous. |
| Chat: agent model or header picker? | **Agent wins.** The header model picker is disabled while that agent is selected, with the tooltip: "This agent picks its own model. Edit the agent to change it." The provider picker stays as is. |
| Missing key for the agent's provider? | 412 with the message from [Model Routing](./model-routing.md#errors-all-callers). No silent fallback. |
| Export | Cursor and Claude: write `model` only when it is a real id (`kind: "id"`). Never write `provider` or `task:` refs (BlackAgents-only). Windsurf and Antigravity: drop both. |

## Design

### 1. Schema — `lib/artifacts/schemas.ts`

Add to `artifactInputSchema.extra` (agents only):

```ts
/** Agents: model id, "inherit", or (phase 4) "task:<kind>". */
model: z.string().trim().max(200).nullable().optional(),
/** Agents: provider for `model`; absent = the caller's provider. */
provider: z.enum(["openai", "anthropic", "custom"]).nullable().optional(),
```

- `null` means "remove it" (same idea as clearing `tools`). Validate with `parseModelRef` in a `superRefine` so a bad value is a 400 with a clear message.
- `normalizeExtra`: keep `model`/`provider` for agents, strip them for other types. Do not write `model: inherit` — drop it.

### 2. Serializer — `lib/artifacts/serializer.ts`

`frontmatterFor` must write `model`/`provider` when sent and **delete** them when the editor sends `null`, exactly like `tools`/`mcpServers`. A hand-written `model:` that the editor did not touch must survive an update.

### 3. Resolver — `lib/llm/model-ref.ts` (new)

Create the types and `parseModelRef` / `pickModelLayer` from [Model Routing](./model-routing.md#shared-types-libllmmodel-refts-new-phase-2). Add:

```ts
/** The agent's layer, read from its frontmatter (aliases → inherit). */
export function agentModelLayer(agent: Artifact): ModelLayer
```

### 4. Chat — `lib/assistant/chat-service.ts`

In `prepareChat`, after loading `persona`:

1. `layers = [agentModelLayer(persona), { source: "assistant", ref: { kind: "id", model: request.model, provider: request.provider } }]`
2. Pick the first non-inherit layer; an agent id without `provider` uses `request.provider`.
3. Load credentials for **that** provider with `getVerifiedCredentials`; on `CredentialStateError` return the agent-specific 412.
4. Return the chosen `{ provider, model, source }` with the prepared chat.

`app/api/chat/route.ts`: add `model: { provider, model, source }` to the `context` SSE event.

### 5. Chat UI — `components/features/chat/chat-page.tsx`

- Extend `chatContextEventSchema` with the optional `model` object.
- When the selected agent's frontmatter has a real `model` (from `WorkspaceProvider` artifacts), disable the header `ModelCombobox` and show a small badge next to it: `<model> · from agent`. After a reply, use the `context` event's value (it is the truth).
- Do **not** overwrite the user's saved header selection (`persistSelection`) with the agent's model.

### 6. Workflows — `lib/workflows/executor.ts`

Today one `llm` is resolved before the loop. Change to: resolve per step with layers `[agentModelLayer(agent), workflowLayer]`, and cache by `provider + model` so steps sharing a model reuse credentials. Record `provider`, `model`, `modelSource` on `StepRun` (add the fields in `lib/workflows/schema.ts`; they are optional so old run files still parse). `app/api/workflows/[name]/runs/route.ts` must fail fast (412) when any step's agent needs an unverified provider.

### 7. Editor — `components/features/editor/artifact-editor.tsx`

For agents, add a **Model** section under the tools field:

- Provider `Select`: `Inherit` (default) · OpenAI · Anthropic · Custom.
- When not Inherit: the existing `ModelCombobox` (`components/features/chat/model-combobox.tsx`), with models from `GET /api/providers/models?id=<provider>`.
- Add `model` and `provider` to the form schema and to the save payload's `extra` (send `null` to clear).
- Helper text: "Chats with this agent and workflow steps that use it run on this model."

The wizard does not need this field (set it later in the editor).

### 8. Export — `lib/export/adapter.ts`

In `frontmatterFor`, for `type === "agent"` on `cursor` and `claude`: `if (ref.kind === "id") fm.model = ref.model`, written after `description`. Leave the alias values (`sonnet`, `fast`, …) as they are.

## Files

| File | Change |
|------|--------|
| `lib/llm/model-ref.ts` | **new** — types, `parseModelRef`, `pickModelLayer`, `agentModelLayer` |
| `lib/artifacts/schemas.ts` | `extra.model`, `extra.provider`, `normalizeExtra` |
| `lib/artifacts/serializer.ts` | write / clear the keys |
| `lib/assistant/chat-service.ts` | agent layer in `prepareChat` |
| `app/api/chat/route.ts` | `model` in the `context` event |
| `lib/workflows/llm.ts` | `resolveRunLlm` takes layers |
| `lib/workflows/executor.ts`, `lib/workflows/schema.ts` | per-step resolution, `StepRun` fields |
| `app/api/workflows/[name]/runs/route.ts` | fail-fast check |
| `components/features/editor/artifact-editor.tsx` | Model section |
| `components/features/chat/chat-page.tsx` | disabled picker + badge |
| `lib/export/adapter.ts` | keep `model` for Cursor/Claude |

## Tests

| Kind | File | Cases |
|------|------|-------|
| Unit | `tests/unit/llm/model-ref.test.ts` (new) | every row of the parse table; aliases → inherit; slash ids kept whole; `task:` rejected; `pickModelLayer` order |
| Unit | `tests/unit/artifacts/schemas.test.ts`, `serializer.test.ts` | save, clear with `null`, keep a hand-written value, stripped for non-agents |
| Unit | `tests/unit/export/adapter.test.ts` | Cursor/Claude keep id; drop `provider` and `task:`; Windsurf/Antigravity drop |
| Unit | `tests/unit/workflows/executor.test.ts` | two steps with two agents → two models; cache hit; `StepRun` records model |
| Integration | `tests/integration/chat-persona.route.test.ts` | agent model sent upstream; `context` event has `source: "agent"`; 412 when agent's provider is unverified; no-model agent unchanged |
| Integration | `tests/integration/workflows.route.test.ts` | run start 412 for an unverified agent provider |
| E2E | `e2e/agent-persona-chat.spec.ts` | picker disabled + badge for an agent with `model`; enabled for one without |

Filesystem tests use `makeTempEnv`; never touch the real workspace or `~/.black-agents`. Mock only the LLM `fetch`.

## Verification

1. `npm run type-check`, `npm run lint`, `npx vitest run`, `npx playwright test` are clean.
2. Running app (IronBee browser tools only): set an agent's model in the editor → save → file has `model:` → chat with the agent → header badge shows it, reply works → clear it → file has no `model:`.

## Open / Future

- A "Use my model for this chat" switch that overrides the agent.
- Map Claude aliases (`sonnet` → current Sonnet id) instead of treating them as inherit.

## Related

- [Model Routing](./model-routing.md) — shared rules
- [Workflow Step Models](./workflow-step-models.md) — next phase
- [Artifact Mentions](./artifact-mentions.md) — another agent-editor feature
- [LLM Integration](../architecture/llm-integration.md)
