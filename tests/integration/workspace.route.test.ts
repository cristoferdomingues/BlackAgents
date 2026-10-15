import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"

import { GET, POST, PUT, DELETE } from "@/app/api/workspace/route"
import { driftReport } from "@/lib/artifacts/drift"
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

  it("creates a new workspace directory with template and sets it active", async () => {
    const freshPath = path.join(env.workspace, "..", "crypto-fresh-ws")
    const res = await POST(
      jsonRequest("http://t", "POST", {
        path: freshPath,
        create: true,
        template: "crypto",
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.active.path).toBe(path.resolve(freshPath))
    expect(json.data.workspaces.map((w: { path: string }) => w.path)).toContain(
      path.resolve(freshPath)
    )
  })

  it("seeds template artifacts in BlackAgents first, then exports them to Cursor", async () => {
    const freshPath = path.join(env.workspace, "..", "software-fresh-ws")
    const res = await POST(
      jsonRequest("http://t", "POST", { path: freshPath, create: true, template: "software" })
    )
    expect(res.status).toBe(201)
    const source = await readFile(
      path.join(freshPath, ".black-agents/artifacts/agents/feature-developer.md"),
      "utf8"
    )
    expect(source).toContain("name: feature-developer")
    const exported = await readFile(path.join(freshPath, ".cursor/agents/feature-developer.md"), "utf8")
    expect(exported).toContain("name: feature-developer")
    expect(
      await readFile(path.join(freshPath, ".cursor/rules/typescript-strict.mdc"), "utf8")
    ).toContain("description:")
    const report = await driftReport(freshPath)
    expect(report.ideOnly).toEqual([])
    expect(report.platforms[0].summary.drifted).toBe(0)
  })

  it("returns 404 for a non-existent path when create is not specified", async () => {
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
