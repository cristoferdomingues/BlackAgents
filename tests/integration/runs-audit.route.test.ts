import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GET as AUDIT } from "@/app/api/runs/[id]/audit/route"
import { GET as RUN_EVENTS } from "@/app/api/runs/[id]/events/route"
import { appendAuditEvent } from "@/lib/workflows/audit"
import { parseSseFrames } from "@/lib/sse-client"
import { saveRun } from "@/lib/workflows/store"
import type { WorkflowRun } from "@/lib/workflows/schema"

import { makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv

const byId = (id: string) => ({ params: Promise.resolve({ id }) })

async function json<T>(
  res: Response
): Promise<{ status: number; body: { success: boolean; data?: T; error?: string } }> {
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: T; error?: string } }
}

function runningRun(id: string): WorkflowRun {
  return {
    id,
    workflow: "line",
    workspaceRoot: env.workspace,
    status: "running",
    trigger: "manual",
    task: "Ship it",
    createdAt: "2026-10-19T12:00:00.000Z",
    startedAt: "2026-10-19T12:00:01.000Z",
    steps: [
      {
        id: "plan",
        agent: "planner",
        status: "running",
        attempts: 1,
        toolExecutions: [],
        filesChanged: [],
      },
    ],
    pendingApproval: null,
  }
}

beforeEach(async () => {
  env = await makeTempEnv()
  process.env.BLACK_AGENTS_SSE_PING_MS = "40"
})

afterEach(async () => {
  delete process.env.BLACK_AGENTS_SSE_PING_MS
  await env.cleanup()
})

describe("GET /api/runs/[id]/audit", () => {
  it("returns 404 when the run is missing", async () => {
    const res = await json(await AUDIT(new Request("http://t/api/runs/nope/audit"), byId("nope")))
    expect(res.status).toBe(404)
  })

  it("lists events with filters and exports jsonl", async () => {
    await saveRun({ ...runningRun("run-1"), status: "succeeded", finishedAt: "2026-10-19T12:01:00.000Z" })
    await appendAuditEvent(env.workspace, "run-1", {
      type: "run_started",
      ts: "2026-10-19T12:00:00.000Z",
      workflow: "line",
      task: "Ship it",
    })
    await appendAuditEvent(env.workspace, "run-1", {
      type: "llm_response",
      ts: "2026-10-19T12:00:05.000Z",
      stepId: "plan",
      attempt: 1,
      turn: 0,
      model: "m",
      provider: "openai",
      content: "done",
      durationMs: 100,
    })
    await appendAuditEvent(env.workspace, "run-1", {
      type: "tool_call",
      ts: "2026-10-19T12:00:06.000Z",
      stepId: "plan",
      id: "c1",
      tool: "fs_read",
      server: "builtin",
      risk: "read",
      args: { path: "a.md" },
    })

    const all = await json<{ events: Array<{ type: string }> }>(
      await AUDIT(new Request("http://t/api/runs/run-1/audit"), byId("run-1"))
    )
    expect(all.status).toBe(200)
    expect(all.body.data?.events).toHaveLength(3)

    const ai = await json<{ events: Array<{ type: string }> }>(
      await AUDIT(new Request("http://t/api/runs/run-1/audit?group=ai"), byId("run-1"))
    )
    expect(ai.body.data?.events.map((e) => e.type)).toEqual(["llm_response"])

    const step = await json<{ events: Array<{ type: string }> }>(
      await AUDIT(new Request("http://t/api/runs/run-1/audit?stepId=plan"), byId("run-1"))
    )
    expect(step.body.data?.events).toHaveLength(2)

    const bad = await json(await AUDIT(new Request("http://t/api/runs/run-1/audit?group=nope"), byId("run-1")))
    expect(bad.status).toBe(400)

    const raw = await AUDIT(new Request("http://t/api/runs/run-1/audit?format=jsonl"), byId("run-1"))
    expect(raw.headers.get("content-type")).toContain("ndjson")
    const text = await raw.text()
    expect(text.split("\n").filter(Boolean)).toHaveLength(3)
  })
})

describe("GET /api/runs/[id]/events ping", () => {
  it("sends ping keep-alives while the run is open, then closes on terminal", async () => {
    await saveRun(runningRun("run-live"))
    const controller = new AbortController()
    const res = await RUN_EVENTS(new Request("http://t", { signal: controller.signal }), byId("run-live"))
    const reader = res.body?.getReader()
    expect(reader).toBeTruthy()
    const decoder = new TextDecoder()
    let buffer = ""
    const events: string[] = []
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline && !events.includes("ping")) {
      const { done, value } = await reader!.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = parseSseFrames(buffer)
      buffer = parsed.rest
      for (const e of parsed.events) events.push(e.event)
    }
    expect(events[0]).toBe("run")
    expect(events).toContain("ping")
    controller.abort()

    await saveRun({
      ...runningRun("run-live"),
      status: "succeeded",
      finishedAt: "2026-10-19T12:02:00.000Z",
      steps: [
        {
          id: "plan",
          agent: "planner",
          status: "succeeded",
          attempts: 1,
          toolExecutions: [],
          filesChanged: [],
        },
      ],
    })
    const closed = await RUN_EVENTS(new Request("http://t"), byId("run-live"))
    const frames = parseSseFrames(await closed.text())
    expect(frames.events.map((e) => e.event)).toEqual(["run"])
    expect(frames.events[0]?.data).toMatchObject({ status: "succeeded" })
  })
})
