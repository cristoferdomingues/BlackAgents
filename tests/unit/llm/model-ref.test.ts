import { describe, expect, it } from "vitest"

import type { Artifact } from "@/lib/artifacts/types"
import {
  agentModelLayer,
  inspectModelRef,
  ModelRefError,
  parseModelRef,
  pickModelLayer,
  resolveTaskRef,
  selectLayeredModel,
  type ModelLayer,
} from "@/lib/llm/model-ref"

function agent(frontmatter: Artifact["frontmatter"]): Artifact {
  return {
    name: "reviewer",
    type: "agent",
    platform: "cursor",
    description: "Reviews.",
    frontmatter,
    body: "Be careful.",
    relativePath: ".cursor/agents/reviewer.md",
  }
}

describe("parseModelRef", () => {
  it("treats missing, blank, and inherit as inherit", () => {
    expect(parseModelRef(undefined, undefined)).toEqual({ kind: "inherit" })
    expect(parseModelRef(null, "openai")).toEqual({ kind: "inherit" })
    expect(parseModelRef("", "anthropic")).toEqual({ kind: "inherit" })
    expect(parseModelRef("  inherit  ", undefined)).toEqual({ kind: "inherit" })
  })

  it("keeps a slash model id whole and keeps an optional provider", () => {
    expect(parseModelRef(" google/gemini-2.5-flash ", undefined)).toEqual({
      kind: "id",
      model: "google/gemini-2.5-flash",
    })
    expect(parseModelRef("claude-sonnet-4-20250514", "anthropic")).toEqual({
      kind: "id",
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
    })
  })

  it("treats Claude and Cursor aliases as inherit, even with a provider", () => {
    for (const alias of ["sonnet", "opus", "haiku", "fast"]) {
      expect(parseModelRef(alias, undefined)).toEqual({ kind: "inherit" })
    }
    expect(parseModelRef("sonnet", "anthropic")).toEqual({ kind: "inherit" })
    expect(inspectModelRef("sonnet", "anthropic").warning).toBe("A provider without a model is ignored")
  })

  it("warns when a provider is set without a model and accepts a 200-character id", () => {
    expect(inspectModelRef(undefined, "openai")).toEqual({
      ref: { kind: "inherit" },
      warning: "A provider without a model is ignored",
    })
    expect(inspectModelRef("inherit", "custom").warning).toBe("A provider without a model is ignored")
    const id = "m".repeat(200)
    expect(parseModelRef(`  ${id}  `, undefined)).toEqual({ kind: "id", model: id })
    expect(parseModelRef("  task:vision  ", undefined)).toEqual({ kind: "task", task: "vision" })
    expect(() => parseModelRef("task:", undefined)).toThrow('Unknown model task ""')
  })

  it("parses chat task kinds and rejects voice, unknown kinds, and a provider beside them", () => {
    expect(parseModelRef("task:vision", undefined)).toEqual({ kind: "task", task: "vision" })
    expect(parseModelRef("task:fast", null)).toEqual({ kind: "task", task: "fast" })
    expect(parseModelRef("task:reasoning", undefined)).toEqual({ kind: "task", task: "reasoning" })

    expect(() => parseModelRef("task:voice", undefined)).toThrow(ModelRefError)
    expect(() => parseModelRef("task:voice", undefined)).toThrow('"voice" is not a chat model task')
    expect(() => parseModelRef("task:video", undefined)).toThrow('"video" is not a chat model task')
    expect(() => parseModelRef("task:nope", undefined)).toThrow('Unknown model task "nope"')
    expect(() => parseModelRef("task:vision", "openai")).toThrow("A task kind cannot set a provider")
  })

  it("rejects an unknown provider and a model that is not a string", () => {
    expect(() => parseModelRef("gpt-4o", "gemini")).toThrow('Unknown provider "gemini"')
    expect(() => parseModelRef(12, undefined)).toThrow(ModelRefError)
    expect(() => parseModelRef("x".repeat(201), undefined)).toThrow("Model id is too long")
  })
})

