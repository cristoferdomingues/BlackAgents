import { readdir } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { POST } from "@/app/api/artifacts/preview/route"
import { jsonRequest, makeTempEnv, seedArtifact, type TempEnv } from "../helpers/workspace"

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
  name: "reviewer",
  description: "Reviews code.",
  body: "You review.\n",
  extra: { tools: ["fs_list", "fs_read"], parallel: true },
}

function preview(body: unknown): Request {
  return jsonRequest("http://t/api/artifacts/preview", "POST", body)
}

describe("POST /api/artifacts/preview", () => {
  it("returns the file a new artifact would create, without writing it", async () => {
    const res = await POST(preview({ input: agent }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.relPath).toBe(".cursor/agents/reviewer.md")
    expect(json.data.content).toBe(
      "---\nname: reviewer\ndescription: Reviews code.\nparallel: true\ntools:\n  - fs_list\n  - fs_read\n---\n\nYou review.\n"
    )
    const entries = await readdir(path.join(env.workspace, ".cursor")).catch(() => [])
    expect(entries).not.toContain("agents")
  })

  it("keeps extra frontmatter of the saved artifact when editing", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/reviewer.md",
      "---\nname: reviewer\ndescription: Old.\ncolor: purple\n---\nOld body.\n"
    )
    const res = await POST(preview({ input: { ...agent, description: "New." }, originalName: "reviewer" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.content).toContain("description: New.")
    expect(json.data.content).toContain("color: purple")
  })

  it("returns 404 when the original artifact is missing", async () => {
    const res = await POST(preview({ input: agent, originalName: "ghost" }))
    expect(res.status).toBe(404)
  })

  it("explains why an incomplete form has no preview", async () => {
    const res = await POST(preview({ input: { ...agent, description: "" } }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toMatchObject({ success: false, error: "Description is required" })
  })

  it("rejects a malformed body", async () => {
    const res = await POST(new Request("http://t/api/artifacts/preview", { method: "POST", body: "{" }))
    expect(res.status).toBe(400)
  })
})
