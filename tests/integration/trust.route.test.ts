import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GET, PUT } from "@/app/api/trust/route"
import { readWorkspaceTrust } from "@/lib/runtime/trust"

import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("/api/trust", () => {
  it("returns an empty list before anything is trusted", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ shellCommands: [] })
  })

  it("trusts normalized programs and reads them back", async () => {
    const res = await PUT(
      jsonRequest("http://t/api/trust", "PUT", {
        shellCommands: ["MKDIR", "./cp"],
        trusted: true,
      })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ shellCommands: ["cp", "mkdir"] })
    await expect(readWorkspaceTrust(env.workspace)).resolves.toEqual({
      shellCommands: ["cp", "mkdir"],
    })
  })

  it("removes a grant and rejects unusable names", async () => {
    await PUT(
      jsonRequest("http://t/api/trust", "PUT", { shellCommands: ["mkdir"], trusted: true })
    )
    const removed = await PUT(
      jsonRequest("http://t/api/trust", "PUT", { shellCommands: ["mkdir"], trusted: false })
    )
    expect((await removed.json()).data).toEqual({ shellCommands: [] })

    const bad = await PUT(
      jsonRequest("http://t/api/trust", "PUT", { shellCommands: ["bad name"], trusted: true })
    )
    expect(bad.status).toBe(400)

    const empty = await PUT(
      jsonRequest("http://t/api/trust", "PUT", { shellCommands: [], trusted: true })
    )
    expect(empty.status).toBe(400)
  })
})
