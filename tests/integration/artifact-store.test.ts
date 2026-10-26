import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { driftReport } from "@/lib/artifacts/drift"
import { scanWorkspace } from "@/lib/artifacts/parser"
import type { ArtifactInput } from "@/lib/artifacts/schemas"
import {
  ArtifactStoreError,
  createArtifact,
  deleteArtifact,
  exportAll,
  importArtifacts,
  readExportTargets,
  updateArtifact,
  writeExportTargets,
} from "@/lib/artifacts/store"
import { makeTempEnv, seedArtifact, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

function read(rel: string): Promise<string> {
  return readFile(path.join(env.workspace, rel), "utf8")
}

async function exists(rel: string): Promise<boolean> {
  return readFile(path.join(env.workspace, rel)).then(
    () => true,
    () => false
  )
}

const agent: ArtifactInput = {
  type: "agent",
  platform: "cursor",
  name: "reviewer",
  description: "Reviews code.",
  body: "You review.",
  extra: { tools: ["fs_read"], provider: "openai", model: "gpt-4o" },
}

describe("export targets", () => {
  it("defaults to Cursor in an empty workspace", async () => {
    expect(await readExportTargets(env.workspace)).toEqual({ targets: ["cursor"], saved: false })
  })

  it("defaults to the IDE folders that exist", async () => {
    await mkdir(path.join(env.workspace, ".claude"))
    expect((await readExportTargets(env.workspace)).targets).toEqual(["claude"])
  })

  it("detects an existing OpenCode project as an export target", async () => {
    await mkdir(path.join(env.workspace, ".opencode"))
    expect((await readExportTargets(env.workspace)).targets).toEqual(["opencode"])
  })

  it("detects existing Windsurf and Antigravity folders as export targets", async () => {
    await mkdir(path.join(env.workspace, ".windsurf"))
    await mkdir(path.join(env.workspace, ".agents"))
    expect((await readExportTargets(env.workspace)).targets).toEqual(["windsurf", "antigravity"])
  })

  it("saves the targets in order and without duplicates", async () => {
    await writeExportTargets(env.workspace, ["windsurf", "cursor", "cursor"])
    expect(await readExportTargets(env.workspace)).toEqual({ targets: ["cursor", "windsurf"], saved: true })
    expect(JSON.parse(await read(".black-agents/export.json"))).toEqual({ targets: ["cursor", "windsurf"] })
  })

  it("falls back to the defaults when the file is broken", async () => {
    await seedArtifact(env.workspace, ".black-agents/export.json", "{oops")
    expect(await readExportTargets(env.workspace)).toEqual({ targets: ["cursor"], saved: false })
  })
})

describe("createArtifact", () => {
  it("writes the source copy and exports it to the IDE target", async () => {
    const saved = await createArtifact(env.workspace, agent)
    expect(saved).toMatchObject({ managed: true, relativePath: ".black-agents/artifacts/agents/reviewer.md" })

    const source = await read(".black-agents/artifacts/agents/reviewer.md")
    expect(source).toContain("provider: openai")
    expect(source).toContain("- fs_read")

    const cursor = await read(".cursor/agents/reviewer.md")
    expect(cursor).toContain("model: gpt-4o")
    expect(cursor).not.toContain("provider")
    expect(cursor).not.toContain("fs_read")
  })

  it("creates a command when no commands folder exists yet", async () => {
    await createArtifact(env.workspace, {
      ...agent,
      type: "command",
      name: "ship-it",
      extra: {},
    })
    expect(await exists(".black-agents/artifacts/commands/ship-it.md")).toBe(true)
    expect(await exists(".cursor/commands/ship-it.md")).toBe(true)
  })

  it("exports to every chosen target with each IDE's rule format", async () => {
    await writeExportTargets(env.workspace, ["cursor", "windsurf"])
    await createArtifact(env.workspace, {
      ...agent,
      type: "rule",
      name: "style",
      extra: { alwaysApply: true },
    })
    expect(await read(".cursor/rules/style.mdc")).toContain("alwaysApply: true")
    expect(await read(".windsurf/rules/style.md")).toContain("trigger: always_on")
  })

  it("refuses a name that already exists in an IDE folder", async () => {
    await seedArtifact(env.workspace, ".cursor/agents/reviewer.md", "---\nname: reviewer\ndescription: x\n---\nbody\n")
    await expect(createArtifact(env.workspace, agent)).rejects.toMatchObject({ status: 409 })
  })
})

describe("updateArtifact", () => {
  it("moves an IDE-only skill into the source, supporting files included", async () => {
    await seedArtifact(env.workspace, ".cursor/skills/pdf/SKILL.md", "---\nname: pdf\ndescription: PDFs.\n---\nOld.\n")
    await seedArtifact(env.workspace, ".cursor/skills/pdf/references/guide.md", "# Guide\n")

    const saved = await updateArtifact(env.workspace, "pdf", {
      type: "skill",
      platform: "cursor",
      name: "pdf",
      description: "PDFs.",
      body: "New.",
      extra: {},
    })
    expect(saved.managed).toBe(true)
    expect(await read(".black-agents/artifacts/skills/pdf/references/guide.md")).toBe("# Guide\n")
    expect(await read(".cursor/skills/pdf/SKILL.md")).toContain("New.")
  })

  it("keeps unknown IDE keys like readonly when exporting", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/reviewer.md",
      "---\nname: reviewer\ndescription: Old.\nreadonly: true\n---\nOld.\n"
    )
    await updateArtifact(env.workspace, "reviewer", agent)
    expect(await read(".cursor/agents/reviewer.md")).toContain("readonly: true")
  })

  it("renames: removes the old source and IDE copies", async () => {
    await createArtifact(env.workspace, agent)
    await updateArtifact(env.workspace, "reviewer", { ...agent, name: "checker" })
    expect(await exists(".black-agents/artifacts/agents/reviewer.md")).toBe(false)
    expect(await exists(".cursor/agents/reviewer.md")).toBe(false)
    expect(await exists(".cursor/agents/checker.md")).toBe(true)
  })

  it("refuses to rename onto an existing artifact", async () => {
    await createArtifact(env.workspace, agent)
    await createArtifact(env.workspace, { ...agent, name: "checker" })
    await expect(
      updateArtifact(env.workspace, "reviewer", { ...agent, name: "checker" })
    ).rejects.toBeInstanceOf(ArtifactStoreError)
  })

  it("reports a missing artifact", async () => {
    await expect(updateArtifact(env.workspace, "ghost", agent)).rejects.toMatchObject({ status: 404 })
  })
})

