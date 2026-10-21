import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { scanWorkspace } from "@/lib/artifacts/parser"
import type { ResolvedDecisionClient } from "@/lib/decision/client"
import { selectLayeredModel, type ModelLayer } from "@/lib/llm/model-ref"
import type { LLMCredentials, ProviderId } from "@/lib/llm/types"
import { listPendingApprovals, resolveApproval } from "@/lib/runtime/approvals"
import type { RuntimeTool } from "@/lib/runtime/types"
import { setProviderSecret } from "@/lib/secrets"
import { updateAiSettings } from "@/lib/settings"
import { readAuditEvents } from "@/lib/workflows/audit"
import { executeRun, newRun, type ExecutorDeps } from "@/lib/workflows/executor"
import { resolveRunLlm, type ResolvedLlm } from "@/lib/workflows/llm"
import { workflowSchema, type Workflow, type WorkflowRun } from "@/lib/workflows/schema"

import { choiceAnswer, fakeJev, loggedJev } from "../../helpers/jev"
import { call, fakeTool, scriptedProvider } from "../../helpers/runtime"
import { makeTempEnv, seedArtifact, seedProject, type TempEnv } from "../../helpers/workspace"

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

function start(wf: Workflow, projectScope?: string): WorkflowRun {
  return newRun({ id: "run-1", workflow: wf, workspaceRoot: env.workspace, trigger: "manual", task: wf.task, projectScope })
}

function withScriptedGenerate(resolved: ResolvedLlm, scripted: ReturnType<typeof scriptedProvider>): ResolvedLlm {
  return {
    ...resolved,
    provider: {
      ...resolved.provider,
      generate: (request, credentials) => scripted.generate(request, credentials),
    },
  }
}

async function waitFor(check: () => boolean, ms = 1_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error("timed out")
}

