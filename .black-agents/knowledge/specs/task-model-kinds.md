---
type: Spec
title: Task Model Kinds
description: 'phase 4: task:vision etc. from Settings → AI'
tags:
  - blackagents
  - spec
  - llm
  - settings
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/07%20-%20Specs/Task%20Model%20Kinds.md
    title: Task Model Kinds
    last_modified: '2026-10-11T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:44Z'
---

# Task Model Kinds (phase 4)

> [!abstract] One-liner
> Agents and steps can say **what kind** of model they need (`model: task:vision`) instead of a fixed id. The real model for each kind is set once in Settings → AI → Models by task. Change it there, and every agent and step using that kind follows.

> [!success] Shipped
> Implemented on 2026-10-11. Vision, Fast, and Reasoning settings, task refs, usage labels, provider filtering, and tests are complete.

Needs [Agent Models](./agent-models.md) and [Workflow Step Models](./workflow-step-models.md) merged first. Shared rules: [Model Routing](./model-routing.md).

## What exists (phase 1)

- `lib/llm/task-models.ts`: `modelTaskSchema = z.enum(["voice"])`, `MODEL_TASKS` (label, description, `openRouterDefault`, `fitHint`, `fits`), `modelsForTask`, `resolveTaskModel`.
- `lib/settings.ts`: `models.voice?: string` (Custom provider only); PUT `models.voice: null` resets it.
- `GET /api/settings/ai/models?task=voice` (`app/api/settings/ai/models/route.ts`).
- `components/features/settings/task-models-card.tsx`: tabs from `MODEL_TASKS`, one `TaskModelPanel` per tab.
- `lib/llm/list-models.ts` → `listModelsWithModalities` (OpenRouter `architecture.input_modalities` / `output_modalities`).

## New kinds

| Kind | Tab label | Usable in `task:` refs | Fits (OpenRouter metadata) | Default |
|------|-----------|------------------------|----------------------------|---------|
| `voice` | Voice | **no** (special job, not a chat model) | audio in + text out | `google/gemini-2.5-flash` on OpenRouter (unchanged) |
| `vision` | Vision | yes | `image` in + `text` out | none |
| `fast` | Fast | yes | text out (no extra filter) | none |
| `reasoning` | Reasoning | yes | `supported_parameters` includes `reasoning` | none |

For OpenAI and Anthropic, list the provider's models without filtering (their curated lists in `lib/llm/providers/*.ts` all accept images; filtering is only possible where metadata exists).

## Decisions

| Question | Decision |
|----------|----------|
| Which provider does a kind use? | Chat kinds store `{ provider, model }`. Voice keeps its plain string (Custom only) so phase 1 data still works. |
| Kind not set? | **Error, no silent fallback**: 412 `Set the <Label> model in Settings → AI → Models by task`. The user asked for a kind on purpose. |
| Can `provider:` be set next to `task:`? | No — the kind owns the provider. 400 on save. |
| Voice in `task:` refs? | Rejected: `"voice" is not a chat model task`. |

## Design

### 1. Task definitions — `lib/llm/task-models.ts`

```ts
export const modelTaskSchema = z.enum(["voice", "vision", "fast", "reasoning"])
export const chatModelTaskSchema = z.enum(["vision", "fast", "reasoning"])
export type ChatModelTask = z.infer<typeof chatModelTaskSchema>

export interface ModelTaskDefinition {
  id: ModelTask
  label: string
  description: string
  /** "chat" tasks can be named in `model: task:<kind>`. */
  usage: "special" | "chat"
  openRouterDefault?: string          // was required; now optional
  fitHint: string
  fits: (model: ModelInfo) => boolean
}

export interface ModelInfo {
  id: string
  name?: string
  inputModalities?: string[]
  outputModalities?: string[]
  supportedParameters?: string[]     // new: OpenRouter `supported_parameters`
}
```

`modelsForTask` stays as is. Treat a model as "has metadata" when it has modalities; for `reasoning`, a missing `supportedParameters` means "does not fit" only when other models have it.

### 2. Model list — `lib/llm/list-models.ts`

- Parse `supported_parameters` in `listModelsWithModalities`.
- Move the provider model logic from `app/api/providers/models/route.ts` into `listProviderModels(id): Promise<{ models: ModelInfo[]; source: "static" | "live"; warning?: string }>` so both routes share it. Custom uses `listModelsWithModalities`; OpenAI uses the live `/models` merged with the curated list; Anthropic uses the curated list.

### 3. Settings — `lib/settings.ts`

```ts
const taskChoiceSchema = z.object({
  provider: z.enum(["openai", "anthropic", "custom"]),
  model: taskModelIdSchema,
})
models: z.object({
  voice: taskModelIdSchema.optional(),
  vision: taskChoiceSchema.optional(),
  fast: taskChoiceSchema.optional(),
  reasoning: taskChoiceSchema.optional(),
}).default({})
```

Patch: each key accepts its value or `null` (reset). Update `mergeModels`. Existing `settings.json` files must still parse.

