import { describe, expect, it } from "vitest"

import { buildGraph, extractReferences, nodeRefId } from "@/lib/artifacts/graph"
import type { Artifact } from "@/lib/artifacts/types"

/** Minimal artifact factory for the pure graph functions. */
function artifact(
  type: Artifact["type"],
  name: string,
  body: string,
  scope?: string
): Artifact {
  return {
    name,
    type,
    platform: "cursor",
    description: `${name} d`,
    frontmatter: scope ? { name, description: `${name} d` } : { description: `${name} d` },
    body,
    relativePath: `.black-agents/artifacts/${type}s/${name}.md`,
    ...(scope ? { scope: { project: scope } } : {}),
  }
}

describe("nodeRefId", () => {
  it("keeps workspace ids unchanged and suffixes scoped ones", () => {
    expect(nodeRefId("agent", "demo")).toBe("agent:demo")
    expect(nodeRefId("agent", "demo", "web")).toBe("agent:demo@web")
  })
})

describe("scope-first reference resolution", () => {
  it("a project artifact prefers its own copy over the inherited workspace one", () => {
    const refs = extractReferences([
      artifact("agent", "worker", "Use the `shared` rule.", "web"),
      artifact("rule", "shared", "- project copy", "web"),
      artifact("rule", "shared", "- workspace copy"),
    ])
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      from: "agent",
      fromScope: "web",
      to: "rule",
      toName: "shared",
      toScope: "web",
      kind: "agent-rule",
    })
  })

  it("falls back to an inherited workspace entry when the project has no copy", () => {
    const refs = extractReferences([
      artifact("agent", "worker", "Use the `shared` rule.", "web"),
      artifact("rule", "shared", "- workspace copy"),
    ])
    expect(refs).toHaveLength(1)
    expect(refs[0]?.fromScope).toBe("web")
    expect(refs[0]?.toScope).toBeUndefined()
  })

  it("never resolves from a project into ANOTHER project (no sibling visibility)", () => {
    const refs = extractReferences([
      artifact("agent", "worker", "Use the `shared` rule.", "web"),
      artifact("rule", "shared", "- other project copy", "other"),
    ])
    expect(refs).toEqual([])
  })

  it("a workspace artifact never resolves into a project (the parent cannot see the child)", () => {
    const refs = extractReferences([
      artifact("command", "ship", "Run **worker** first."),
      artifact("agent", "worker", "Project-only worker.", "web"),
    ])
    expect(refs).toEqual([])
  })

  it("a workspace artifact resolves to the workspace copy even when a project copy exists", () => {
    const refs = extractReferences([
      artifact("command", "ship", "Run **worker** first."),
      artifact("agent", "worker", "workspace worker"),
      artifact("agent", "worker", "project worker", "web"),
    ])
    expect(refs).toHaveLength(1)
    expect(refs[0]?.fromScope).toBeUndefined()
    expect(refs[0]?.toScope).toBeUndefined()
  })
})

describe("buildGraph with scopes", () => {
  it("cross-scope links become visible edges with distinct node ids", () => {
    const graph = buildGraph([
      artifact("agent", "worker", "Use the `shared` rule.", "web"),
      artifact("rule", "shared", "- workspace copy"),
    ])
    const ids = graph.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(["agent:worker@web", "rule:shared"])
    expect(graph.links).toHaveLength(1)
    expect(graph.links[0]).toMatchObject({
      source: "agent:worker@web",
      target: "rule:shared",
    })
    expect(graph.nodes.find((n) => n.id === "agent:worker@web")?.scope).toBe("web")
  })

  it("a shadowed name produces two nodes, not one", () => {
    const graph = buildGraph([
      artifact("agent", "worker", "project worker", "web"),
      artifact("agent", "worker", "workspace worker"),
    ])
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["agent:worker", "agent:worker@web"])
  })

  it("workspace-only graphs keep today's ids", () => {
    const graph = buildGraph([
      artifact("command", "ship", "Run **worker** first."),
      artifact("agent", "worker", "- x"),
    ])
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["agent:worker", "command:ship"])
    expect(graph.nodes.every((n) => n.scope === undefined)).toBe(true)
  })
})
