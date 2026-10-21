import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { scanWorkspace } from "@/lib/artifacts/parser"
import type { ResolvedDecisionClient } from "@/lib/decision/client"
import { ModelRefError } from "@/lib/llm/model-ref"
import { setProviderSecret } from "@/lib/secrets"
import { listPendingApprovals } from "@/lib/runtime/approvals"
import { newRun } from "@/lib/workflows/executor"
import { resolveRunLlm } from "@/lib/workflows/llm"
import { WorkflowRunner } from "@/lib/workflows/runner"
import { isTerminal, workflowSchema, type Workflow, type WorkflowRun } from "@/lib/workflows/schema"
import { listRuns, readRun, saveRun, saveWorkflow } from "@/lib/workflows/store"

import { choiceAnswer, fakeJev } from "../../helpers/jev"
import { call, fakeTool, scriptedProvider } from "../../helpers/runtime"
import { makeTempEnv, seedArtifact, seedProject, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
let runner: WorkflowRunner

function workflow(overrides: Record<string, unknown> = {}): Workflow {
  return workflowSchema.parse({ name: "line", task: "Do it", steps: [{ id: "only", agent: "planner" }], ...overrides })
}

function makeRunner(
  provider = scriptedProvider([{ content: "done" }]),
  options: { jev?: ResolvedDecisionClient; tools?: ReturnType<typeof fakeTool>[] } = {}
): WorkflowRunner {
  return new WorkflowRunner({
    artifacts: scanWorkspace,
    resolveLlm: async () => ({ provider, credentials: { apiKey: "k" }, secret: { apiKey: "k" }, model: "m" }),
    buildTools: async () => options.tools ?? [],
    decision: async () => options.jev ?? null,
    brainContext: async () => "",
  })
}

function untilTerminal(r: WorkflowRunner, id: string): Promise<WorkflowRun> {
  return new Promise((resolve) => {
    const off = r.subscribe((run) => {
      if (run.id === id && isTerminal(run.status)) {
        off()
        resolve(run)
      }
    })
  })
}

beforeEach(async () => {
  env = await makeTempEnv()
  await seedArtifact(env.workspace, ".cursor/agents/planner.md", "---\nname: planner\ndescription: Plans.\n---\nYou plan.\n")
})

afterEach(async () => {
  runner?.stop()
  await env.cleanup()
})

describe("WorkflowRunner", () => {
  it("runs an enqueued workflow, saves it and calls the finished hook", async () => {
    runner = makeRunner()
    const finished: string[] = []
    runner.onFinished = async (run) => {
      finished.push(run.id)
    }
    await saveWorkflow(env.workspace, workflow())
    const run = await runner.enqueue({ root: env.workspace, workflow: workflow(), trigger: "manual", task: "Custom task" })
    const done = await untilTerminal(runner, run.id)
    expect(done.status).toBe("succeeded")
    expect(done.task).toBe("Custom task")
    for (let i = 0; i < 400 && runner.isActive(env.workspace, "line"); i++) await new Promise((r) => setTimeout(r, 5))
    expect((await readRun(env.workspace, run.id))?.status).toBe("succeeded")
    expect(finished).toEqual([run.id])
    expect(runner.isActive(env.workspace, "line")).toBe(false)
  })

  it("runs one at a time per workflow and cancels queued runs", async () => {
    const write = fakeTool("fs_write", "write")
    runner = makeRunner(scriptedProvider([{ toolCalls: [call("c", "fs_write", { path: "a" })] }]), { tools: [write] })
    const wf = workflow()
    const first = await runner.enqueue({ root: env.workspace, workflow: wf, trigger: "manual" })
    const second = await runner.enqueue({ root: env.workspace, workflow: wf, trigger: "manual" })
    expect(runner.isActive(env.workspace, "line")).toBe(true)

    expect(await runner.cancel(second.id)).toBe(true)
    expect((await readRun(env.workspace, second.id))?.status).toBe("cancelled")

    for (let i = 0; i < 100 && listPendingApprovals().length === 0; i++) await new Promise((r) => setTimeout(r, 5))
    const done = untilTerminal(runner, first.id)
    expect(await runner.cancel(first.id)).toBe(true)
    expect((await done).status).toBe("cancelled")
    expect(await runner.cancel("missing")).toBe(false)
  })

  it("marks runs left by a previous process as failed", async () => {
    runner = makeRunner()
    const stale = newRun({ id: "stale-1", workflow: workflow(), workspaceRoot: env.workspace, trigger: "manual", task: "" })
    stale.status = "running"
    await saveRun(stale)
    expect(await runner.recover(env.workspace)).toBe(1)
    expect(await readRun(env.workspace, "stale-1")).toMatchObject({ status: "failed", error: expect.stringContaining("Interrupted") })
  })

  it("starts due scheduled workflows and records the check", async () => {
    runner = makeRunner()
    await saveWorkflow(env.workspace, workflow({ name: "hourly", trigger: { type: "interval", everyMinutes: 60 } }))
    await saveWorkflow(env.workspace, workflow({ name: "manual-one" }))
    const now = new Date()
    let finished: (() => void) | undefined
    const done = new Promise<void>((resolve) => (finished = resolve))
    runner.onFinished = async () => finished?.()
    expect(await runner.tick(now)).toEqual(["hourly"])
    await done
    const state = JSON.parse(
      await readFile(path.join(env.workspace, ".black-agents/runs/.schedule-state.json"), "utf8")
    ) as Record<string, { lastCheckAt: string }>
    expect(state.hourly.lastCheckAt).toBe(now.toISOString())
    expect(await runner.tick(new Date(now.getTime() + 60_000))).toEqual([])
  })

  it("fails a scheduled run through the real resolver when a step provider is not verified", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    runner = new WorkflowRunner({
      artifacts: scanWorkspace,
      resolveLlm: (layers, options) => resolveRunLlm(layers, options),
      buildTools: async () => [],
      decision: async () => null,
      brainContext: async () => "",
    })
    await saveWorkflow(
      env.workspace,
      workflow({
        name: "hourly",
        trigger: { type: "interval", everyMinutes: 60 },
        steps: [{ id: "only", agent: "planner", model: "claude-sonnet-4-20250514", provider: "anthropic" }],
      })
    )
    expect(await runner.tick(new Date())).toEqual([])
    const runs = await listRuns(env.workspace, "hourly")
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      status: "failed",
      trigger: "schedule",
      error: 'Step "only" uses Anthropic, which is not verified. Verify it under AI Providers.',
    })
    expect(runs[0]?.steps[0]?.status).toBe("skipped")
  })

  it("fails a scheduled run when a task kind has no model", async () => {
    runner = new WorkflowRunner({
      artifacts: scanWorkspace,
      resolveLlm: (layers, options) => resolveRunLlm(layers, options),
      buildTools: async () => [],
      decision: async () => null,
      brainContext: async () => "",
    })
    await saveWorkflow(
      env.workspace,
      workflow({
        name: "hourly",
        trigger: { type: "interval", everyMinutes: 60 },
        steps: [{ id: "only", agent: "planner", model: "task:reasoning" }],
      })
    )
    expect(await runner.tick(new Date())).toEqual([])
    const runs = await listRuns(env.workspace, "hourly")
    expect(runs[0]).toMatchObject({
      status: "failed",
      error: "Set the Reasoning model in Settings → AI → Models by task",
    })
  })

  it("marks a scheduled run failed when a step model is not verified", async () => {
    const message = 'Step "only" uses Anthropic, which is not verified. Verify it under AI Providers.'
    runner = new WorkflowRunner({
      artifacts: scanWorkspace,
      resolveLlm: async () => {
        throw new ModelRefError(message, 412, "unverified")
      },
      buildTools: async () => [],
      decision: async () => null,
      brainContext: async () => "",
    })
    await saveWorkflow(env.workspace, workflow({ name: "hourly", trigger: { type: "interval", everyMinutes: 60 } }))
    expect(await runner.tick(new Date())).toEqual([])
    const runs = await listRuns(env.workspace, "hourly")
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: "failed", error: message, trigger: "schedule" })
  })

  it("tracks the workspace and a project run of the same workflow name independently", async () => {
    const write = fakeTool("fs_write", "write")
    runner = makeRunner(scriptedProvider([{ toolCalls: [call("c", "fs_write", { path: "a" })] }]), { tools: [write] })
    await seedProject(env.workspace, "web", { inherits: ["agents"] })
    const wf = workflow()
    const workspaceRun = await runner.enqueue({ root: env.workspace, workflow: wf, trigger: "manual" })
    const projectRun = await runner.enqueue({ root: env.workspace, workflow: wf, trigger: "manual", scope: "web" })

    // Both run concurrently: the project run is a different queue key, not blocked by the workspace one.
    expect(runner.isActive(env.workspace, "line")).toBe(true)
    expect(runner.isActive(env.workspace, "line", "web")).toBe(true)
    expect(workspaceRun.projectScope).toBeUndefined()
    expect(projectRun.projectScope).toBe("web")

    for (let i = 0; i < 100 && listPendingApprovals().length < 2; i++) await new Promise((r) => setTimeout(r, 5))
    expect(await runner.cancel(workspaceRun.id)).toBe(true)
    expect(await runner.cancel(projectRun.id)).toBe(true)
    // Wait for both runs to finish writing, so cleanup does not race their run files.
    for (let i = 0; i < 400 && (runner.isActive(env.workspace, "line") || runner.isActive(env.workspace, "line", "web")); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(runner.isActive(env.workspace, "line")).toBe(false)
    expect(runner.isActive(env.workspace, "line", "web")).toBe(false)
  })

  it("resolves a project-only agent when a scoped run is enqueued", async () => {
    runner = new WorkflowRunner({
      artifacts: scanWorkspace,
      resolveLlm: (layers, options) => resolveRunLlm(layers, options),
      buildTools: async () => [],
      decision: async () => null,
      brainContext: async () => "",
    })
    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    await seedProject(env.workspace, "web", { inherits: [] })
    await seedArtifact(
      env.workspace,
      ".black-agents/projects/web/artifacts/agents/coach.md",
      "---\nname: coach\ndescription: Coaches.\nmodel: claude-sonnet-4-20250514\nprovider: anthropic\n---\nYou coach.\n"
    )
    const wf = workflow({ steps: [{ id: "drill", agent: "coach" }] })
    const run = await runner.enqueue({ root: env.workspace, workflow: wf, trigger: "manual", scope: "web" })
    const done = await untilTerminal(runner, run.id)
    // The step blames the project agent's own (unverified) provider — proof it was found and read.
    expect(done.status).toBe("failed")
    expect(done.error).toBe('Step "drill" uses Anthropic, which is not verified. Verify it under AI Providers.')
  })

  it("skips a scheduled run when Jev is sure nothing changed", async () => {
    const jev = fakeJev({ actionRequired: { type: "noul", noul: 0.01 }, next: choiceAnswer("skip", 0.99) })
    runner = makeRunner(undefined, { jev })
    await saveWorkflow(env.workspace, workflow({ name: "hourly", trigger: { type: "interval", everyMinutes: 60 } }))
    expect(await runner.tick(new Date())).toEqual([])
    expect(jev.systemOne).toHaveBeenCalledTimes(1)
  })
})
