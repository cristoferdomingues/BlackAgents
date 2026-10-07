import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GET as GET_RUN, DELETE as CANCEL_RUN } from "@/app/api/runs/[id]/route"
import { GET as RUN_EVENTS } from "@/app/api/runs/[id]/events/route"
import { DELETE, GET as GET_ONE, PUT } from "@/app/api/workflows/[name]/route"
import { GET as LIST_RUNS, POST as START_RUN } from "@/app/api/workflows/[name]/runs/route"
import { GET, POST } from "@/app/api/workflows/route"
import { setProviderSecret } from "@/lib/secrets"
import { parseSseFrames } from "@/lib/sse-client"
import { getRunner } from "@/lib/workflows/runner"
import { isTerminal, type WorkflowRun } from "@/lib/workflows/schema"

import { jsonRequest, makeTempEnv, seedArtifact, type TempEnv } from "../helpers/workspace"

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

    const listed = await json<{ workflows: Array<{ workflow: { name: string }; lastRun: null; active: boolean }> }>(await GET())
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
    expect((await json(await GET_ONE(new Request("http://t"), named("Bad Name")))).status).toBe(400)
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
