import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { scanWorkspace } from "@/lib/artifacts/parser"
import type { ResolvedDecisionClient } from "@/lib/decision/client"
import { listPendingApprovals, resolveApproval } from "@/lib/runtime/approvals"
import type { RuntimeTool } from "@/lib/runtime/types"
import { executeRun, newRun, type ExecutorDeps } from "@/lib/workflows/executor"
import { workflowSchema, type Workflow, type WorkflowRun } from "@/lib/workflows/schema"

import { choiceAnswer, fakeJev } from "../../helpers/jev"
import { call, fakeTool, scriptedProvider } from "../../helpers/runtime"
import { makeTempEnv, seedArtifact, type TempEnv } from "../../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
  await seedArtifact(env.workspace, ".cursor/agents/planner.md", "---\nname: planner\ndescription: Plans.\n---\nYou plan.\n")
  await seedArtifact(env.workspace, ".cursor/agents/builder.md", "---\nname: builder\ndescription: Builds.\ntools: [fs_write]\n---\nYou build.\n")
})

afterEach(async () => {
  await env.cleanup()
})

function workflow(overrides: Record<string, unknown> = {}): Workflow {
  return workflowSchema.parse({
    name: "line",
    task: "Make a thing",
    steps: [
      { id: "plan", agent: "planner" },
      { id: "build", agent: "builder" },
    ],
    ...overrides,
  })
}

function deps(
  provider: ReturnType<typeof scriptedProvider>,
  options: { tools?: RuntimeTool[]; jev?: ResolvedDecisionClient | null; saved?: WorkflowRun[] } = {}
): ExecutorDeps {
  return {
    artifacts: scanWorkspace,
    resolveLlm: async () => ({ provider, credentials: { apiKey: "k" }, secret: { apiKey: "k" }, model: "m" }),
    buildTools: async () => options.tools ?? [],
    decision: async () => options.jev ?? null,
    brainContext: async () => "## Agent memory\n\n- prefers tests",
    save: async (run) => {
      options.saved?.push(structuredClone(run))
    },
    emit: () => undefined,
  }
}

function start(wf: Workflow): WorkflowRun {
  return newRun({ id: "run-1", workflow: wf, workspaceRoot: env.workspace, trigger: "manual", task: wf.task })
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error("timed out")
}

