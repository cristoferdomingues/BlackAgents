import { describe, it, expect } from "vitest"
import matter from "gray-matter"

import {
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
    expect(relPath).toBe(".black-agents/artifacts/agents/demo.md")
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
    expect(relPath).toBe(".black-agents/artifacts/rules/no-secrets.md")
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
    expect(relPath).toBe(".black-agents/artifacts/skills/code-review/SKILL.md")
    expect(deletePath).toBe(".black-agents/artifacts/skills/code-review")
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

  it("writes an agent model and clears it when the editor sends null", () => {
    const saved = serializeArtifact(input({ extra: { model: "gpt-4o", provider: "openai" } }))
    expect(matter(saved.content).data).toMatchObject({ model: "gpt-4o", provider: "openai" })

    const cleared = serializeArtifact(
      input({ extra: { model: null, provider: null } }),
      matter(saved.content).data
    )
    expect(matter(cleared.content).data.model).toBeUndefined()
    expect(matter(cleared.content).data.provider).toBeUndefined()
  })

  it("keeps a hand-written model when the editor does not send one", () => {
    const { content } = serializeArtifact(input({ extra: { parallel: true } }), {
      model: "sonnet",
      provider: "anthropic",
      customAuthor: "Ada",
    })
    expect(matter(content).data).toMatchObject({
      model: "sonnet",
      provider: "anthropic",
      parallel: true,
      customAuthor: "Ada",
    })
  })

  it("drops model and provider for non-agents", () => {
    const { content } = serializeArtifact(
      input({ type: "rule", extra: { model: "gpt-4o", provider: "openai", alwaysApply: true } }),
      { model: "gpt-4o", provider: "openai" }
    )
    const data = matter(content).data
    expect(data.model).toBeUndefined()
    expect(data.provider).toBeUndefined()
    expect(data.alwaysApply).toBe(true)
  })

  it("preserves unmanaged frontmatter fields from existingFrontmatter", () => {
    const existing = {
      name: "old-name",
      description: "old-desc",
      customAuthor: "Alice",
      customVersion: "1.2.0",
      tags: ["crypto", "defi"],
    }
    const { content } = serializeArtifact(
      input({ name: "demo", description: "New desc" }),
      existing
    )
    const parsed = matter(content)
    expect(parsed.data).toMatchObject({
      name: "demo",
      description: "New desc",
      customAuthor: "Alice",
      customVersion: "1.2.0",
      tags: ["crypto", "defi"],
    })
  })
})