### 4. Resolution — `lib/llm/model-ref.ts`

- `parseModelRef("task:vision", undefined)` → `{ kind: "task", task: "vision" }`; reject unknown kinds, `voice`, and a `provider` next to it.
- New `resolveTaskRef(task, settings): { provider, model }`, throwing a 412-mapped error when unset.
- `resolveRunLlm(layers)` and `prepareChat` call it when the winning layer is a task ref. Set `ResolvedModelChoice.task` so the UI can show `vision → gpt-4.1`.

Read settings with `readAiSettings()` once per chat request / run, not per step.

### 5. API — `app/api/settings/ai/models/route.ts`

- `task` accepts every kind. For chat kinds also accept `provider` (default: the saved provider, else the first verified one).
- Response adds `provider` and, for chat kinds, `providers: Array<{ id, label, verified }>`. Keep `saved`, `effective`, `defaultModel`, `models`, `filtered`, `warning`.
- PUT stays on `/api/settings/ai`: `{ models: { vision: { provider, model } | null } }`.

### 6. Settings UI — `components/features/settings/task-models-card.tsx`

- Tabs come from `MODEL_TASKS`, so new kinds show up on their own. Give each an icon (`Mic`, `Eye`, `Zap`, `Brain` from lucide).
- Chat-kind panels add a provider `Select` (unverified providers disabled, with "Verify under AI Providers") before the model combobox. Changing the provider reloads the list with `&provider=`.
- Under the picker, list who uses this kind: "Used by: reviewer (agent), nightly-report → summarize (step)". Compute it on the client from `WorkspaceProvider` artifacts and `GET /api/workflows`. Show "Not used yet" otherwise.

### 7. Model pickers in the agent editor and step builder

The provider `Select` from phases 2–3 gets a second group, **Task kind**: Vision · Fast · Reasoning. Picking one writes `model: task:<kind>` and no `provider`, and hides the model combobox. Summary text: `task:vision → gpt-4.1 (OpenAI)`, or `task:vision → not set` with a link to `/settings?tab=ai`.

### 8. Export

Unchanged from phase 2: `task:` refs are never exported (the target tool runs on its default model).

## Files

| File | Change |
|------|--------|
| `lib/llm/task-models.ts` | new kinds, `usage`, `supportedParameters` |
| `lib/llm/list-models.ts` | `supported_parameters`, `listProviderModels` |
| `app/api/providers/models/route.ts` | use `listProviderModels` |
| `lib/settings.ts` | chat-kind choices + patch |
| `lib/llm/model-ref.ts` | `task:` parsing, `resolveTaskRef` |
| `lib/workflows/llm.ts`, `lib/assistant/chat-service.ts` | resolve task refs |
| `app/api/settings/ai/models/route.ts` | chat kinds + provider param |
| `components/features/settings/task-models-card.tsx` | new tabs, provider select, "Used by" |
| `components/features/editor/artifact-editor.tsx`, `components/features/workflows/workflow-builder.tsx` | Task kind group |

## Tests

| Kind | File | Cases |
|------|------|-------|
| Unit | `tests/unit/llm/task-models.test.ts` | vision / reasoning filters; fast unfiltered; voice behavior unchanged |
| Unit | `tests/unit/llm/model-ref.test.ts` | `task:` valid kinds; reject `voice`, unknown, `provider` next to it; `resolveTaskRef` set / unset |
| Unit | `tests/unit/llm/list-models.test.ts` | `supported_parameters` parsed; `listProviderModels` per provider |
| Integration | `tests/integration/settings-ai-models.route.test.ts` | chat kind with `provider`; save / reset `{ provider, model }`; old `settings.json` still parses |
| Integration | `tests/integration/chat-persona.route.test.ts` | agent `task:vision` → saved model used, `context.model.task === "vision"`; unset → 412 |
| Unit | `tests/unit/workflows/executor.test.ts` | step `task:fast` resolved once per run |
| E2E | `e2e/ai-settings.spec.ts` | Vision tab: choose provider + model, save; "Used by" lists a stubbed agent |
| E2E | `e2e/agent-persona-chat.spec.ts` or a new spec | agent editor: pick Task kind → Vision → file gets `model: task:vision` |

## Verification

1. type-check, lint, unit, integration, E2E clean.
2. Running app (IronBee browser tools only): set Vision to a model → give an agent `task:vision` → chat with it → header badge shows `task:vision → <model>` → change Vision in settings → next reply uses the new model with no agent edit.

## Open / Future

- **Auto-routing:** when a chat message has images and the current model has no image input, offer to use the Vision model for that turn.
- More kinds (embeddings, image generation) once something in the app needs them.
- Let Jev suggest a kind per step.

## Related

- [Model Routing](./model-routing.md) — shared rules
- [Agent Models](./agent-models.md) · [Workflow Step Models](./workflow-step-models.md) — earlier phases
- [LLM Integration](../architecture/llm-integration.md) — voice model, providers
