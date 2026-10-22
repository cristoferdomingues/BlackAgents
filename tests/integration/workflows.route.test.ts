import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GET as GET_RUN, DELETE as CANCEL_RUN } from "@/app/api/runs/[id]/route"
import { GET as RUN_EVENTS } from "@/app/api/runs/[id]/events/route"
import { DELETE, GET as GET_ONE, PUT } from "@/app/api/workflows/[name]/route"
import { GET as LIST_RUNS, POST as START_RUN } from "@/app/api/workflows/[name]/runs/route"
import { GET, POST } from "@/app/api/workflows/route"
import { setProviderSecret } from "@/lib/secrets"
import { updateAiSettings } from "@/lib/settings"
import { parseSseFrames } from "@/lib/sse-client"
import { getRunner } from "@/lib/workflows/runner"
import { isTerminal, type WorkflowRun } from "@/lib/workflows/schema"

import { jsonRequest, makeTempEnv, seedArtifact, seedProject, type TempEnv } from "../helpers/workspace"

let env: TempEnv

const body = {
  name: "review-line",
  description: "Plan then build",
  task: "Ship the feature",
  steps: [{ id: "plan", agent: "planner" }],
}

const named = (name: string) => ({ params: Promise.resolve({ name }) })
const byId = (id: string) => ({ params: Promise.resolve({ id }) })

async function json<T>(res: Response): Promise<{ status: number; body: { success: boolean; data?: T; error?: string } }> {
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: T; error?: string } }
}

