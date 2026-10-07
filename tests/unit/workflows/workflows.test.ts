import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  evaluateStepGate,
  evaluateWorkflowPreflight,
} from "@/lib/decision/classify-workflow"
import { newRun } from "@/lib/workflows/executor"
import { buildStepMessage, filesChangedBy, handoffsFor } from "@/lib/workflows/handoff"
import { isDue } from "@/lib/workflows/runner"
import { workflowSchema, type StepRun, type Workflow } from "@/lib/workflows/schema"
import {
  deleteWorkflow,
  listRuns,
  listWorkflows,
  pruneRuns,
  readRun,
  readWorkflow,
  saveRun,
  saveWorkflow,
} from "@/lib/workflows/store"

import { choiceAnswer, fakeJev } from "../../helpers/jev"
import { makeTempEnv, type TempEnv } from "../../helpers/workspace"

function wf(overrides: Partial<Record<string, unknown>> = {}): Workflow {
  return workflowSchema.parse({
    name: "review-line",
    task: "Review the code",
    steps: [
      { id: "plan", agent: "planner" },
      { id: "build", agent: "builder" },
    ],
    ...overrides,
  })
}

function doneStep(id: string, output: string, files: string[] = []): StepRun {
  return { id, agent: `${id}-agent`, status: "succeeded", attempts: 1, output, toolExecutions: [], filesChanged: files }
}

describe("workflowSchema", () => {
  it("fills defaults", () => {
    const parsed = wf()
    expect(parsed.trigger).toEqual({ type: "manual" })
    expect(parsed.limits).toEqual({ stepTimeoutMinutes: 10, runTimeoutMinutes: 60, maxRetries: 1 })
    expect(parsed.steps[0]).toMatchObject({ input: "previous", allowWrites: false, maxTurns: 6, gate: false })
  })

  it("rejects duplicate step ids, bad triggers and empty steps", () => {
    expect(
      workflowSchema.safeParse({ name: "x", steps: [{ id: "a", agent: "p" }, { id: "a", agent: "q" }] }).success
    ).toBe(false)
    expect(
      workflowSchema.safeParse({ name: "x", trigger: { type: "interval", everyMinutes: 1 }, steps: [{ id: "a", agent: "p" }] }).success
    ).toBe(false)
    expect(workflowSchema.safeParse({ name: "x", steps: [] }).success).toBe(false)
  })
})

describe("handoff", () => {
  const done = [doneStep("plan", "the plan"), doneStep("build", "built", ["src/a.ts"])]

  it("hands on the previous, all, or no outputs", () => {
    const step = wf().steps[1]
    expect(handoffsFor({ ...step, input: "previous" }, done)).toEqual([
      { fromStep: "build", agent: "build-agent", output: "built", filesChanged: ["src/a.ts"] },
    ])
    expect(handoffsFor({ ...step, input: "all" }, done)).toHaveLength(2)
    expect(handoffsFor({ ...step, input: "task" }, done)).toEqual([])
    expect(handoffsFor(step, [{ ...done[0], status: "failed" }])).toEqual([])
  })

  it("quotes earlier outputs as untrusted JSON", () => {
    const workflow = wf()
    const text = buildStepMessage({
      workflow,
      step: workflow.steps[1],
      index: 1,
      task: "Ship it",
      handoffs: handoffsFor(workflow.steps[1], done),
      retryNote: "Try again",
    })
    expect(text).toContain("step 2 of 2")
    expect(text).toContain("untrusted data")
    expect(text).toContain('"output": "built"')
    expect(text).toContain("## Retry")
    expect(text).toContain("final result")
  })

  it("collects files from successful builtin fs_write calls only", () => {
    expect(
      filesChangedBy([
        { id: "1", server: "builtin", tool: "fs_write", args: {}, result: { path: "a.md" } },
        { id: "2", server: "builtin", tool: "fs_write", args: {}, error: "denied" },
        { id: "3", server: "github", tool: "fs_write", args: {}, result: { path: "b.md" } },
        { id: "4", server: "builtin", tool: "fs_write", args: {}, result: { path: "a.md" } },
      ])
    ).toEqual(["a.md"])
  })
})

describe("isDue", () => {
  const now = new Date(2026, 9, 7, 10, 0, 0)
  it("handles interval triggers", () => {
    const t = { type: "interval" as const, everyMinutes: 30 }
    expect(isDue(t, undefined, now)).toBe(true)
    expect(isDue(t, new Date(2026, 9, 7, 9, 45).toISOString(), now)).toBe(false)
    expect(isDue(t, new Date(2026, 9, 7, 9, 30).toISOString(), now)).toBe(true)
  })
  it("handles daily triggers", () => {
    expect(isDue({ type: "daily", at: "11:00" }, undefined, now)).toBe(false)
    expect(isDue({ type: "daily", at: "09:00" }, undefined, now)).toBe(true)
    expect(isDue({ type: "daily", at: "09:00" }, new Date(2026, 9, 7, 9, 1).toISOString(), now)).toBe(false)
    expect(isDue({ type: "daily", at: "09:00" }, new Date(2026, 9, 6, 9, 1).toISOString(), now)).toBe(true)
    expect(isDue({ type: "manual" }, undefined, now)).toBe(false)
  })
})

