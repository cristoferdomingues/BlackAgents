import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { GET, POST } from "@/app/api/artifacts/route"
import { makeTempEnv, jsonRequest, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const validAgent = {
  type: "agent",
  platform: "cursor",
  name: "demo-agent",
  description: "A demo agent.",
  body: "## Input\n- x\n",
  extra: {},
}

describe("GET /api/artifacts", () => {
  it("returns an empty list for a fresh workspace", async () => {
    const res = await GET()
    const json = await res.json()
    expect(json).toEqual({ success: true, data: [] })
  })

  it("lists created artifacts", async () => {
    await POST(jsonRequest("http://t/api/artifacts", "POST", validAgent))
    const res = await GET()
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0]).toMatchObject({ type: "agent", name: "demo-agent" })
  })
})

describe("POST /api/artifacts", () => {
  it("creates an artifact and returns 201", async () => {
    const res = await POST(jsonRequest("http://t/api/artifacts", "POST", validAgent))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toMatchObject({ type: "agent", name: "demo-agent" })
  })

  it("rejects an invalid (non-kebab) name with 400", async () => {
    const res = await POST(
      jsonRequest("http://t/api/artifacts", "POST", { ...validAgent, name: "Bad Name" })
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it("rejects a missing description with 400", async () => {
    const res = await POST(
      jsonRequest("http://t/api/artifacts", "POST", { ...validAgent, description: "" })
    )
    expect(res.status).toBe(400)
  })

  it("returns 409 when the artifact already exists", async () => {
    await POST(jsonRequest("http://t/api/artifacts", "POST", validAgent))
    const res = await POST(jsonRequest("http://t/api/artifacts", "POST", validAgent))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toContain("already exists")
  })

  it("returns 400 on a non-JSON body", async () => {
    const res = await POST(
      new Request("http://t/api/artifacts", { method: "POST", body: "not json" })
    )
    expect(res.status).toBe(400)
  })
})