function untilTerminal(id: string): Promise<WorkflowRun> {
  return new Promise((resolve) => {
    const off = getRunner().subscribe((run) => {
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
  vi.unstubAllGlobals()
  await env.cleanup()
})

describe("workflow routes", () => {
  it("creates, lists, reads, updates and deletes a workflow", async () => {
    const created = await json(await POST(jsonRequest("http://t/api/workflows", "POST", body)))
    expect(created.status).toBe(201)
    expect((await json(await POST(jsonRequest("http://t/api/workflows", "POST", body)))).status).toBe(409)

    const listed = await json<{ workflows: Array<{ workflow: { name: string }; lastRun: null; active: boolean }> }>(
      await GET(new Request("http://t/api/workflows"))
    )
    expect(listed.body.data?.workflows).toEqual([expect.objectContaining({ lastRun: null, active: false })])

    const one = await json<{ workflow: { steps: unknown[] } }>(await GET_ONE(new Request("http://t"), named("review-line")))
    expect(one.body.data?.workflow.steps).toHaveLength(1)

    const updated = await json(
      await PUT(jsonRequest("http://t", "PUT", { ...body, description: "New" }), named("review-line"))
    )
    expect(updated.status).toBe(200)
    expect((await json(await PUT(jsonRequest("http://t", "PUT", { ...body, name: "other" }), named("review-line")))).status).toBe(400)

    expect((await json(await DELETE(new Request("http://t"), named("review-line")))).status).toBe(200)
    expect((await json(await GET_ONE(new Request("http://t"), named("review-line")))).status).toBe(404)
  })

  it("rejects invalid bodies and unknown agents", async () => {
    const bad = await json(await POST(jsonRequest("http://t/api/workflows", "POST", { name: "x", steps: [] })))
    expect(bad.status).toBe(400)
    expect(bad.body.error).toContain("steps")
    const ghost = await json(
      await POST(jsonRequest("http://t/api/workflows", "POST", { ...body, steps: [{ id: "a", agent: "ghost" }] }))
    )
    expect(ghost.status).toBe(400)
    expect(ghost.body.error).toContain("ghost")
    const missingFile = await json(
      await POST(
        jsonRequest("http://t/api/workflows", "POST", {
          ...body,
          steps: [{ id: "plan", agent: "planner", files: ["nonexistent-file"] }],
        })
      )
    )
    expect(missingFile.status).toBe(400)
    expect(missingFile.body.error).toContain("@file:nonexistent-file")
    expect((await json(await GET_ONE(new Request("http://t"), named("Bad Name")))).status).toBe(400)
  })

  it("saves a step model and refuses to start when that provider is not verified", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    await POST(jsonRequest("http://t/api/workflows", "POST", body))
    const saved = await json<{ workflow: { steps: Array<{ model?: string; provider?: string }> } }>(
      await PUT(
        jsonRequest("http://t/api/workflows/review-line", "PUT", {
          ...body,
          steps: [{ id: "plan", agent: "planner", model: "claude-sonnet-4-20250514", provider: "anthropic" }],
        }),
        named("review-line")
      )
    )
    expect(saved.status).toBe(200)
    expect(saved.body.data?.workflow.steps[0]).toMatchObject({
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
    })
    const started = await json(await START_RUN(jsonRequest("http://t", "POST", {}), named("review-line")))
    expect(started.status).toBe(412)
    expect(started.body.error).toBe(
      'Step "plan" uses Anthropic, which is not verified. Verify it under AI Providers.'
    )
  })

  it("loads a workflow saved before step models and fails fast for an agent provider", async () => {
    await mkdir(path.join(env.workspace, ".black-agents/workflows"), { recursive: true })
    await writeFile(
      path.join(env.workspace, ".black-agents/workflows/legacy-line.workflow.json"),
      JSON.stringify({ name: "legacy-line", steps: [{ id: "plan", agent: "planner" }] }),
      "utf8"
    )
    const loaded = await json<{ workflow: { steps: Array<{ model?: string; provider?: string }> } }>(
      await GET_ONE(new Request("http://t"), named("legacy-line"))
    )
    expect(loaded.status).toBe(200)
    expect(loaded.body.data?.workflow.steps[0]?.model).toBeUndefined()
    expect(loaded.body.data?.workflow.steps[0]?.provider).toBeUndefined()

    await seedArtifact(
      env.workspace,
      ".cursor/agents/planner.md",
      "---\nname: planner\ndescription: Plans.\nmodel: claude-sonnet-4-20250514\nprovider: anthropic\n---\nYou plan.\n"
    )
    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    const started = await json(await START_RUN(jsonRequest("http://t", "POST", {}), named("legacy-line")))
    expect(started.status).toBe(412)
    expect(started.body.success).toBe(false)
    expect(started.body.error).toBe(
      'Step "plan" uses Anthropic, which is not verified. Verify it under AI Providers.'
    )
  })

  it("rejects a bad step model on save and refuses an unset task kind at run start", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    await POST(jsonRequest("http://t/api/workflows", "POST", body))
    const rejected = await json(
      await PUT(
        jsonRequest("http://t/api/workflows/review-line", "PUT", {
          ...body,
          steps: [{ id: "plan", agent: "planner", model: "task:nope" }],
        }),
        named("review-line")
      )
    )
    expect(rejected.status).toBe(400)
    expect(rejected.body.error).toContain('Step "plan": Unknown model task "nope"')

    const saved = await json(
      await PUT(
        jsonRequest("http://t/api/workflows/review-line", "PUT", {
          ...body,
          steps: [{ id: "plan", agent: "planner", model: "task:fast" }],
        }),
        named("review-line")
      )
    )
    expect(saved.status).toBe(200)
    const started = await json(await START_RUN(jsonRequest("http://t", "POST", {}), named("review-line")))
    expect(started.status).toBe(412)
    expect(started.body.error).toBe("Set the Fast model in Settings → Models")

    await updateAiSettings({ models: { fast: { provider: "openai", model: "gpt-4o-mini" } } })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "fast plan" } }] }),
      }))
    )
    const ready = await json<{ run: WorkflowRun }>(
      await START_RUN(jsonRequest("http://t", "POST", {}), named("review-line"))
    )
    expect(ready.status).toBe(201)
    const done = await untilTerminal(ready.body.data?.run.id ?? "")
    expect(done.status).toBe("succeeded")
    expect(done.steps[0]).toMatchObject({ model: "gpt-4o-mini", provider: "openai", modelSource: "step", task: "fast" })
  })

  it("refuses to start a run without a verified provider", async () => {
    await POST(jsonRequest("http://t/api/workflows", "POST", body))
    const res = await json(await START_RUN(jsonRequest("http://t", "POST", {}), named("review-line")))
    expect(res.status).toBe(412)
    expect((await json(await START_RUN(jsonRequest("http://t", "POST", {}), named("missing")))).status).toBe(404)
  })

  it("starts a run, streams its updates and lists it", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "The plan is ready" } }] }),
      }))
    )
    await POST(jsonRequest("http://t/api/workflows", "POST", body))
    const started = await json<{ run: WorkflowRun }>(
      await START_RUN(jsonRequest("http://t", "POST", { task: "Plan the launch" }), named("review-line"))
    )
    expect(started.status).toBe(201)
    const id = started.body.data?.run.id ?? ""
    const done = await untilTerminal(id)
    expect(done.status).toBe("succeeded")
    expect(done.report).toBe("The plan is ready")

    const fetched = await json<{ run: WorkflowRun }>(await GET_RUN(new Request("http://t"), byId(id)))
    expect(fetched.body.data?.run.task).toBe("Plan the launch")

    const stream = await RUN_EVENTS(new Request("http://t"), byId(id))
    const frames = parseSseFrames(await stream.text())
    expect(frames.events.map((e) => e.event)).toEqual(["run"])

    const runs = await json<{ runs: Array<{ id: string }> }>(await LIST_RUNS(new Request("http://t"), named("review-line")))
    expect(runs.body.data?.runs.map((r) => r.id)).toEqual([id])

    expect((await json(await CANCEL_RUN(new Request("http://t"), byId(id)))).status).toBe(409)
    expect((await json(await GET_RUN(new Request("http://t"), byId("nope")))).status).toBe(404)
  })
})

