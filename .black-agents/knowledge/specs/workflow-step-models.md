---
type: Spec
title: Workflow Step Models
description: 'phase 3: per-step override'
tags:
  - blackagents
  - spec
  - llm
  - workflows
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/07%20-%20Specs/Workflow%20Step%20Models.md
    title: Workflow Step Models
    last_modified: '2026-10-11T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:43Z'
---

# Workflow Step Models (phase 3)

> [!abstract] One-liner
> A workflow step can override the model, for example a cheap model to plan and a strong model to review. Order: step → agent → workflow → Assistant default.

> [!success] Shipped
> Implemented on 2026-10-11. Step overrides, fail-fast checks, model details on run records, builder/run UI, and tests are complete.

Needs [Agent Models](./agent-models.md) (phase 2) merged first: it creates `lib/llm/model-ref.ts`, the per-step resolution in the executor, and the `StepRun` model fields. Shared rules: [Model Routing](./model-routing.md).

## Requirements

- Each step may set `model` and `provider`, like an agent.
- The builder shows a per-step Model field, closed by default, showing what the step will use when nothing is set.
- The run page shows which model each step used and why (`step`, `agent`, `workflow`, `assistant`).
- Workflows saved before this change load and run the same way.

## Schema — `lib/workflows/schema.ts`

Add to `workflowStepSchema`:

```ts
/** Overrides the agent's and the workflow's model for this step. */
model: z.string().trim().max(200).optional(),
provider: z.enum(["openai", "anthropic", "custom"]).optional(),
```

Use `parseModelRef` in the existing `superRefine` so `provider` without `model`, or an unknown `task:` kind, is a 400 naming the step id (`Step "review": Unknown model task "x"`).

Assistant workflow drafts (`lib/llm/workflow-draft.ts`) parse with the same schema, so they get the fields for free. Add one line to the "Workflow protocol" section in `lib/llm/context.ts`: steps may set `model`/`provider`, but only when the user asks for it.

## Executor — `lib/workflows/executor.ts`

Per step, layers are:

```ts
[
  { source: "step", ref: parseModelRef(step.model, step.provider) },
  agentModelLayer(agent),
  { source: "workflow", ref: parseModelRef(workflow.model, workflow.provider) },
]
```

then `resolveRunLlm(layers)` (which falls back to `secrets.defaults`, then the first verified provider). Keep the cache from phase 2. Set `StepRun.modelSource = "step"` when the step layer won.

**Retries** (Jev gate `retry`) reuse the same model.

**Fail fast:** `app/api/workflows/[name]/runs/route.ts` resolves every step before queueing and returns the first 412 (`Step "<id>" uses <Provider>, which is not verified…`). Scheduled runs (`lib/workflows/runner.ts`) do the same check and mark the run failed with that message.

## Builder — `components/features/workflows/workflow-builder.tsx`

In each step card, under tools, add a collapsed **Model** row:

- Closed: `Model: <effective> · from <source>` (e.g. `gpt-4.1 · from workflow`). Compute on the client from the step, the agent's frontmatter (`WorkspaceProvider` artifacts), and the workflow's own fields; show `Assistant default` when all inherit.
- Open: provider `Select` (`Inherit` default · OpenAI · Anthropic · Custom) + `ModelCombobox` with `GET /api/providers/models?id=<provider>`. Same controls as the workflow-level picker (around lines 332–350) and the agent editor.
- Save sends `model`/`provider` only when set (omit for inherit).

## Run page

The run page is `app/workflows/runs/[id]/page.tsx`, which renders `components/features/workflows/run-view.tsx`. For each step show `provider · model` and a small `from <source>` label. Old runs without the fields show nothing.

## Files

| File | Change |
|------|--------|
| `lib/workflows/schema.ts` | step `model`/`provider` + validation |
| `lib/workflows/executor.ts` | step layer first |
| `app/api/workflows/[name]/runs/route.ts`, `lib/workflows/runner.ts` | fail fast per step |
| `lib/llm/context.ts` | one protocol line |
| `components/features/workflows/workflow-builder.tsx` | per-step Model row |
| `components/features/workflows/run-view.tsx` | show model per step |

## Tests

| Kind | File | Cases |
|------|------|-------|
| Unit | `tests/unit/workflows/workflows.test.ts` | schema accepts/rejects; old JSON without fields still parses |
| Unit | `tests/unit/workflows/executor.test.ts` | step beats agent beats workflow; retry keeps the model; `modelSource` correct |
| Unit | `tests/unit/workflows/runner.test.ts` | scheduled run fails with the step 412 message |
| Integration | `tests/integration/workflows.route.test.ts` | PUT saves step model; run start 412 for an unverified step provider |
| E2E | `e2e/workflows.spec.ts` | set a step model in the builder → summary shows `from step` → save → reload keeps it |

## Verification

1. type-check, lint, unit, integration, E2E clean.
2. Running app (IronBee browser tools only): a two-step workflow, step 2 with its own model → run → the run page shows two different models with the right `from …` labels.

## Open / Future

- Parallel steps (still out of scope, see [Future Phases](../roadmap/future-phases.md)).
- Per-step cost estimate.

## Related

- [Model Routing](./model-routing.md) — shared rules
- [Agent Models](./agent-models.md) — previous phase
- [Task Model Kinds](./task-model-kinds.md) — next phase
- [Workflows](../architecture/workflows.md)
