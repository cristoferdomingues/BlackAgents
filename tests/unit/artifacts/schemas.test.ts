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
    expect(normalizeExtra("skill", { alwaysApply: true })).toEqual({})
  })
})

describe("workspaceInputSchema", () => {
  it("requires a non-empty path", () => {
    expect(workspaceInputSchema.safeParse({ path: "" }).success).toBe(false)
    expect(workspaceInputSchema.safeParse({ path: "/tmp/x" }).success).toBe(true)
  })
})
