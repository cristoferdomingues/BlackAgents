import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import { GET, POST, PUT, DELETE } from "@/app/api/workspace/route"
import { makeTempEnv, jsonRequest, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("GET /api/workspace", () => {
  it("returns the active workspace and saved list", async () => {
    const json = await (await GET()).json()
    expect(json.data.active.path).toBe(env.workspace)
    expect(json.data.workspaces.map((w: { path: string }) => w.path)).toContain(env.workspace)
  })
})

describe("POST /api/workspace", () => {
  it("adds a real directory to the saved list", async () => {
    const other = path.join(env.workspace, "..", "other-ws")
    await mkdir(other, { recursive: true })
    const res = await POST(jsonRequest("http://t", "POST", { path: other }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.workspaces.map((w: { path: string }) => w.path)).toContain(
      path.resolve(other)
    )
  })

  it("returns 404 for a non-existent path", async () => {
    const res = await POST(
      jsonRequest("http://t", "POST", { path: path.join(env.workspace, "ghost") })
    )
    expect(res.status).toBe(404)
  })

  it("rejects an empty path with 400", async () => {
    const res = await POST(jsonRequest("http://t", "POST", { path: "" }))
    expect(res.status).toBe(400)
  })
})

describe("PUT /api/workspace", () => {
  it("switches the active workspace", async () => {
    const other = path.join(env.workspace, "..", "switch-ws")
    await mkdir(other, { recursive: true })
    const res = await PUT(jsonRequest("http://t", "PUT", { path: other }))
    const json = await res.json()
    expect(json.data.active.path).toBe(path.resolve(other))
  })
})

describe("DELETE /api/workspace", () => {
  it("removes a workspace from the list", async () => {
    const res = await DELETE(jsonRequest("http://t", "DELETE", { path: env.workspace }))
    const json = await res.json()
    expect(json.data.workspaces.map((w: { path: string }) => w.path)).not.toContain(
      env.workspace
    )
  })
})
