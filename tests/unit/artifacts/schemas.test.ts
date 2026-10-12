import { describe, it, expect } from "vitest"

import {
  artifactInputSchema,
  nameSchema,
  normalizeExtra,
  platformSchema,
  workspaceInputSchema,
} from "@/lib/artifacts/schemas"

describe("nameSchema", () => {
  it.each(["agent", "web3-security", "a1", "peer-reviewer", "x-2-y"])(
    "accepts kebab-case %s",
    (name) => {
      expect(nameSchema.safeParse(name).success).toBe(true)
    }
  )

  it.each([
    ["", "empty"],
    ["Bad Name", "spaces + capitals"],
    ["UPPER", "uppercase"],
    ["-leading", "leading hyphen"],
    ["trailing-", "trailing hyphen"],
    ["double--hyphen", "double hyphen"],
    ["under_score", "underscore"],
  ])("rejects %s (%s)", (name) => {
    expect(nameSchema.safeParse(name).success).toBe(false)
  })

  it("rejects names longer than 80 chars", () => {
    expect(nameSchema.safeParse("a".repeat(81)).success).toBe(false)
  })

  it("trims surrounding whitespace before validating", () => {
    const parsed = nameSchema.safeParse("  demo-agent  ")
    expect(parsed.success && parsed.data).toBe("demo-agent")
  })
})

describe("platformSchema", () => {
  it("defaults to cursor", () => {
    expect(platformSchema.parse(undefined)).toBe("cursor")
  })

  it("rejects unknown platforms", () => {
    expect(platformSchema.safeParse("emacs").success).toBe(false)
  })
})

describe("artifactInputSchema", () => {
  const base = {
    type: "agent",
    platform: "cursor",
    name: "demo-agent",
    description: "A demo agent.",
    body: "## Input\n",
  }

  it("accepts a valid agent input and defaults extra to {}", () => {
    const parsed = artifactInputSchema.parse({ ...base, extra: undefined })
    expect(parsed.extra).toEqual({})
    expect(parsed.body).toBe("## Input\n")
  })

  it("defaults body to an empty string", () => {
    const parsed = artifactInputSchema.parse({ ...base, body: undefined })
    expect(parsed.body).toBe("")
  })

  it("requires a non-empty description", () => {
    const parsed = artifactInputSchema.safeParse({ ...base, description: "   " })
    expect(parsed.success).toBe(false)
  })

  it("rejects an invalid name", () => {
    const parsed = artifactInputSchema.safeParse({ ...base, name: "Bad Name" })
    expect(parsed.success).toBe(false)
  })

  it("rejects an unknown type", () => {
    const parsed = artifactInputSchema.safeParse({ ...base, type: "prompt" })
    expect(parsed.success).toBe(false)
  })
})

describe("normalizeExtra", () => {
  it("keeps parallel only when true for agents", () => {
    expect(normalizeExtra("agent", { parallel: true })).toEqual({ parallel: true })
    expect(normalizeExtra("agent", { parallel: false })).toEqual({})
    expect(normalizeExtra("agent", {})).toEqual({})
  })

  it("keeps alwaysApply and non-empty globs for rules", () => {
    expect(
      normalizeExtra("rule", { alwaysApply: true, globs: ["app/**"] })
    ).toEqual({ alwaysApply: true, globs: ["app/**"] })
  })

  it("drops empty globs and falsy alwaysApply for rules", () => {
    expect(normalizeExtra("rule", { alwaysApply: false, globs: [] })).toEqual({})
  })

  it("drops all extras for commands and skills", () => {
    expect(normalizeExtra("command", { parallel: true })).toEqual({})
    expect(normalizeExtra("skill", { alwaysApply: true, model: "gpt-4o", provider: "openai" })).toEqual({})
  })

  it("keeps an agent model, drops inherit, and keeps aliases", () => {
    expect(normalizeExtra("agent", { model: "gpt-4o", provider: "openai" })).toEqual({
      model: "gpt-4o",
      provider: "openai",
    })
    expect(normalizeExtra("agent", { model: "inherit", provider: "openai" })).toEqual({})
    expect(normalizeExtra("agent", { model: "sonnet", provider: "anthropic" })).toEqual({ model: "sonnet" })
    expect(normalizeExtra("agent", { model: "task:vision" })).toEqual({ model: "task:vision" })
    expect(normalizeExtra("agent", { model: null, provider: null })).toEqual({})
  })
})

describe("agent model schema", () => {
  const base = {
    type: "agent" as const,
    name: "demo-agent",
    description: "A demo agent.",
    body: "",
  }

  it("rejects an unknown task, voice, and a provider beside a task", () => {
    expect(artifactInputSchema.safeParse({ ...base, extra: { model: "task:nope" } }).success).toBe(false)
    const voice = artifactInputSchema.safeParse({ ...base, extra: { model: "task:voice" } })
    expect(voice.success).toBe(false)
    if (!voice.success) expect(voice.error.issues[0]?.message).toBe('"voice" is not a chat model task')
    const both = artifactInputSchema.safeParse({
      ...base,
      extra: { model: "task:fast", provider: "openai" },
    })
    expect(both.success).toBe(false)
    if (!both.success) expect(both.error.issues[0]?.message).toBe("A task kind cannot set a provider")
  })

  it("accepts a model id and a task kind", () => {
    expect(artifactInputSchema.parse({ ...base, extra: { model: "gpt-4o", provider: "openai" } }).extra).toMatchObject({
      model: "gpt-4o",
      provider: "openai",
    })
    expect(artifactInputSchema.parse({ ...base, extra: { model: "task:reasoning" } }).extra.model).toBe("task:reasoning")
  })
})

describe("workspaceInputSchema", () => {
  it("requires a non-empty path", () => {
    expect(workspaceInputSchema.safeParse({ path: "" }).success).toBe(false)
    expect(workspaceInputSchema.safeParse({ path: "/tmp/x" }).success).toBe(true)
  })
})