describe("pickModelLayer", () => {
  it("returns the first layer that does not inherit", () => {
    const layers: ModelLayer[] = [
      { source: "step", ref: { kind: "inherit" } },
      { source: "agent", ref: { kind: "id", model: "gpt-4o" } },
      { source: "workflow", ref: { kind: "id", model: "other" } },
    ]
    expect(pickModelLayer(layers)?.source).toBe("agent")
    expect(pickModelLayer([{ source: "assistant", ref: { kind: "inherit" } }])).toBeUndefined()
    expect(pickModelLayer([])).toBeUndefined()
  })
})

describe("agentModelLayer", () => {
  it("reads frontmatter and turns aliases into inherit", () => {
    expect(agentModelLayer(agent({ model: "gpt-4o", provider: "openai" }))).toEqual({
      source: "agent",
      ref: { kind: "id", model: "gpt-4o", provider: "openai" },
    })
    expect(agentModelLayer(agent({ model: "sonnet" })).ref).toEqual({ kind: "inherit" })
    expect(agentModelLayer(agent({})).ref).toEqual({ kind: "inherit" })
    expect(agentModelLayer({ ...agent({ model: "gpt-4o" }), type: "rule" }).ref).toEqual({ kind: "inherit" })
  })
})

describe("resolveTaskRef", () => {
  it("returns the saved choice and fails when the kind is unset", () => {
    expect(resolveTaskRef("vision", { models: { vision: { provider: "openai", model: "gpt-4o" } } })).toEqual({
      provider: "openai",
      model: "gpt-4o",
    })
    expect(() => resolveTaskRef("fast", { models: {} })).toThrow(
      "Set the Fast model in Settings → AI → Models by task"
    )
    try {
      resolveTaskRef("reasoning", { models: {} })
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRefError)
      expect((error as ModelRefError).status).toBe(412)
    }
    expect(() =>
      resolveTaskRef("vision", { models: { vision: { provider: "openai", model: "" } } })
    ).toThrow("Set the Vision model in Settings → AI → Models by task")
  })
})

describe("selectLayeredModel", () => {
  it("uses the next layer's provider when an id has none", () => {
    const selected = selectLayeredModel(
      [
        { source: "agent", ref: { kind: "id", model: "gpt-4o" } },
        { source: "assistant", ref: { kind: "id", model: "ignored", provider: "openai" } },
      ],
      () => {
        throw new Error("no task")
      }
    )
    expect(selected).toEqual({ provider: "openai", model: "gpt-4o", source: "agent" })
  })

  it("picks step over agent over workflow, and nothing when every layer inherits", () => {
    const layers: ModelLayer[] = [
      { source: "step", ref: { kind: "id", model: "step-model" } },
      { source: "agent", ref: { kind: "id", model: "agent-model", provider: "anthropic" } },
      { source: "workflow", ref: { kind: "id", model: "workflow-model", provider: "openai" } },
    ]
    expect(selectLayeredModel(layers, () => { throw new Error("no task") })?.source).toBe("step")
    expect(
      selectLayeredModel(layers.slice(1), () => { throw new Error("no task") })
    ).toEqual({ provider: "anthropic", model: "agent-model", source: "agent" })
    expect(
      selectLayeredModel(layers.slice(2), () => { throw new Error("no task") })
    ).toEqual({ provider: "openai", model: "workflow-model", source: "workflow" })
    expect(
      selectLayeredModel(
        layers.map((layer) => ({ ...layer, ref: { kind: "inherit" as const } })),
        () => { throw new Error("no task") }
      )
    ).toBeUndefined()
  })

  it("keeps a model id and only borrows a lower task kind's provider", () => {
    const selected = selectLayeredModel(
      [
        { source: "step", ref: { kind: "id", model: "cheap-model" } },
        { source: "agent", ref: { kind: "task", task: "vision" } },
      ],
      () => ({ provider: "anthropic", model: "claude-sonnet-4-20250514" })
    )
    expect(selected).toEqual({ provider: "anthropic", model: "cheap-model", source: "step" })
  })

  it("resolves a winning task kind", () => {
    const selected = selectLayeredModel(
      [
        { source: "step", ref: { kind: "inherit" } },
        { source: "agent", ref: { kind: "task", task: "vision" } },
      ],
      () => ({ provider: "anthropic", model: "claude-sonnet-4-20250514" })
    )
    expect(selected).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      source: "agent",
      task: "vision",
    })
  })
})