describe("executeRun", () => {
  it("runs steps in order and hands each output to the next", async () => {
    const provider = scriptedProvider([{ content: "PLAN: three parts" }, { content: "Built all parts" }])
    const wf = workflow()
    const run = await executeRun(start(wf), wf, deps(provider), new AbortController().signal)

    expect(run.status).toBe("succeeded")
    expect(run.steps.map((s) => s.status)).toEqual(["succeeded", "succeeded"])
    expect(run.report).toBe("Built all parts")
    const second = provider.requests[1]
    expect(second.messages.at(-1)?.content).toContain("PLAN: three parts")
    expect(second.systemContext).toContain("You build.")
    expect(second.systemContext).toContain("prefers tests")
  })

  it("fails when an agent is missing and skips the rest", async () => {
    const wf = workflow({ steps: [{ id: "a", agent: "ghost" }, { id: "b", agent: "planner" }] })
    const run = await executeRun(start(wf), wf, deps(scriptedProvider([{ content: "x" }])), new AbortController().signal)
    expect(run.status).toBe("failed")
    expect(run.error).toContain('"ghost"')
    expect(run.steps.map((s) => s.status)).toEqual(["skipped", "skipped"])
  })

  it("fails the run when a step's LLM call fails", async () => {
    const wf = workflow()
    const run = await executeRun(
      start(wf),
      wf,
      deps(scriptedProvider([{ content: "ok" }, new Error("upstream down")])),
      new AbortController().signal
    )
    expect(run.status).toBe("failed")
    expect(run.steps[1]).toMatchObject({ status: "failed", error: "upstream down" })
  })

  it("retries a step when Jev says retry, then continues", async () => {
    const provider = scriptedProvider([{ content: "draft" }, { content: "better" }, { content: "built" }])
    const wf = workflow({ steps: [{ id: "plan", agent: "planner", gate: true }, { id: "build", agent: "builder" }] })
    const jev = fakeJev({ next: choiceAnswer("retry", 0.95) })
    const run = await executeRun(start(wf), wf, deps(provider, { jev }), new AbortController().signal)
    expect(run.status).toBe("succeeded")
    expect(run.steps[0]).toMatchObject({ attempts: 2, output: "better", gate: { decision: "retry", by: "jev" } })
    expect(provider.requests[1].messages.at(-1)?.content).toContain("## Retry")
  })

  it("stops the line early when Jev says stop", async () => {
    const wf = workflow({ steps: [{ id: "plan", agent: "planner", gate: true }, { id: "build", agent: "builder" }] })
    const jev = fakeJev({ next: choiceAnswer("stop", 0.9) })
    const run = await executeRun(start(wf), wf, deps(scriptedProvider([{ content: "already done" }]), { jev }), new AbortController().signal)
    expect(run.status).toBe("succeeded")
    expect(run.steps[1].status).toBe("skipped")
    expect(run.report).toContain("Stopped early")
  })

  it("ignores low-confidence gate answers", async () => {
    const wf = workflow({ steps: [{ id: "plan", agent: "planner", gate: true }] })
    const jev = fakeJev({ next: choiceAnswer("stop", 0.5) })
    const run = await executeRun(start(wf), wf, deps(scriptedProvider([{ content: "x" }]), { jev }), new AbortController().signal)
    expect(run.steps[0].gate).toEqual({ decision: "continue", by: "default" })
  })

  it("waits for approval, records files changed, and continues", async () => {
    const write = fakeTool("fs_write", "write", (args) => ({ path: args.path }))
    const provider = scriptedProvider([
      { content: "plan" },
      { toolCalls: [call("c1", "fs_write", { path: "out.md", content: "hi" })] },
      { content: "wrote out.md" },
    ])
    const saved: WorkflowRun[] = []
    const wf = workflow()
    const done = executeRun(start(wf), wf, deps(provider, { tools: [write], saved }), new AbortController().signal)

    await waitFor(() => listPendingApprovals().some((a) => a.scope.kind === "run"))
    expect(saved.at(-1)).toMatchObject({ status: "waiting_approval", pendingApproval: { tool: "fs_write" } })
    const pending = listPendingApprovals().find((a) => a.scope.kind === "run")
    resolveApproval(pending?.id ?? "", { approved: true })

    const run = await done
    expect(run.status).toBe("succeeded")
    expect(run.steps[1].filesChanged).toEqual(["out.md"])
    expect(write.calls).toHaveLength(1)
  })

  it("auto-approves writes when the step allows them", async () => {
    const write = fakeTool("fs_write", "write", (args) => ({ path: args.path }))
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "fs_write", { path: "a.md", content: "x" })] },
      { content: "done" },
    ])
    const wf = workflow({ steps: [{ id: "build", agent: "builder", allowWrites: true }] })
    const run = await executeRun(start(wf), wf, deps(provider, { tools: [write] }), new AbortController().signal)
    expect(run.status).toBe("succeeded")
    expect(write.calls).toHaveLength(1)
  })

  it("cancels while waiting for approval", async () => {
    const write = fakeTool("fs_write", "write")
    const provider = scriptedProvider([{ toolCalls: [call("c1", "fs_write", { path: "a.md" })] }])
    const controller = new AbortController()
    const wf = workflow({ steps: [{ id: "build", agent: "builder" }] })
    const done = executeRun(start(wf), wf, deps(provider, { tools: [write] }), controller.signal)
    await waitFor(() => listPendingApprovals().some((a) => a.scope.kind === "run"))
    controller.abort()
    const run = await done
    expect(run.status).toBe("cancelled")
    expect(run.pendingApproval).toBeNull()
    expect(listPendingApprovals().filter((a) => a.scope.kind === "run")).toEqual([])
  })

  it("fails cleanly when no LLM can be resolved", async () => {
    const wf = workflow()
    const d = deps(scriptedProvider([{ content: "x" }]))
    d.resolveLlm = async () => {
      throw new Error("No verified AI provider")
    }
    const run = await executeRun(start(wf), wf, d, new AbortController().signal)
    expect(run).toMatchObject({ status: "failed", error: "No verified AI provider" })
  })
})
