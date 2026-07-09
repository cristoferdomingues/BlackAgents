import { describe, it, expect } from "vitest"
import matter from "gray-matter"

import {
  artifactPaths,
  serializeArtifact,
} from "@/lib/artifacts/serializer"
import type { ArtifactInput } from "@/lib/artifacts/schemas"

function input(overrides: Partial<ArtifactInput>): ArtifactInput {
  return {
    type: "agent",
    platform: "cursor",
    name: "demo",
    description: "A demo.",
    body: "## Input\n- x\n",
    extra: {},
    ...overrides,
  } as ArtifactInput
}

describe("serializeArtifact", () => {
  it("writes name + description for agents and preserves the body", () => {
    const { content, relPath } = serializeArtifact(input({}))
    const parsed = matter(content)
    expect(parsed.data).toEqual({ name: "demo", description: "A demo." })
    expect(parsed.content).toContain("## Input")
    expect(relPath).toBe(".cursor/agents/demo.md")
  })

  it("includes parallel: true for agents when set", () => {
    const { content } = serializeArtifact(input({ extra: { parallel: true } }))
    expect(matter(content).data).toMatchObject({ parallel: true })
  })

  it("omits name for rules (identified by filename)", () => {
    const { content, relPath } = serializeArtifact(
      input({ type: "rule", name: "no-secrets", extra: { alwaysApply: true } })
    )
    const parsed = matter(content)
    expect(parsed.data.name).toBeUndefined()
    expect(parsed.data).toMatchObject({
      description: "A demo.",
      alwaysApply: true,
    })
    expect(relPath).toBe(".cursor/rules/no-secrets.mdc")
  })

  it("writes rule globs when provided", () => {
    const { content } = serializeArtifact(
      input({ type: "rule", extra: { globs: ["app/**", "lib/**"] } })
    )
    expect(matter(content).data.globs).toEqual(["app/**", "lib/**"])
  })

  it("nests skills and keeps name", () => {
    const { content, relPath, deletePath } = serializeArtifact(
      input({ type: "skill", name: "code-review" })
    )
    expect(matter(content).data).toMatchObject({ name: "code-review" })
    expect(relPath).toBe(".cursor/skills/code-review/SKILL.md")
    expect(deletePath).toBe(".cursor/skills/code-review")
  })

  it("round-trips through gray-matter (serialize then parse)", () => {
    const { content } = serializeArtifact(input({ body: "## Workflow\n1. do\n" }))
    const parsed = matter(content)
    expect(parsed.content.trim()).toBe("## Workflow\n1. do")
  })

  it("handles an empty body without throwing", () => {
    const { content } = serializeArtifact(input({ body: "" }))
    expect(matter(content).data).toMatchObject({ name: "demo" })
  })
})

describe("artifactPaths", () => {
  it("returns rel and delete paths for a skill", () => {
    expect(artifactPaths("cursor", "skill", "x")).toEqual({
      relPath: ".cursor/skills/x/SKILL.md",
      deletePath: ".cursor/skills/x",
    })
  })
})
