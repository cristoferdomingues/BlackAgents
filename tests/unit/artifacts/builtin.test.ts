import { describe, expect, it } from "vitest"

import {
  BUILTIN_ARTIFACTS,
  findBuiltinArtifact,
  isBuiltinArtifact,
  matchBuiltinTopicArtifacts,
  withBuiltinArtifacts,
} from "@/lib/artifacts/builtin"
import { extractReferences } from "@/lib/artifacts/graph"
import type { Artifact } from "@/lib/artifacts/types"
import { descriptionHasTrigger } from "@/lib/decision/skill-suggest"

describe("BUILTIN_ARTIFACTS", () => {
  it("defines embedded agents, skills, and rules that follow authoring standards", () => {
    expect(BUILTIN_ARTIFACTS.length).toBeGreaterThanOrEqual(7)

    const agents = BUILTIN_ARTIFACTS.filter((a) => a.type === "agent")
    const skills = BUILTIN_ARTIFACTS.filter((a) => a.type === "skill")
    const rules = BUILTIN_ARTIFACTS.filter((a) => a.type === "rule")

    expect(agents.map((a) => a.name)).toEqual(
      expect.arrayContaining(["workflow-architect", "browser-coach"])
    )
    expect(skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(["workflows-guide", "browser-automation", "platform-modules"])
    )
    expect(rules.map((r) => r.name)).toEqual(
      expect.arrayContaining(["workflow-guardrails", "browser-automation-guardrails"])
    )

    for (const agent of agents) {
      expect(agent.body).toContain("## Input")
      expect(agent.body).toContain("## Workflow")
      expect(agent.body).toContain("## Output")
      expect(agent.body).toContain("## Error handling")
      expect(isBuiltinArtifact(agent)).toBe(true)
    }

    for (const skill of skills) {
      expect(descriptionHasTrigger(skill.description)).toBe(true)
      expect(skill.body).toContain("## When to Apply")
      expect(skill.body).toContain("## Reference")
      expect(skill.body).toContain("## How to Use")
      expect(isBuiltinArtifact(skill)).toBe(true)
    }

    for (const rule of rules) {
      expect(rule.body.split("\n").length).toBeLessThanOrEqual(35)
      expect(isBuiltinArtifact(rule)).toBe(true)
    }
  })

  it("wires cross-references between built-in agents, skills, and rules", () => {
    const refs = extractReferences([...BUILTIN_ARTIFACTS])
    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "agent",
          fromName: "workflow-architect",
          to: "rule",
          toName: "workflow-guardrails",
        }),
        expect.objectContaining({
          from: "agent",
          fromName: "workflow-architect",
          to: "skill",
          toName: "workflows-guide",
        }),
        expect.objectContaining({
          from: "agent",
          fromName: "browser-coach",
          to: "rule",
          toName: "browser-automation-guardrails",
        }),
        expect.objectContaining({
          from: "agent",
          fromName: "browser-coach",
          to: "skill",
          toName: "browser-automation",
        }),
        expect.objectContaining({
          from: "skill",
          fromName: "workflows-guide",
          to: "rule",
          toName: "workflow-guardrails",
        }),
        expect.objectContaining({
          from: "skill",
          fromName: "browser-automation",
          to: "rule",
          toName: "browser-automation-guardrails",
        }),
      ])
    )
  })

  it("finds built-in artifacts and lets workspace artifacts override by type+name", () => {
    expect(findBuiltinArtifact("agent", "workflow-architect")?.name).toBe("workflow-architect")
    expect(findBuiltinArtifact("agent", "unknown")).toBeNull()

    const customOverride: Artifact = {
      name: "workflow-architect",
      type: "agent",
      platform: "cursor",
      description: "Custom workspace override",
      frontmatter: {},
      body: "Custom body",
      relativePath: ".cursor/agents/workflow-architect.md",
    }
    const merged = withBuiltinArtifacts([customOverride])
    const matches = merged.filter((a) => a.type === "agent" && a.name === "workflow-architect")
    expect(matches).toHaveLength(1)
    expect(matches[0].description).toBe("Custom workspace override")
    expect(matches[0].builtin).toBeUndefined()
  })

  it("matches user messages about workflows, browser automation, and platform modules", () => {
    const all = withBuiltinArtifacts([])

    expect(
      matchBuiltinTopicArtifacts("Help me create a daily workflow with 3 steps", all).map(
        (a) => a.name
      )
    ).toEqual(["workflows-guide"])

    expect(
      matchBuiltinTopicArtifacts(
        "How do I set up automated browsing and record a flow with Playwright?",
        all
      ).map((a) => a.name)
    ).toEqual(["browser-automation"])

    expect(
      matchBuiltinTopicArtifacts(
        "How do I configure MCP servers and use Media & Files in Second Brain?",
        all
      ).map((a) => a.name)
    ).toEqual(["platform-modules"])

    expect(matchBuiltinTopicArtifacts("Write a poem about autumn", all)).toEqual([])
  })
})