describe("executeRun", () => {
  it("runs steps in order and hands each output to the next", async () => {
    const { writeConcept } = await import("@/lib/knowledge/store")
    await writeConcept(env.workspace, {
      id: "metrics/revenue",
      frontmatter: { type: "Metric", title: "Revenue", description: "Recognized revenue.", extra: {} },
      body: "SECRET-BODY-MARKER that must stay out of context.\n",
    })
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
    expect(second.systemContext).toContain("- metrics/revenue — Revenue — Recognized revenue.")
    expect(second.systemContext).not.toContain("SECRET-BODY-MARKER")
  })

  it("fails when an agent is missing and skips the rest", async () => {
    const wf = workflow({ steps: [{ id: "a", agent: "ghost" }, { id: "b", agent: "planner" }] })
    const run = await executeRun(start(wf), wf, deps(scriptedProvider([{ content: "x" }])), new AbortController().signal)
    expect(run.status).toBe("failed")
    expect(run.error).toContain('"ghost"')
    expect(run.steps.map((s) => s.status)).toEqual(["skipped", "skipped"])
  })

  it("finds a project-only agent and whitelisted knowledge when the run is scoped", async () => {
    const { writeConcept } = await import("@/lib/knowledge/store")
    await seedProject(env.workspace, "web", { inherits: ["knowledge"] })
    await seedArtifact(
      env.workspace,
      ".black-agents/projects/web/artifacts/agents/coach.md",
      "---\nname: coach\ndescription: Coaches.\n---\nYou coach.\n"
    )
    await writeConcept(env.workspace, {
      id: "drills/basics",
      frontmatter: { type: "Metric", title: "Drill basics", description: "How a drill works.", extra: {} },
      body: "Body.\n",
    })
    const provider = scriptedProvider([{ content: "Drilled" }])
    const wf = workflow({ steps: [{ id: "drill", agent: "coach" }] })

    // Unscoped: the project-only agent is invisible, so the step fails fast.
    const unscoped = await executeRun(start(wf), wf, deps(provider), new AbortController().signal)
    expect(unscoped.status).toBe("failed")
    expect(unscoped.error).toContain('"coach"')

    // Scoped: the project's own agent is found, and whitelisted workspace knowledge comes through.
    const run = await executeRun(start(wf, "web"), wf, deps(provider), new AbortController().signal)
    expect(run.status).toBe("succeeded")
    expect(run.steps[0]).toMatchObject({ status: "succeeded", output: "Drilled" })
    const request = provider.requests.at(-1)
    expect(request?.systemContext).toContain("You coach.")
    expect(request?.systemContext).toContain("drills/basics")
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

  it("gives a step hitting its safety limit one continuation round with a fresh budget", async () => {
    const lookup = fakeTool("lookup", "read")
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "lookup")] },
      { content: "partial, still working" },
      { content: "done" },
    ])
    const wf = workflow({ steps: [{ id: "build", agent: "builder", maxTurns: 1 }] })
    const run = await executeRun(start(wf), wf, deps(provider, { tools: [lookup] }), new AbortController().signal)

    expect(run.status).toBe("succeeded")
    expect(run.steps[0]).toMatchObject({ status: "succeeded", output: "done" })
    expect(provider.requests).toHaveLength(3)
    const events = await readAuditEvents(env.workspace, run.id, { types: ["continuation"] })
    expect(events).toHaveLength(1)
  })

  it("fails the run when a step hits its safety limit again after the continuation round", async () => {
    const lookup = fakeTool("lookup", "read")
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "lookup")] },
      { content: "partial" },
      { toolCalls: [call("c2", "lookup")] },
      { content: "still not done" },
    ])
    const wf = workflow({ steps: [{ id: "build", agent: "builder", maxTurns: 1 }] })
    const run = await executeRun(start(wf), wf, deps(provider, { tools: [lookup] }), new AbortController().signal)

    expect(run.status).toBe("failed")
    expect(run.error).toContain("tool-call safety limit twice")
    expect(run.steps[0].status).toBe("failed")
    expect(provider.requests).toHaveLength(4)
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

  it("uses the user's step level and records the gate decision", async () => {
    const wf = workflow({ steps: [{ id: "plan", agent: "planner", gate: true }, { id: "build", agent: "builder" }] })
    const careful = loggedJev({ next: choiceAnswer("stop", 0.88) }, { stepGate: 0.9 })
    const run = await executeRun(
      start(wf),
      wf,
      deps(scriptedProvider([{ content: "plan" }, { content: "built" }]), { jev: careful }),
      new AbortController().signal
    )
    expect(run.steps[1].status).toBe("succeeded")
    expect(careful.records[0]).toEqual({ kind: "stepGate", choice: "stop", score: 0.88, cutoff: 0.9, outcome: "below" })

    const failing = loggedJev(new Error("boom"))
    await executeRun(start(wf), wf, deps(scriptedProvider([{ content: "a" }, { content: "b" }]), { jev: failing }), new AbortController().signal)
    expect(failing.records[0]).toMatchObject({ kind: "stepGate", outcome: "error", score: null, cutoff: 0.85 })
  })

  it("sends a rejected review back to the fix step, then accepts the next review", async () => {
    const provider = scriptedProvider([
      { content: "first build" },
      { content: "Missing tests.\nVERDICT: reject" },
      { content: "added tests" },
      { content: "Looks good.\nVERDICT: approve" },
    ])
    const wf = workflow({
      steps: [
        { id: "build", agent: "builder" },
        { id: "fix", agent: "builder", repair: true },
        { id: "check", agent: "planner", review: true, input: "all", onReject: { step: "fix", maxRounds: 2 } },
      ],
    })
    const run = await executeRun(start(wf), wf, deps(provider), new AbortController().signal)
    expect(run.status).toBe("succeeded")
    expect(run.steps.map((s) => s.status)).toEqual(["succeeded", "succeeded", "succeeded"])
    expect(run.steps[1].output).toBe("added tests")
    expect(run.steps[2]).toMatchObject({ verdict: "approve", sentBack: 1 })
    const fixPrompt = provider.requests[2].messages.at(-1)?.content ?? ""
    expect(fixPrompt).toContain("Missing tests.")
    expect(fixPrompt).toContain("## Review feedback")
  })

  it("fails the run when the review still rejects after the fix rounds", async () => {
    const provider = scriptedProvider([
      { content: "first build" },
      { content: "Still broken.\nVERDICT: reject" },
      { content: "tried" },
      { content: "Still broken.\nVERDICT: reject" },
    ])
    const wf = workflow({
      steps: [
        { id: "build", agent: "builder" },
        { id: "fix", agent: "builder", repair: true },
        { id: "check", agent: "planner", review: true, onReject: { step: "fix", maxRounds: 1 } },
      ],
    })
    const run = await executeRun(start(wf), wf, deps(provider), new AbortController().signal)
    expect(run.status).toBe("failed")
    expect(run.error).toContain("1 fix round")
    expect(run.steps[2].verdict).toBe("reject")
  })

  it("skips a fix step when the review approves the first time", async () => {
    const provider = scriptedProvider([
      { content: "first build" },
      { content: "Good.\nVERDICT: approve" },
    ])
    const wf = workflow({
      steps: [
        { id: "build", agent: "builder" },
        { id: "fix", agent: "builder", repair: true },
        { id: "check", agent: "planner", review: true, onReject: { step: "fix", maxRounds: 2 } },
      ],
    })
    const run = await executeRun(start(wf), wf, deps(provider), new AbortController().signal)
    expect(run.status).toBe("succeeded")
    expect(run.steps[1].status).toBe("skipped")
    expect(run.steps[2].verdict).toBe("approve")
    expect(provider.requests).toHaveLength(2)
  })

  it("records a review step's verdict only on review steps", async () => {
    const provider = scriptedProvider([{ content: "code\nVERDICT: approve" }, { content: "No tests.\nVERDICT: reject" }])
    const wf = workflow({ steps: [{ id: "build", agent: "planner" }, { id: "review", agent: "builder", review: true }] })
    const run = await executeRun(start(wf), wf, deps(provider), new AbortController().signal)
    expect(run.status).toBe("succeeded")
    expect(run.steps[0].verdict).toBeUndefined()
    expect(run.steps[1].verdict).toBe("reject")
  })

  it("ignores low-confidence gate answers", async () => {
    const wf = workflow({ steps: [{ id: "plan", agent: "planner", gate: true }] })
    const jev = fakeJev({ next: choiceAnswer("stop", 0.5) })
    const run = await executeRun(start(wf), wf, deps(scriptedProvider([{ content: "x" }]), { jev }), new AbortController().signal)
    expect(run.steps[0].gate).toEqual({ decision: "continue", by: "default" })
  })

  it("pushes tool traces and live activity while the step runs", async () => {
    const lookup = fakeTool("lookup", "read")
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slowLookup = {
      ...lookup,
      async execute(args: Record<string, unknown>) {
        await gate
        return lookup.execute(args, { workspaceRoot: env.workspace })
      },
    }
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "lookup", { q: 1 })] },
      { content: "done" },
    ])
    const saved: WorkflowRun[] = []
    const wf = workflow({ steps: [{ id: "plan", agent: "planner" }] })
    const done = executeRun(start(wf), wf, deps(provider, { tools: [slowLookup], saved }), new AbortController().signal)

    await waitFor(
      () => saved.some((r) => r.steps[0]?.activity?.kind === "running_tool"),
      3_000
    )
    const mid = [...saved].reverse().find((r) => r.steps[0]?.activity?.kind === "running_tool")
    expect(mid?.steps[0]?.turn).toBe(1)
    expect(mid?.steps[0]?.activity?.label).toContain("lookup")
    release()
    const run = await done
    expect(run.status).toBe("succeeded")
    expect(run.steps[0].toolExecutions).toHaveLength(1)
    expect(run.steps[0].activity).toBeUndefined()
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

  it("uses the agent model for each step and reuses credentials for the same model", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/planner.md",
      "---\nname: planner\ndescription: Plans.\nmodel: gpt-4o\nprovider: openai\n---\nYou plan.\n"
    )
    await seedArtifact(
      env.workspace,
      ".cursor/agents/builder.md",
      "---\nname: builder\ndescription: Builds.\nmodel: claude-sonnet-4-20250514\nprovider: anthropic\n---\nYou build.\n"
    )
    const scripted = scriptedProvider([{ content: "PLAN" }, { content: "BUILT" }])
    const calls: ModelLayer[][] = []
    const d = deps(scripted)
    d.resolveLlm = async (layers) => {
      calls.push(layers)
      const selected = selectLayeredModel(layers, () => {
        throw new Error("no task")
      })
      const id = (selected?.provider ?? "openai") as ProviderId
      return {
        provider: { ...scripted, id, generate: (request, credentials) => scripted.generate(request, credentials) },
        credentials: { apiKey: "k" },
        secret: { apiKey: "k" },
        model: selected?.model ?? "m",
        source: selected?.source ?? "assistant",
      }
    }
    const run = await executeRun(start(workflow()), workflow(), d, new AbortController().signal)
    expect(run.status).toBe("succeeded")
    expect(calls).toHaveLength(2)
    expect(run.steps[0]).toMatchObject({ model: "gpt-4o", provider: "openai", modelSource: "agent" })
    expect(run.steps[1]).toMatchObject({
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
      modelSource: "agent",
    })
    expect(scripted.requests.map((request) => request.model)).toEqual(["gpt-4o", "claude-sonnet-4-20250514"])
  })

  it("lets the step beat the agent and the workflow, and retries keep that model", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/planner.md",
      "---\nname: planner\ndescription: Plans.\nmodel: claude-sonnet-4-20250514\nprovider: anthropic\n---\nYou plan.\n"
    )
    const scripted = scriptedProvider([{ content: "draft" }, { content: "better" }])
    let calls = 0
    const d = deps(scripted, { jev: fakeJev({ next: choiceAnswer("retry", 0.95) }) })
    d.resolveLlm = async (layers) => {
      calls += 1
      const selected = selectLayeredModel(layers, () => {
        throw new Error("no task")
      })
      return {
        provider: scripted,
        credentials: { apiKey: "k" },
        secret: { apiKey: "k" },
        model: selected?.model ?? "workflow-default",
        source: selected?.source ?? "assistant",
      }
    }
    const wf = workflow({
      provider: "openai",
      model: "gpt-4o",
      steps: [{ id: "plan", agent: "planner", model: "gpt-4.1", provider: "openai", gate: true }],
    })
    const run = await executeRun(start(wf), wf, d, new AbortController().signal)
    expect(run.status).toBe("succeeded")
    expect(calls).toBe(1)
    expect(run.steps[0]).toMatchObject({ attempts: 2, model: "gpt-4.1", modelSource: "step", provider: "openai" })
    expect(scripted.requests.map((request) => request.model)).toEqual(["gpt-4.1", "gpt-4.1"])
  })

  it("resolves a step task kind from settings read once and reuses those credentials", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-fast",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    await updateAiSettings({ models: { fast: { provider: "openai", model: "gpt-4o-mini" } } })
    const scripted = scriptedProvider([{ content: "one" }, { content: "two" }])
    const seen: ResolvedLlm[] = []
    const d = deps(scripted)
    d.resolveLlm = async (layers, options) => {
      const resolved = await resolveRunLlm(layers, options)
      seen.push(resolved)
      return withScriptedGenerate(resolved, scripted)
    }
    const wf = workflow({
      steps: [
        { id: "plan", agent: "planner", model: "task:fast" },
        { id: "build", agent: "builder", model: "task:fast" },
      ],
    })
    const settingsReads = vi.spyOn(await import("@/lib/settings"), "readAiSettings")
    const run = await executeRun(start(wf), wf, d, new AbortController().signal)
    expect(settingsReads).toHaveBeenCalledTimes(1)
    settingsReads.mockRestore()
    expect(run.status).toBe("succeeded")
    expect(seen).toHaveLength(2)
    expect(seen[0]?.credentials).toBe(seen[1]?.credentials)
    expect(seen[0]?.credentials.apiKey).toBe("sk-fast")
    expect(run.steps.map((step) => step.model)).toEqual(["gpt-4o-mini", "gpt-4o-mini"])
    expect(run.steps.map((step) => step.task)).toEqual(["fast", "fast"])
    expect(run.steps.map((step) => step.modelSource)).toEqual(["step", "step"])
    expect(scripted.requests.map((request) => request.model)).toEqual(["gpt-4o-mini", "gpt-4o-mini"])
  })

  it("does not collide distinct inherited model ids, and reuses an equal provider and model", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-shared",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    const scripted = scriptedProvider([{ content: "a" }, { content: "b" }, { content: "c" }])
    const credentials: LLMCredentials[] = []
    const d = deps(scripted)
    d.resolveLlm = async (layers, options) => {
      const resolved = await resolveRunLlm(layers, options)
      credentials.push(resolved.credentials)
      return withScriptedGenerate(resolved, scripted)
    }
    const wf = workflow({
      provider: "openai",
      model: "gpt-4.1",
      steps: [
        { id: "cheap", agent: "planner", model: "gpt-4o" },
        { id: "strong", agent: "builder", model: "gpt-4o-mini" },
        { id: "again", agent: "planner", model: "gpt-4o" },
      ],
    })
    const run = await executeRun(start(wf), wf, d, new AbortController().signal)
    expect(run.status).toBe("succeeded")
    expect(run.steps.map((step) => step.model)).toEqual(["gpt-4o", "gpt-4o-mini", "gpt-4o"])
    expect(run.steps.map((step) => step.provider)).toEqual(["openai", "openai", "openai"])
    expect(run.steps.map((step) => step.modelSource)).toEqual(["step", "step", "step"])
    expect(scripted.requests.map((request) => request.model)).toEqual(["gpt-4o", "gpt-4o-mini", "gpt-4o"])
    expect(credentials[0]).not.toBe(credentials[1])
    expect(credentials[0]?.apiKey).toBe("sk-shared")
    expect(credentials[1]?.apiKey).toBe("sk-shared")
    expect(credentials[2]).toBe(credentials[0])
  })

  it("lets the agent beat the workflow, and treats an alias as inherit", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/planner.md",
      "---\nname: planner\ndescription: Plans.\nmodel: claude-sonnet-4-20250514\nprovider: anthropic\n---\nYou plan.\n"
    )
    const scripted = scriptedProvider([{ content: "agent" }, { content: "alias" }])
    const d = deps(scripted)
    d.resolveLlm = async (layers) => {
      const selected = selectLayeredModel(layers, () => {
        throw new Error("no task")
      })
      const id = (selected?.provider ?? "openai") as ProviderId
      return {
        provider: { ...scripted, id, generate: (request, credentials) => scripted.generate(request, credentials) },
        credentials: { apiKey: "k" },
        secret: { apiKey: "k" },
        model: selected?.model ?? "assistant-default",
        source: selected?.source ?? "assistant",
      }
    }
    const agentWins = workflow({
      provider: "openai",
      model: "gpt-4o",
      steps: [{ id: "plan", agent: "planner" }],
    })
    const first = await executeRun(start(agentWins), agentWins, d, new AbortController().signal)
    expect(first.steps[0]).toMatchObject({
      model: "claude-sonnet-4-20250514",
      modelSource: "agent",
      provider: "anthropic",
    })

    await seedArtifact(
      env.workspace,
      ".cursor/agents/planner.md",
      "---\nname: planner\ndescription: Plans.\nmodel: sonnet\n---\nYou plan.\n"
    )
    const alias = workflow({
      provider: "openai",
      model: "gpt-4o",
      steps: [{ id: "plan", agent: "planner" }],
    })
    const second = await executeRun(
      newRun({ id: "run-2", workflow: alias, workspaceRoot: env.workspace, trigger: "manual", task: alias.task }),
      alias,
      d,
      new AbortController().signal
    )
    expect(second.steps[0]).toMatchObject({ model: "gpt-4o", modelSource: "workflow", provider: "openai" })
  })

  it("uses the first verified provider when every layer inherits", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-default",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    const scripted = scriptedProvider([{ content: "ok" }])
    const d = deps(scripted)
    d.resolveLlm = async (layers, options) => withScriptedGenerate(await resolveRunLlm(layers, options), scripted)
    const wf = workflow({ steps: [{ id: "plan", agent: "planner" }] })
    const run = await executeRun(start(wf), wf, d, new AbortController().signal)
    expect(run.steps[0]).toMatchObject({ model: "gpt-4o", provider: "openai", modelSource: "assistant" })
    expect(scripted.requests[0]?.model).toBe("gpt-4o")
  })

  it("uses the workflow model when the step and the agent inherit", async () => {
    const scripted = scriptedProvider([{ content: "ok" }])
    const d = deps(scripted)
    d.resolveLlm = async (layers) => {
      const selected = selectLayeredModel(layers, () => {
        throw new Error("no task")
      })
      return {
        provider: scripted,
        credentials: { apiKey: "k" },
        secret: { apiKey: "k" },
        model: selected?.model ?? "m",
        source: selected?.source ?? "assistant",
      }
    }
    const wf = workflow({ provider: "openai", model: "gpt-4o", steps: [{ id: "plan", agent: "planner" }] })
    const run = await executeRun(start(wf), wf, d, new AbortController().signal)
    expect(run.steps[0]).toMatchObject({ model: "gpt-4o", modelSource: "workflow", provider: "openai" })
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

  it("injects step files and run-time stepFiles overrides with absolutePath into step messages", async () => {
    const { saveWorkspaceFile } = await import("@/lib/files")
    await saveWorkspaceFile(env.workspace, {
      name: "default-form",
      originalName: "DefaultForm.pdf",
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.4 default"),
      description: "Default PDF form",
    })
    const overrideFile = await saveWorkspaceFile(env.workspace, {
      name: "override-form",
      originalName: "OverrideForm.pdf",
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.4 override"),
      description: "Override PDF form",
    })

    const provider = scriptedProvider([{ content: "uploaded default" }, { content: "uploaded override" }])
    const wf = workflow({
      steps: [
        { id: "plan", agent: "planner", files: ["default-form"] },
        { id: "build", agent: "builder", files: ["default-form"] },
      ],
    })
    const runInput = newRun({
      id: "run-files",
      workflow: wf,
      workspaceRoot: env.workspace,
      trigger: "manual",
      task: wf.task,
      stepFiles: { build: ["override-form"] },
    })
    const run = await executeRun(runInput, wf, deps(provider), new AbortController().signal)
    expect(run.status).toBe("succeeded")

    const firstPrompt = provider.requests[0]?.messages.at(-1)?.content ?? ""
    expect(firstPrompt).toContain("## Files for this step")
    expect(firstPrompt).toContain("DefaultForm.pdf")
    expect(firstPrompt).toContain("browser_file_upload")

    const secondPrompt = provider.requests[1]?.messages.at(-1)?.content ?? ""
    expect(secondPrompt).toContain(overrideFile.absolutePath)
    expect(secondPrompt).not.toContain("DefaultForm.pdf")
  })

  it("pauses a login step until the username and password are saved", async () => {
    const provider = scriptedProvider([{ content: "signed in" }, { content: "done" }])
    const wf = workflow({
      steps: [
        { id: "plan", agent: "planner", login: true },
        { id: "build", agent: "builder" },
      ],
    })
    const saved: WorkflowRun[] = []
    const pending = executeRun(start(wf), wf, deps(provider, { saved }), new AbortController().signal)
    await waitFor(() => saved.some((run) => run.status === "waiting_login"))
    const waiting = saved.find((run) => run.status === "waiting_login")
    expect(waiting?.pendingLogin).toMatchObject({
      stepId: "plan",
      usernameSecret: "browser.line.plan.username",
      passwordSecret: "browser.line.plan.password",
    })

    const { setBrowserSecrets } = await import("@/lib/secrets")
    const { resolveLogin } = await import("@/lib/workflows/login-wait")
    await setBrowserSecrets({
      "browser.line.plan.username": "ada",
      "browser.line.plan.password": "secret-pass",
    })
    expect(resolveLogin(waiting?.pendingLogin?.id ?? "", { action: "save" })).toBe(true)

    const run = await pending
    expect(run.status).toBe("succeeded")
    const prompt = provider.requests[0]?.messages.at(-1)?.content ?? ""
    expect(prompt).toContain("browser_fill_login")
    expect(prompt).toContain("browser.line.plan.username")
    expect(prompt).not.toContain("secret-pass")
  })
})
