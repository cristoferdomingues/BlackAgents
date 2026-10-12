import { describe, expect, it } from "vitest"

import {
  agentModelExtra,
  effectiveModelText,
  formatRunStepModel,
  modelFormFromFrontmatter,
  stepModelFields,
  stepModelIssue,
} from "@/components/features/models/model-choice"

describe("agentModelExtra", () => {
  it("saves an id, a task kind, and an untouched alias, and clears with null", () => {
    expect(agentModelExtra({ modelChoice: "openai", modelId: "gpt-4o", modelAlias: "" })).toEqual({
      model: "gpt-4o",
      provider: "openai",
    })
    expect(agentModelExtra({ modelChoice: "task:vision", modelId: "", modelAlias: "" })).toEqual({
      model: "task:vision",
      provider: null,
    })
    expect(agentModelExtra({ modelChoice: "inherit", modelId: "", modelAlias: "sonnet" })).toEqual({
      model: "sonnet",
      provider: null,
    })
    expect(agentModelExtra({ modelChoice: "inherit", modelId: "", modelAlias: "" })).toEqual({
      model: null,
      provider: null,
    })
    expect(agentModelExtra({ modelChoice: "anthropic", modelId: "  ", modelAlias: "" })).toEqual({
      model: null,
      provider: null,
    })
  })
})

describe("modelFormFromFrontmatter", () => {
  it("keeps aliases on inherit and loads a task kind without a provider", () => {
    expect(modelFormFromFrontmatter("sonnet", "anthropic")).toEqual({
      modelChoice: "inherit",
      modelId: "",
      modelAlias: "sonnet",
    })
    expect(modelFormFromFrontmatter("task:fast", undefined).modelChoice).toBe("task:fast")
    expect(modelFormFromFrontmatter("gpt-4o", undefined)).toMatchObject({ modelChoice: "inherit", modelId: "gpt-4o" })
  })
})

describe("step model fields", () => {
  it("omits inherit and sends a task kind without a provider", () => {
    expect(stepModelFields("inherit", "")).toEqual({})
    expect(stepModelFields("task:reasoning", "ignored")).toEqual({ model: "task:reasoning" })
    expect(stepModelFields("openai", "gpt-4o-mini")).toEqual({ model: "gpt-4o-mini", provider: "openai" })
    expect(stepModelIssue("openai", "", "plan")).toBe('Step "plan": Choose a model')
    expect(stepModelIssue("inherit", "", "plan")).toBeNull()
  })
})

describe("effectiveModelText", () => {
  it("follows step, then agent, then workflow, then the assistant default", () => {
    const tasks = { fast: { provider: "openai" as const, model: "gpt-4o-mini" } }
    expect(
      effectiveModelText({
        stepModel: "task:fast",
        agentModel: "claude-sonnet-4-20250514",
        agentProvider: "anthropic",
        workflowModel: "gpt-4o",
        workflowProvider: "openai",
        tasks,
      })
    ).toBe("task:fast → gpt-4o-mini (OpenAI) · from step")
    expect(
      effectiveModelText({
        agentModel: "claude-sonnet-4-20250514",
        agentProvider: "anthropic",
        workflowModel: "gpt-4o",
        workflowProvider: "openai",
        tasks,
      })
    ).toBe("claude-sonnet-4-20250514 · from agent")
    expect(effectiveModelText({ agentModel: "sonnet", workflowModel: "gpt-4o", workflowProvider: "openai", tasks })).toBe(
      "gpt-4o · from workflow"
    )
    expect(effectiveModelText({ agentModel: "sonnet", tasks: {} })).toBe("Assistant default")
    expect(effectiveModelText({ stepModel: "task:vision", tasks: {} })).toBe("task:vision → not set · from step")
  })
})

describe("formatRunStepModel", () => {
  it("hides old runs and shows the provider, model, source, and task", () => {
    expect(formatRunStepModel({})).toBeNull()
    expect(
      formatRunStepModel({ provider: "openai", model: "gpt-4o-mini", modelSource: "step", task: "fast" })
    ).toBe("OpenAI · gpt-4o-mini · from step · task:fast")
    expect(formatRunStepModel({ provider: "anthropic", model: "claude-sonnet-4-20250514", modelSource: "agent" })).toBe(
      "Anthropic · claude-sonnet-4-20250514 · from agent"
    )
  })
})
