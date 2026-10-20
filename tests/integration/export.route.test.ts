import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GET, POST } from "@/app/api/export/route"
import { writeConcept } from "@/lib/knowledge/store"
import { makeTempEnv, jsonRequest, seedArtifact, seedProject, type TempEnv } from "../helpers/workspace"

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

function call(body: unknown, query = ""): Promise<Response> {
  return POST(jsonRequest(`http://t/api/export${query}`, "POST", body))
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

describe("project export", () => {
  beforeEach(async () => {
    await seedProject(env.workspace, "study", { name: "Study", inherits: ["rules", "knowledge"] })
    await seedArtifact(
      env.workspace,
      ".black-agents/projects/study/artifacts/agents/study-coach.md",
      "---\nname: study-coach\ndescription: Quizzes the user.\n---\nAsk exam questions.\n"
    )
    await seedArtifact(
      env.workspace,
      ".black-agents/artifacts/rules/house-style.md",
      "---\ndescription: House style.\nalwaysApply: true\n---\nShort sentences.\n"
    )
    await seedArtifact(
      env.workspace,
      ".black-agents/artifacts/agents/workspace-only.md",
      "---\nname: workspace-only\ndescription: Not inherited.\n---\nBody.\n"
    )
  })

  it("previews the project's items plus what it inherits, all new until a folder is picked", async () => {
    const res = await call({ platform: "claude", mode: "dry-run" }, "?scope=study")
    expect(res.status).toBe(200)
    const json = await res.json()
    const paths = json.data.files.map((file: { path: string }) => file.path)
    expect(paths).toContain(".claude/agents/study-coach.md")
    expect(paths.some((p: string) => p.includes("house-style"))).toBe(true)
    expect(paths.some((p: string) => p.includes("workspace-only"))).toBe(false)
    expect(json.data.target).toBeNull()
    expect(json.data.summary).toMatchObject({ overwrite: 0, unchanged: 0, written: 0 })
    expect(json.data.summary.create).toBe(paths.length)
  })

  it("will not write a project into the workspace folder", async () => {
    const none = await call({ platform: "claude", mode: "write" }, "?scope=study")
    expect(none.status).toBe(400)
    expect((await none.json()).error).toContain('Pick a folder to export project "study" into')

    const same = await call({ platform: "claude", mode: "write", targetPath: env.workspace }, "?scope=study")
    expect(same.status).toBe(400)
    expect((await same.json()).error).toContain("cannot be exported into the workspace folder")
    await expect(readFile(path.join(env.workspace, ".claude/agents/study-coach.md"), "utf8")).rejects.toThrow()
  })

  it("writes the project into its own folder without leaking the scope", async () => {
    const other = path.join(env.workspace, "study-repo")
    await mkdir(other)
    const res = await call({ platform: "claude", mode: "write", targetPath: other }, "?scope=study")
    expect(res.status).toBe(200)
    expect((await res.json()).data.target).toBe(other)
    const agent = await readFile(path.join(other, ".claude/agents/study-coach.md"), "utf8")
    expect(agent).toContain("Ask exam questions.")
    expect(agent).not.toContain("scope")
    await expect(readFile(path.join(env.workspace, ".claude/agents/study-coach.md"), "utf8")).rejects.toThrow()
  })

  it("exports inherited knowledge as OKF and the zip preview is scoped", async () => {
    await seedRevenue()
    const okf = await GET(new Request("http://t/api/export?platform=okf&scope=study"))
    expect((await okf.json()).data.files.map((f: { path: string }) => f.path)).toContain("okf/metrics/revenue.md")

    const claude = await GET(new Request("http://t/api/export?platform=claude&scope=study"))
    const paths = (await claude.json()).data.files.map((f: { path: string }) => f.path)
    expect(paths).toContain(".claude/agents/study-coach.md")
    expect(paths.some((p: string) => p.includes("workspace-only"))).toBe(false)
  })

  it("rejects a project that does not load", async () => {
    expect((await call({ platform: "claude" }, "?scope=nope")).status).toBe(404)
    expect((await GET(new Request("http://t/api/export?platform=claude&scope=nope"))).status).toBe(404)
  })
})