describe("workflow store", () => {
  let env: TempEnv
  beforeEach(async () => {
    env = await makeTempEnv()
  })
  afterEach(async () => {
    await env.cleanup()
  })

  it("saves, lists, reads and deletes workflows", async () => {
    await saveWorkflow(env.workspace, wf())
    expect((await listWorkflows(env.workspace)).map((w) => w.name)).toEqual(["review-line"])
    expect((await readWorkflow(env.workspace, "review-line"))?.steps).toHaveLength(2)
    expect(await deleteWorkflow(env.workspace, "review-line")).toBe(true)
    expect(await readWorkflow(env.workspace, "review-line")).toBeNull()
    expect(await deleteWorkflow(env.workspace, "review-line")).toBe(false)
  })

  it("ignores invalid workflow files", async () => {
    const dir = path.join(env.workspace, ".black-agents/workflows")
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "broken.workflow.json"), "{nope", "utf8")
    await writeFile(path.join(dir, "other.workflow.json"), JSON.stringify({ name: "mismatch", steps: [{ id: "a", agent: "p" }] }), "utf8")
    expect(await listWorkflows(env.workspace)).toEqual([])
  })

  it("saves runs, git-ignores local state and prunes old runs", async () => {
    for (let i = 0; i < 3; i++) {
      const run = newRun({ id: `run-${i}`, workflow: wf(), workspaceRoot: env.workspace, trigger: "manual", task: "t", now: new Date(2026, 0, i + 1) })
      run.status = "succeeded"
      run.finishedAt = run.createdAt
      await saveRun(run)
    }
    const ignore = await readFile(path.join(env.workspace, ".black-agents/.gitignore"), "utf8")
    expect(ignore).toContain("runs/")
    expect(ignore).toContain("brain/inbox/")
    expect((await listRuns(env.workspace)).map((r) => r.id)).toEqual(["run-2", "run-1", "run-0"])
    expect(await pruneRuns(env.workspace, 1)).toBe(2)
    expect((await listRuns(env.workspace)).map((r) => r.id)).toEqual(["run-2"])
  })

  it("rejects bad run ids and malformed run files", async () => {
    expect(await readRun(env.workspace, "../secrets")).toBeNull()
    const dir = path.join(env.workspace, ".black-agents/runs")
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "bad.json"), JSON.stringify({ id: "bad" }), "utf8")
    expect(await readRun(env.workspace, "bad")).toBeNull()
  })
})

describe("workflow decisions", () => {
  const gateParams = {
    workflow: "w",
    task: "t",
    stepId: "s",
    agent: "a",
    instructions: "",
    output: "o",
    isLastStep: false,
  }

  it("step gate is unavailable without Jev and never throws", async () => {
    expect(await evaluateStepGate({ ...gateParams, resolved: null })).toEqual({ kind: "unavailable" })
    const failing = fakeJev(new Error("boom"))
    expect((await evaluateStepGate({ ...gateParams, resolved: failing })).kind).toBe("error")
  })

  it("step gate returns Jev's label", async () => {
    const jev = fakeJev({ next: choiceAnswer("retry", 0.9) })
    expect(await evaluateStepGate({ ...gateParams, resolved: jev })).toMatchObject({ kind: "decided", label: "retry", confidence: 0.9 })
    const odd = fakeJev({ next: choiceAnswer("maybe", 0.9) })
    expect((await evaluateStepGate({ ...gateParams, resolved: odd })).kind).toBe("error")
  })

  const preflight = { workflow: "w", description: "", task: "t", lastRun: null, changedFiles: [] }

  it("preflight skips only when very sure", async () => {
    const sure = fakeJev({ actionRequired: { type: "noul", noul: 0.02 }, next: choiceAnswer("skip", 0.97) })
    expect((await evaluateWorkflowPreflight({ ...preflight, resolved: sure })).kind).toBe("skip")
    const unsure = fakeJev({ actionRequired: { type: "noul", noul: 0.02 }, next: choiceAnswer("skip", 0.9) })
    expect((await evaluateWorkflowPreflight({ ...preflight, resolved: unsure })).kind).toBe("run")
    const changed = fakeJev({ actionRequired: { type: "noul", noul: 0.4 }, next: choiceAnswer("skip", 0.99) })
    expect((await evaluateWorkflowPreflight({ ...preflight, resolved: changed })).kind).toBe("run")
    expect((await evaluateWorkflowPreflight({ ...preflight, resolved: null })).kind).toBe("unavailable")
    expect((await evaluateWorkflowPreflight({ ...preflight, resolved: fakeJev(new Error("x")) })).kind).toBe("error")
  })
})
