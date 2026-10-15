import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { scanWorkspace } from "@/lib/artifacts/parser"
import { isSourcePath, sourceDeletePath, sourceRelPath } from "@/lib/artifacts/source"
import type { Artifact } from "@/lib/artifacts/types"
import { exportedFrontmatter } from "@/lib/export/adapter"
import { makeTempEnv, seedArtifact, type TempEnv } from "../../helpers/workspace"

describe("source paths", () => {
  it("uses one folder per type, .md files and nested skills", () => {
    expect(sourceRelPath("agent", "a")).toBe(".black-agents/artifacts/agents/a.md")
    expect(sourceRelPath("command", "c")).toBe(".black-agents/artifacts/commands/c.md")
    expect(sourceRelPath("rule", "r")).toBe(".black-agents/artifacts/rules/r.md")
    expect(sourceRelPath("skill", "s")).toBe(".black-agents/artifacts/skills/s/SKILL.md")
    expect(sourceDeletePath("skill", "s")).toBe(".black-agents/artifacts/skills/s")
    expect(sourceDeletePath("rule", "r")).toBe(".black-agents/artifacts/rules/r.md")
  })

  it("tells source paths apart", () => {
    expect(isSourcePath(".black-agents/artifacts/agents/a.md")).toBe(true)
    expect(isSourcePath(".black-agents/artifacts-old/x")).toBe(false)
    expect(isSourcePath(".cursor/agents/a.md")).toBe(false)
  })
})

describe("scanWorkspace with a source folder", () => {
  let env: TempEnv
  beforeEach(async () => {
    env = await makeTempEnv()
  })
  afterEach(async () => {
    await env.cleanup()
  })

  it("prefers the source copy and marks IDE-only artifacts as not managed", async () => {
    await seedArtifact(env.workspace, ".black-agents/artifacts/agents/a.md", "---\nname: a\ndescription: Source.\n---\nS\n")
    await seedArtifact(env.workspace, ".cursor/agents/a.md", "---\nname: a\ndescription: IDE.\n---\nI\n")
    await seedArtifact(env.workspace, ".cursor/agents/b.md", "---\nname: b\ndescription: Only IDE.\n---\nB\n")

    const all = await scanWorkspace(env.workspace)
    expect(all.map((x) => [x.name, x.description, Boolean(x.managed)])).toEqual([
      ["a", "Source.", true],
      ["b", "Only IDE.", false],
    ])
  })
})

describe("exportedFrontmatter", () => {
  const artifact: Artifact = {
    name: "a",
    type: "agent",
    platform: "cursor",
    description: "A.",
    frontmatter: { name: "a", description: "A.", provider: "openai", tools: ["fs_read"], readonly: true },
    body: "x",
    relativePath: ".black-agents/artifacts/agents/a.md",
  }

  it("keeps unmanaged keys and drops BlackAgents-only keys", () => {
    expect(exportedFrontmatter("cursor", artifact)).toEqual({ name: "a", description: "A.", readonly: true })
  })
})
