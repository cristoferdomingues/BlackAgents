import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ModelRefError } from "@/lib/llm/model-ref"
import { setProviderSecret } from "@/lib/secrets"
import { ensureWorkflowModels, resolveRunLlm } from "@/lib/workflows/llm"
import { workflowSchema } from "@/lib/workflows/schema"

import { makeTempEnv, seedArtifact, type TempEnv } from "../../helpers/workspace"

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
})
