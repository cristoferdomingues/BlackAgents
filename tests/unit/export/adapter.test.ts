import { describe, it, expect } from "vitest"
import matter from "gray-matter"

import {
  artifactToFile,
  buildExportManifest,
  fileStatus,
  frontmatterFor,
} from "@/lib/export/adapter"
import type { Artifact, ArtifactType } from "@/lib/artifacts/types"

function artifact(
  type: ArtifactType,
  name: string,
  frontmatter: Artifact["frontmatter"] = {}
): Artifact {
  return {
    name,
    type,
    platform: "cursor",
    description: `${name} desc`,
    frontmatter,
    body: "body text",
    relativePath: `.cursor/${type}s/${name}.md`,
  }
}

describe("frontmatterFor", () => {
  it("cursor omits name for rules and maps activation keys", () => {
    const fm = frontmatterFor("cursor", artifact("rule", "r", { alwaysApply: true, globs: ["a/**"] }))
    expect(fm.name).toBeUndefined()
    expect(fm).toMatchObject({ description: "r desc", alwaysApply: true, globs: ["a/**"] })
  })

  it("cursor keeps parallel for agents", () => {
    const fm = frontmatterFor("cursor", artifact("agent", "a", { parallel: true }))
    expect(fm).toMatchObject({ name: "a", parallel: true })
  })

  it("claude drops rule name and has no activation keys", () => {
    const fm = frontmatterFor("claude", artifact("rule", "r", { alwaysApply: true }))
    expect(fm.name).toBeUndefined()
    expect(fm.alwaysApply).toBeUndefined()
    expect(fm.trigger).toBeUndefined()
  })

  it("claude keeps name for agents and skills", () => {
    expect(frontmatterFor("claude", artifact("agent", "a")).name).toBe("a")
    expect(frontmatterFor("claude", artifact("skill", "s")).name).toBe("s")
  })

  it("windsurf maps alwaysApply -> trigger always_on", () => {
    expect(frontmatterFor("windsurf", artifact("rule", "r", { alwaysApply: true })).trigger).toBe(
      "always_on"
    )
  })

  it("windsurf maps globs -> trigger glob + globs", () => {
    const fm = frontmatterFor("windsurf", artifact("rule", "r", { globs: ["a/**"] }))
    expect(fm).toMatchObject({ trigger: "glob", globs: ["a/**"] })
  })

  it("windsurf falls back to trigger manual with no activation", () => {
    expect(frontmatterFor("windsurf", artifact("rule", "r")).trigger).toBe("manual")
  })

  it("antigravity sets canonical frontmatter for rules, agents, and skills", () => {
    const ruleFm = frontmatterFor(
      "antigravity",
      artifact("rule", "r", { alwaysApply: true, globs: ["src/**"] })
    )
    expect(ruleFm.name).toBeUndefined()
    expect(ruleFm).toMatchObject({
      description: "r desc",
      alwaysApply: true,
      globs: ["src/**"],
    })

    const agentFm = frontmatterFor(
      "antigravity",
      artifact("agent", "a", { parallel: true })
    )
    expect(agentFm).toMatchObject({ name: "a", description: "a desc", parallel: true })

    const skillFm = frontmatterFor("antigravity", artifact("skill", "s"))
    expect(skillFm).toMatchObject({ name: "s", description: "s desc" })
  })
})

describe("artifactToFile", () => {
  it("emits the target-platform path and parseable frontmatter", () => {
    const file = artifactToFile(artifact("rule", "r", { alwaysApply: true }), "windsurf")
    expect(file.path).toBe(".windsurf/rules/r.md")
    expect(matter(file.content).data).toMatchObject({ trigger: "always_on" })
  })

  it("emits antigravity paths for skills, rules, and workflows", () => {
    const skillFile = artifactToFile(artifact("skill", "my-skill"), "antigravity")
    expect(skillFile.path).toBe(".agents/skills/my-skill/SKILL.md")
    expect(matter(skillFile.content).data).toMatchObject({ name: "my-skill" })

    const commandFile = artifactToFile(artifact("command", "my-workflow"), "antigravity")
    expect(commandFile.path).toBe(".agents/workflows/my-workflow.md")

    const ruleFile = artifactToFile(artifact("rule", "my-rule"), "antigravity")
    expect(ruleFile.path).toBe(".agents/rules/my-rule.md")
  })
})

describe("buildExportManifest", () => {
  it("maps every artifact to a file", () => {
    const files = buildExportManifest([artifact("agent", "a"), artifact("skill", "s")], "cursor")
    expect(files.map((f) => f.path)).toEqual([
      ".cursor/agents/a.md",
      ".cursor/skills/s/SKILL.md",
    ])
  })
})

describe("fileStatus", () => {
  it("classifies create / unchanged / overwrite", () => {
    expect(fileStatus(null, "x")).toBe("create")
    expect(fileStatus("x", "x")).toBe("unchanged")
    expect(fileStatus("x", "y")).toBe("overwrite")
  })
})
