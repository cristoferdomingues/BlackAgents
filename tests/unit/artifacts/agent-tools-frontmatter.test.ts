import matter from "gray-matter"
import { describe, expect, it } from "vitest"

import { artifactInputSchema, normalizeExtra } from "@/lib/artifacts/schemas"
import { serializeArtifact } from "@/lib/artifacts/serializer"

const agentInput = (extra: Record<string, unknown>) =>
  artifactInputSchema.parse({ type: "agent", name: "worker", description: "Works", body: "Body", extra })

describe("agent tool frontmatter", () => {
  it("keeps tools and non-empty MCP servers for agents only", () => {
    expect(normalizeExtra("agent", { tools: ["fs_read", "fs_read"], mcpServers: ["github"] })).toEqual({
      tools: ["fs_read"],
      mcpServers: ["github"],
    })
    expect(normalizeExtra("agent", { tools: [], mcpServers: [] })).toEqual({ tools: [] })
    expect(normalizeExtra("skill", { tools: ["fs_read"] })).toEqual({})
  })

  it("rejects unknown tool names", () => {
    expect(() => agentInput({ tools: ["rm_rf"] })).toThrow()
  })

  it("replaces tool scope only when the editor sends it", () => {
    const existing = { tools: ["shell_run"], mcpServers: ["github"], custom: 1 }
    const untouched = matter(serializeArtifact(agentInput({}), existing).content).data
    expect(untouched).toMatchObject({ tools: ["shell_run"], mcpServers: ["github"], custom: 1 })

    const replaced = matter(
      serializeArtifact(agentInput({ tools: ["fs_list"], mcpServers: [] }), existing).content
    ).data
    expect(replaced.tools).toEqual(["fs_list"])
    expect(replaced.mcpServers).toBeUndefined()
    expect(replaced.custom).toBe(1)
  })
})
