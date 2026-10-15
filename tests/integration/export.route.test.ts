import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GET, POST } from "@/app/api/export/route"
import { writeConcept } from "@/lib/knowledge/store"
import { makeTempEnv, jsonRequest, seedArtifact, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

function preview(platform: string): Promise<Response> {
  return GET(new Request(`http://t/api/export?platform=${platform}`))
}

function call(body: unknown): Promise<Response> {
  return POST(jsonRequest("http://t/api/export", "POST", body))
}

async function seedRevenue(): Promise<string> {
  await writeConcept(env.workspace, {
    id: "metrics/revenue",
    frontmatter: {
      type: "Metric",
      title: "Revenue",
      description: "Recognized revenue.",
      extra: {},
    },
    body: "Revenue.\n",
  })
  return readFile(path.join(env.workspace, ".black-agents/knowledge/metrics/revenue.md"), "utf8")
}

describe("OKF export", () => {
  it("previews the bundle and writes nothing", async () => {
    const before = await seedRevenue()
    const res = await preview("okf")
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.files.map((file: { path: string }) => file.path)).toEqual([
      "okf/index.md",
      "okf/log.md",
      "okf/metrics/index.md",
      "okf/metrics/revenue.md",
    ])
    expect(json.data.files.find((file: { path: string }) => file.path.endsWith("revenue.md")).content).toContain(
      "type: Metric"
    )
    await expect(readFile(path.join(env.workspace, "okf/index.md"), "utf8")).rejects.toThrow()
    expect(await readFile(path.join(env.workspace, ".black-agents/knowledge/metrics/revenue.md"), "utf8")).toBe(before)
  })

  it("dry-run reports create, write applies it, and a second write is unchanged", async () => {
    await seedRevenue()
    const dry = await call({ platform: "okf", mode: "dry-run" })
    const dryJson = await dry.json()
    expect(dryJson.data.summary).toMatchObject({ create: 4, overwrite: 0, unchanged: 0, written: 0 })
    expect(dryJson.data.files.every((file: { applied: boolean }) => file.applied === false)).toBe(true)
    await expect(readFile(path.join(env.workspace, "okf/index.md"), "utf8")).rejects.toThrow()

    const wrote = await call({ platform: "okf", mode: "write" })
    const wroteJson = await wrote.json()
    expect(wroteJson.data.summary.written).toBe(4)
    const index = await readFile(path.join(env.workspace, "okf/index.md"), "utf8")
    expect(index).toContain('okf_version: "0.2"')
    expect(await readFile(path.join(env.workspace, "okf/metrics/revenue.md"), "utf8")).toContain("Revenue.")

    const again = await call({ platform: "okf", mode: "write" })
    expect((await again.json()).data.summary).toMatchObject({ create: 0, overwrite: 0, unchanged: 4, written: 0 })
  })

  it("leaves a changed file alone when overwrite is off, and can write into another folder", async () => {
    await seedRevenue()
    await call({ platform: "okf", mode: "write" })
    const indexPath = path.join(env.workspace, "okf/index.md")
    await writeFile(indexPath, "hand edit\n", "utf8")

    const held = await call({ platform: "okf", mode: "write", overwrite: false })
    const heldJson = await held.json()
    expect(heldJson.data.files.find((file: { path: string }) => file.path === "okf/index.md")).toMatchObject({
      status: "overwrite",
      applied: false,
    })
    expect(await readFile(indexPath, "utf8")).toBe("hand edit\n")

    const other = path.join(env.workspace, "other-repo")
    await mkdir(other)
    const moved = await call({ platform: "okf", mode: "write", targetPath: other })
    expect((await moved.json()).data.summary.create).toBe(4)
    expect(await readFile(path.join(other, "okf/index.md"), "utf8")).toContain('okf_version: "0.2"')
    expect(await readFile(indexPath, "utf8")).toBe("hand edit\n")
  })

  it("rejects a missing target, a file target, and an unknown platform", async () => {
    expect((await call({ platform: "okf", targetPath: path.join(env.workspace, "missing") })).status).toBe(404)
    await seedArtifact(env.workspace, "notes.txt", "hello")
    expect((await call({ platform: "okf", targetPath: path.join(env.workspace, "notes.txt") })).status).toBe(400)
    expect((await preview("nope")).status).toBe(400)
    const cursor = await call({ platform: "cursor", mode: "dry-run" })
    expect((await cursor.json()).data.summary.total).toBe(0)
  })
})
