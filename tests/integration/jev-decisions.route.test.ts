import { mkdir } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { DELETE, GET } from "@/app/api/settings/ai/jev-decisions/route"
import { appendDecision, decisionLogFile } from "@/lib/decision/log"

import { makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const base = { kind: "stepGate", score: 0.9, cutoff: 0.85, outcome: "acted", provider: "direct" } as const

describe("/api/settings/ai/jev-decisions", () => {
  it("lists nothing at first", async () => {
    const body = await (await GET()).json()
    expect(body).toEqual({ success: true, data: { entries: [], max: 200 } })
  })

  it("lists decisions newest first and clears them", async () => {
    await appendDecision({ ...base, at: "2026-10-21T10:00:00.000Z", choice: "continue" })
    await appendDecision({ ...base, at: "2026-10-21T10:01:00.000Z", choice: "stop" })
    const body = await (await GET()).json()
    expect(body.data.entries.map((e: { choice: string }) => e.choice)).toEqual(["stop", "continue"])

    const cleared = await DELETE()
    expect(cleared.status).toBe(200)
    expect((await cleared.json()).data.entries).toEqual([])
    expect((await (await GET()).json()).data.entries).toEqual([])
  })

  it("reports a failed clear", async () => {
    await mkdir(decisionLogFile(), { recursive: true })
    const res = await DELETE()
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect((await res.json()).success).toBe(false)
  })
})
