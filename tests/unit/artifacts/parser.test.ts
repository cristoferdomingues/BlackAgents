import { describe, it, expect, beforeEach, afterEach } from "vitest"

import {
  detectPlatforms,
  findArtifact,
  safeParseMatter,
  scanWorkspace,
} from "@/lib/artifacts/parser"
import { makeTempEnv, seedArtifact, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("scanWorkspace", () => {
  it("returns an empty list for a workspace with no artifact dirs", async () => {
    expect(await scanWorkspace(env.workspace)).toEqual([])
  })

  it("parses agents, rules, and nested skills sorted by type then name", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/tester.md",
      "---\nname: tester\ndescription: Test agent\nparallel: true\n---\n\n## Input\n"
    )
    await seedArtifact(
      env.workspace,
      ".cursor/rules/no-secrets.mdc",
      "---\ndescription: No secrets\nalwaysApply: true\n---\n\n- do not log keys\n"
    )
    await seedArtifact(
      env.workspace,
      ".cursor/skills/code-review/SKILL.md",
      "---\nname: code-review\ndescription: Review skill\n---\n\n# Code Review\n"
    )
    await seedArtifact(
      env.workspace,
      ".cursor/skills/code-review/references/checklist.md",
      "- item\n"
    )

    const artifacts = await scanWorkspace(env.workspace)
    expect(artifacts.map((a) => `${a.type}:${a.name}`)).toEqual([
      "agent:tester",
      "rule:no-secrets",
      "skill:code-review",
    ])

    const agent = artifacts[0]
    expect(agent.description).toBe("Test agent")
    expect(agent.frontmatter.parallel).toBe(true)
    expect(agent.body.startsWith("## Input")).toBe(true)

    const skill = artifacts[2]
    expect(skill.supportingFiles).toContain("references/checklist.md")
    expect(skill.supportingFiles).not.toContain("SKILL.md")
  })

  it("dedupes the same type+name across platforms, preferring cursor", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/dup.md",
      "---\nname: dup\ndescription: from cursor\n---\n\nbody\n"
    )
    await seedArtifact(
      env.workspace,
      ".claude/agents/dup.md",
      "---\nname: dup\ndescription: from claude\n---\n\nbody\n"
    )
    const artifacts = await scanWorkspace(env.workspace)
    const dup = artifacts.filter((a) => a.name === "dup")
    expect(dup).toHaveLength(1)
    expect(dup[0].platform).toBe("cursor")
    expect(dup[0].description).toBe("from cursor")
  })
})

describe("findArtifact", () => {
  it("finds an existing artifact and returns null otherwise", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/tester.md",
      "---\nname: tester\ndescription: d\n---\n\nb\n"
    )
    expect(await findArtifact(env.workspace, "agent", "tester")).not.toBeNull()
    expect(await findArtifact(env.workspace, "agent", "missing")).toBeNull()
    expect(await findArtifact(env.workspace, "rule", "tester")).toBeNull()
  })
})

describe("detectPlatforms", () => {
  it("reports only the platforms whose marker dir exists", async () => {
    await seedArtifact(env.workspace, ".cursor/agents/a.md", "---\nname: a\ndescription: d\n---\n\nb\n")
    const platforms = await detectPlatforms(env.workspace)
    expect(platforms).toContain("cursor")
    expect(platforms).not.toContain("claude")
    expect(platforms).not.toContain("windsurf")
  })
})

describe("safeParseMatter", () => {
  it("parses valid frontmatter correctly", () => {
    const res = safeParseMatter("---\nname: my-agent\ndescription: Hello world\n---\n\n# Body")
    expect(res.data).toEqual({ name: "my-agent", description: "Hello world" })
    expect(res.content).toContain("# Body")
  })

  it("recovers gracefully from malformed YAML with unquoted colons and quotes", () => {
    const raw =
      '---\nname: new-relic\ndescription: Use when querying data. Triggers on: "check NR", "query APM".\n---\n\n# New Relic Guide'
    const res = safeParseMatter(raw)
    expect(res.data.name).toBe("new-relic")
    expect(res.data.description).toContain("Triggers on:")
    expect(res.content).toContain("# New Relic Guide")
  })

  it("handles markdown files without any frontmatter", () => {
    const raw = "# Just Markdown\n\nNo frontmatter block here."
    const res = safeParseMatter(raw)
    expect(res.data).toEqual({})
    expect(res.content).toBe(raw)
  })

  it("allows scanWorkspace to succeed even when an artifact has malformed frontmatter", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/skills/malformed/SKILL.md",
      '---\nname: malformed\ndescription: Triggers on: "unquoted colon"\n---\n\n# Malformed Skill Body\n'
    )
    const artifacts = await scanWorkspace(env.workspace)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].name).toBe("malformed")
    expect(artifacts[0].description).toContain("Triggers on:")
    expect(artifacts[0].body).toContain("# Malformed Skill Body")
  })
})
