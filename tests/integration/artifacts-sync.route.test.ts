import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GET as getTargets, PUT as putTargets } from "@/app/api/artifacts/targets/route"
import { POST as sync } from "@/app/api/artifacts/sync/route"
import { GET as drift } from "@/app/api/drift/route"
import { makeTempEnv, jsonRequest, seedArtifact, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const SOURCE_AGENT = "---\nname: a\ndescription: A.\n---\nA body.\n"

describe("/api/artifacts/targets", () => {
  it("returns the default targets", async () => {
    const json = await (await getTargets()).json()
    expect(json.data).toEqual({ targets: ["cursor"], saved: false })
  })

  it("saves targets and exports the source to them", async () => {
    await seedArtifact(env.workspace, ".black-agents/artifacts/agents/a.md", SOURCE_AGENT)
    const res = await putTargets(jsonRequest("http://t/api/artifacts/targets", "PUT", { targets: ["claude"] }))
    const json = await res.json()
    expect(json.data).toEqual({ targets: ["claude"], saved: true, written: [".claude/agents/a.md"] })
    expect(await readFile(path.join(env.workspace, ".claude/agents/a.md"), "utf8")).toContain("A body.")
  })

  it("rejects an unknown platform", async () => {
    const res = await putTargets(jsonRequest("http://t/api/artifacts/targets", "PUT", { targets: ["vim"] }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/artifacts/sync", () => {
  it("exports the source", async () => {
    await seedArtifact(env.workspace, ".black-agents/artifacts/agents/a.md", SOURCE_AGENT)
    const json = await (await sync(jsonRequest("http://t/api/artifacts/sync", "POST", { action: "export" }))).json()
    expect(json.data.written).toEqual([".cursor/agents/a.md"])
  })

  it("imports IDE-only artifacts and the drift report shows none left", async () => {
    await seedArtifact(env.workspace, ".cursor/rules/style.mdc", "---\ndescription: Style.\nalwaysApply: true\n---\nBe nice.\n")
    const json = await (await sync(jsonRequest("http://t/api/artifacts/sync", "POST", { action: "import" }))).json()
    expect(json.data.imported).toEqual(["rule:style"])

    const report = (await (await drift()).json()).data
    expect(report).toMatchObject({ sourceCount: 1, ideOnly: [] })
    expect(report.platforms[0]).toMatchObject({ platform: "cursor", target: true, summary: { "in-sync": 1 } })
  })

  it("returns 404 for a missing IDE copy", async () => {
    const res = await sync(
      jsonRequest("http://t/api/artifacts/sync", "POST", {
        action: "import",
        only: { platform: "cursor", type: "agent", name: "ghost" },
      })
    )
    expect(res.status).toBe(404)
  })

  it("rejects an unknown action", async () => {
    const res = await sync(jsonRequest("http://t/api/artifacts/sync", "POST", { action: "wipe" }))
    expect(res.status).toBe(400)
  })
})
