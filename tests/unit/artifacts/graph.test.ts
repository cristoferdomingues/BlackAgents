import { describe, it, expect } from "vitest"

import { buildGraph, extractReferences } from "@/lib/artifacts/graph"
import type { Artifact, ArtifactType } from "@/lib/artifacts/types"

function artifact(
  type: ArtifactType,
  name: string,
  body = ""
): Artifact {
  return {
    name,
    type,
    platform: "cursor",
    description: `${name} desc`,
    frontmatter: {},
    body,
    relativePath: `.cursor/${type}s/${name}.md`,
  }
}

describe("extractReferences", () => {
  it("detects command -> agent via **bold** name", () => {
    const arts = [
      artifact("command", "ship", "Invoke the **tester** agent."),
      artifact("agent", "tester"),
    ]
    const refs = extractReferences(arts)
    expect(refs).toContainEqual({
      from: "command",
      fromName: "ship",
      to: "agent",
      toName: "tester",
      kind: "command-agent",
    })
  })

  it("detects agent -> rule and agent -> skill via backtick + keyword", () => {
    const arts = [
      artifact(
        "agent",
        "dev",
        "Read the `typescript-strict` rule and consult the `testing-patterns` skill."
      ),
      artifact("rule", "typescript-strict"),
      artifact("skill", "testing-patterns"),
    ]
    const refs = extractReferences(arts)
    expect(refs.map((r) => r.kind).sort()).toEqual(["agent-rule", "agent-skill"])
  })

  it("detects rule -> rule via 'Related rules:'", () => {
    const arts = [
      artifact("rule", "a", "Related rules: b, c."),
      artifact("rule", "b"),
      artifact("rule", "c"),
    ]
    const refs = extractReferences(arts)
    expect(refs.filter((r) => r.kind === "rule-rule").map((r) => r.toName).sort()).toEqual([
      "b",
      "c",
    ])
  })

  it("detects rule -> skill via 'See also:'", () => {
    const arts = [
      artifact("rule", "design-system", "See also: design-system skill."),
      artifact("skill", "design-system"),
    ]
    const refs = extractReferences(arts)
    expect(refs).toContainEqual(
      expect.objectContaining({ kind: "rule-skill", toName: "design-system" })
    )
  })

  it("ignores references to artifacts that do not exist", () => {
    const arts = [artifact("agent", "dev", "Read the `ghost-rule` rule.")]
    expect(extractReferences(arts)).toEqual([])
  })

  it("does not create a self-reference", () => {
    const arts = [
      artifact("rule", "solo", "Related rules: solo."),
    ]
    expect(extractReferences(arts)).toEqual([])
  })

  it("de-duplicates repeated references", () => {
    const arts = [
      artifact("agent", "dev", "the `r` rule ... the `r` rule again"),
      artifact("rule", "r"),
    ]
    expect(extractReferences(arts)).toHaveLength(1)
  })
})

describe("buildGraph", () => {
  it("creates a node per artifact and links with degree counts", () => {
    const arts = [
      artifact("command", "ship", "Invoke the **tester** agent."),
      artifact("agent", "tester"),
      artifact("rule", "orphan"),
    ]
    const graph = buildGraph(arts)
    expect(graph.nodes).toHaveLength(3)
    expect(graph.links).toHaveLength(1)

    const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
    expect(byId["command:ship"].degree).toBe(1)
    expect(byId["agent:tester"].degree).toBe(1)
    expect(byId["rule:orphan"].degree).toBe(0)
  })

  it("adds concept links beside artifact mentions", () => {
    const arts = [artifact("agent", "tester", "See [revenue](/metrics/revenue.md).")]
    const graph = buildGraph(arts, [
      {
        id: "metrics/revenue",
        title: "Revenue",
        body: "Computed by [the query](./query.md). Use the **tester** agent.",
      },
      { id: "metrics/query", title: "Query", body: "SQL." },
    ])
    expect(graph.links).toEqual(
      expect.arrayContaining([
        { source: "concept:metrics/revenue", target: "concept:metrics/query", kind: "concept-concept" },
        { source: "concept:metrics/revenue", target: "agent:tester", kind: "concept-artifact" },
        { source: "agent:tester", target: "concept:metrics/revenue", kind: "artifact-concept" },
      ])
    )
    expect(graph.nodes.find((node) => node.id === "concept:metrics/revenue")?.name).toBe("Revenue")
  })
})