describe("workflow routes with ?scope=<project>", () => {
  const drillBody = {
    name: "drill",
    task: "Run the drill",
    steps: [{ id: "drill", agent: "cca-f-study-coach" }],
  }

  beforeEach(async () => {
    await seedProject(env.workspace, "claude-certification", { inherits: [] })
    await seedArtifact(
      env.workspace,
      ".black-agents/projects/claude-certification/artifacts/agents/cca-f-study-coach.md",
      "---\nname: cca-f-study-coach\ndescription: Coaches.\n---\nYou coach.\n"
    )
  })

  it("does not find a project-only agent without a scope", async () => {
    const res = await json(await POST(jsonRequest("http://t/api/workflows", "POST", drillBody)))
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('agent "cca-f-study-coach" was not found')
  })

  it("saves, lists, reads and runs a workflow that uses a project-only agent", async () => {
    const created = await json(
      await POST(jsonRequest("http://t/api/workflows?scope=claude-certification", "POST", drillBody))
    )
    expect(created.status).toBe(201)

    // Not visible from the whole workspace (the project did not inherit workflows).
    const unscopedList = await json<{ workflows: unknown[] }>(await GET(new Request("http://t/api/workflows")))
    expect(unscopedList.body.data?.workflows).toEqual([])

    const scopedList = await json<{ workflows: Array<{ workflow: { name: string } }> }>(
      await GET(new Request("http://t/api/workflows?scope=claude-certification"))
    )
    expect(scopedList.body.data?.workflows.map((w) => w.workflow.name)).toEqual(["drill"])

    const read = await json<{ workflow: { steps: Array<{ agent: string }> } }>(
      await GET_ONE(new Request("http://t?scope=claude-certification"), named("drill"))
    )
    expect(read.status).toBe(200)
    expect(read.body.data?.workflow.steps[0]?.agent).toBe("cca-f-study-coach")

    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    await updateAiSettings({ models: { fast: { provider: "openai", model: "gpt-4o-mini" } } })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "Drill complete" } }] }),
      }))
    )
    const started = await json<{ run: WorkflowRun }>(
      await START_RUN(jsonRequest("http://t?scope=claude-certification", "POST", {}), named("drill"))
    )
    expect(started.status).toBe(201)
    const done = await untilTerminal(started.body.data?.run.id ?? "")
    expect(done.status).toBe("succeeded")
    expect(done.report).toBe("Drill complete")

    const runs = await json<{ runs: Array<{ id: string }> }>(
      await LIST_RUNS(new Request("http://t?scope=claude-certification"), named("drill"))
    )
    expect(runs.body.data?.runs.map((r) => r.id)).toEqual([done.id])
  })

  it("refuses to mutate an inherited workspace workflow from a project", async () => {
    await seedProject(env.workspace, "claude-certification", { inherits: ["workflows"] })
    await POST(jsonRequest("http://t/api/workflows", "POST", body))

    const put = await json(
      await PUT(
        jsonRequest("http://t?scope=claude-certification", "PUT", { ...body, description: "Changed" }),
        named("review-line")
      )
    )
    expect(put.status).toBe(403)

    const del = await json(
      await DELETE(new Request("http://t?scope=claude-certification"), named("review-line"))
    )
    expect(del.status).toBe(403)
  })

  it("rejects an unknown or invalid project scope", async () => {
    expect((await json(await GET(new Request("http://t/api/workflows?scope=ghost")))).status).toBe(404)
    expect((await json(await GET(new Request("http://t/api/workflows?scope=..%2F..")))).status).toBe(400)
  })
})