describe("deleteArtifact", () => {
  it("removes the source and every IDE copy", async () => {
    await writeExportTargets(env.workspace, ["cursor", "claude"])
    await createArtifact(env.workspace, agent)
    await deleteArtifact(env.workspace, "agent", "reviewer")
    expect(await scanWorkspace(env.workspace)).toEqual([])
    expect(await exists(".claude/agents/reviewer.md")).toBe(false)
  })

  it("removes an IDE-only artifact from its folder", async () => {
    await seedArtifact(env.workspace, ".claude/skills/x/SKILL.md", "---\nname: x\ndescription: y\n---\nz\n")
    await deleteArtifact(env.workspace, "skill", "x")
    expect(await readdir(path.join(env.workspace, ".claude/skills"))).toEqual([])
  })

  it("reports a missing artifact", async () => {
    await expect(deleteArtifact(env.workspace, "rule", "ghost")).rejects.toMatchObject({ status: 404 })
  })
})

describe("importArtifacts and drift", () => {
  it("moves every IDE-only artifact into the source", async () => {
    await seedArtifact(env.workspace, ".cursor/agents/a.md", "---\nname: a\ndescription: A.\n---\nA body.\n")
    await seedArtifact(env.workspace, ".claude/commands/b.md", "---\nname: b\ndescription: B.\n---\nB body.\n")

    const before = await driftReport(env.workspace)
    expect(before.ideOnly.map((a) => a.id).sort()).toEqual(["agent:a", "command:b"])

    const result = await importArtifacts(env.workspace)
    expect(result.imported.sort()).toEqual(["agent:a", "command:b"])
    expect(await read(".black-agents/artifacts/commands/b.md")).toContain("B body.")

    const after = await driftReport(env.workspace)
    expect(after.ideOnly).toEqual([])
    expect(after.sourceCount).toBe(2)
    const cursor = after.platforms.find((p) => p.platform === "cursor")
    expect(cursor).toMatchObject({ target: true, summary: { "in-sync": 2 } })
  })

  it("flags a hand edit and takes the IDE version back, keeping source-only keys", async () => {
    await createArtifact(env.workspace, agent)
    const cursorPath = path.join(env.workspace, ".cursor/agents/reviewer.md")
    await writeFile(cursorPath, (await readFile(cursorPath, "utf8")).replace("You review.", "Edited in Cursor."))

    const drift = await driftReport(env.workspace)
    expect(drift.platforms[0].files[0]).toMatchObject({ id: "agent:reviewer", status: "drifted" })

    await importArtifacts(env.workspace, { platform: "cursor", type: "agent", name: "reviewer" })
    const source = await read(".black-agents/artifacts/agents/reviewer.md")
    expect(source).toContain("Edited in Cursor.")
    expect(source).toContain("provider: openai")
    expect((await driftReport(env.workspace)).platforms[0].summary.drifted).toBe(0)
  })

  it("reports a missing IDE copy and fixes it with exportAll", async () => {
    await createArtifact(env.workspace, agent)
    await writeExportTargets(env.workspace, ["cursor", "claude"])
    const drift = await driftReport(env.workspace)
    expect(drift.platforms.find((p) => p.platform === "claude")?.summary.missing).toBe(1)

    const { written } = await exportAll(env.workspace)
    expect(written).toEqual([".claude/agents/reviewer.md"])
  })

  it("fails to take an IDE copy that does not exist", async () => {
    await expect(
      importArtifacts(env.workspace, { platform: "claude", type: "agent", name: "nope" })
    ).rejects.toMatchObject({ status: 404 })
  })
})
