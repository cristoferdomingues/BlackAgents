import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { POST } from "@/app/api/artifacts/route"
import {
  DELETE,
  GET,
  PUT,
} from "@/app/api/artifacts/[type]/[name]/route"
import { makeTempEnv, jsonRequest, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const agent = {
  type: "agent",
  platform: "cursor",
  name: "demo-agent",
  description: "A demo agent.",
  body: "## Input\n- x\n",
  extra: {},
}

function ctx(type: string, name: string) {
  return { params: Promise.resolve({ type, name }) }
}

async function create(overrides: Record<string, unknown> = {}) {
  return POST(jsonRequest("http://t/api/artifacts", "POST", { ...agent, ...overrides }))
}

describe("GET /api/artifacts/[type]/[name]", () => {
  it("returns 404 for an unknown type", async () => {
    const res = await GET(new Request("http://t"), ctx("prompt", "x"))
    expect(res.status).toBe(404)
  })

  it("returns 404 when not found", async () => {
    const res = await GET(new Request("http://t"), ctx("agent", "missing"))
    expect(res.status).toBe(404)
  })

  it("returns the artifact when it exists", async () => {
    await create()
    const res = await GET(new Request("http://t"), ctx("agent", "demo-agent"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toMatchObject({ name: "demo-agent", description: "A demo agent." })
  })
})

describe("PUT /api/artifacts/[type]/[name]", () => {
  it("updates the description/body in place", async () => {
    await create()
    const res = await PUT(
      jsonRequest("http://t", "PUT", { ...agent, description: "Updated." }),
      ctx("agent", "demo-agent")
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.description).toBe("Updated.")
  })

  it("rejects changing the artifact type with 400", async () => {
    await create()
    const res = await PUT(
      jsonRequest("http://t", "PUT", { ...agent, type: "rule" }),
      ctx("agent", "demo-agent")
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("type cannot be changed")
  })

  it("renames by writing the new name and removing the old", async () => {
    await create()
    const res = await PUT(
      jsonRequest("http://t", "PUT", { ...agent, name: "renamed-agent" }),
      ctx("agent", "demo-agent")
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.name).toBe("renamed-agent")

    const old = await GET(new Request("http://t"), ctx("agent", "demo-agent"))
    expect(old.status).toBe(404)
  })

  it("returns 409 when renaming onto an existing name", async () => {
    await create()
    await create({ name: "other-agent" })
    const res = await PUT(
      jsonRequest("http://t", "PUT", { ...agent, name: "other-agent" }),
      ctx("agent", "demo-agent")
    )
    expect(res.status).toBe(409)
  })
})

describe("DELETE /api/artifacts/[type]/[name]", () => {
  it("deletes an existing artifact", async () => {
    await create()
    const res = await DELETE(new Request("http://t"), ctx("agent", "demo-agent"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual({ deleted: true })

    const after = await GET(new Request("http://t"), ctx("agent", "demo-agent"))
    expect(after.status).toBe(404)
  })

  it("returns 404 deleting something that doesn't exist", async () => {
    const res = await DELETE(new Request("http://t"), ctx("agent", "ghost"))
    expect(res.status).toBe(404)
  })
})
