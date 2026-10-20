import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ModelRefError } from "@/lib/llm/model-ref"
import { setProviderSecret } from "@/lib/secrets"
import { ensureWorkflowModels, resolveRunLlm } from "@/lib/workflows/llm"
import { workflowSchema } from "@/lib/workflows/schema"

import { makeTempEnv, seedArtifact, seedProject, type TempEnv } from "../../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
  await seedArtifact(env.workspace, ".cursor/agents/planner.md", "---\nname: planner\ndescription: Plans.\n---\nYou plan.\n")
})

afterEach(async () => {
  await env.cleanup()
})

describe("ensureWorkflowModels", () => {
  it("names the step when hand-written agent frontmatter is invalid", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/planner.md",
      "---\nname: planner\ndescription: Plans.\nmodel: task:nope\n---\nYou plan.\n"
    )
    const workflow = workflowSchema.parse({
      name: "line",
      steps: [{ id: "plan", agent: "planner" }],
    })
    await expect(ensureWorkflowModels(env.workspace, workflow, resolveRunLlm)).rejects.toMatchObject({
      message: 'Step "plan": Unknown model task "nope"',
      status: 400,
    } satisfies Partial<ModelRefError>)
  })

  it("fails with the step message when the chosen provider is not verified", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    const workflow = workflowSchema.parse({
      name: "line",
      steps: [{ id: "plan", agent: "planner", model: "claude-sonnet-4-20250514", provider: "anthropic" }],
    })
    await expect(ensureWorkflowModels(env.workspace, workflow, resolveRunLlm)).rejects.toThrow(
      'Step "plan" uses Anthropic, which is not verified. Verify it under AI Providers.'
    )
  })

  it("reads a project-only agent's model when scoped", async () => {
    await seedProject(env.workspace, "web", { inherits: [] })
    await seedArtifact(
      env.workspace,
      ".black-agents/projects/web/artifacts/agents/coach.md",
      "---\nname: coach\ndescription: Coaches.\nmodel: task:nope\n---\nYou coach.\n"
    )
    const workflow = workflowSchema.parse({
      name: "line",
      steps: [{ id: "drill", agent: "coach" }],
    })
    // Without the scope, the project agent is invisible, so there is nothing to blame — it just inherits.
    await expect(ensureWorkflowModels(env.workspace, workflow, resolveRunLlm)).rejects.toThrow(
      "No verified AI provider. Verify one under AI Providers."
    )
    // Scoped, the project agent's own (broken) model ref is the one that is checked.
    await expect(ensureWorkflowModels(env.workspace, workflow, resolveRunLlm, "web")).rejects.toMatchObject({
      message: 'Step "drill": Unknown model task "nope"',
      status: 400,
    } satisfies Partial<ModelRefError>)
  })
})
