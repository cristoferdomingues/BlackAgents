import { describe, expect, it } from "vitest"

import {
  editorChecks,
  firstSentence,
  ruleActivationOf,
  ruleFieldsFor,
  suggestName,
  toKebabWhileTyping,
} from "@/lib/artifacts/editor-helpers"
import { STANDARDS_SPEC } from "@/lib/standards/default-standards"

describe("rule activation", () => {
  it("derives the activation from alwaysApply and globs", () => {
    expect(ruleActivationOf(true, [])).toBe("always")
    expect(ruleActivationOf(true, ["*.ts"])).toBe("always")
    expect(ruleActivationOf(false, ["*.ts"])).toBe("files")
    expect(ruleActivationOf(false, [])).toBe("request")
  })

  it("keeps globs only for the files activation", () => {
    expect(ruleFieldsFor("always", ["*.ts"])).toEqual({ alwaysApply: true, globs: [] })
    expect(ruleFieldsFor("files", ["*.ts"])).toEqual({ alwaysApply: false, globs: ["*.ts"] })
    expect(ruleFieldsFor("request", ["*.ts"])).toEqual({ alwaysApply: false, globs: [] })
  })

  it("round-trips every activation", () => {
    for (const activation of ["always", "files", "request"] as const) {
      const fields = ruleFieldsFor(activation, ["**/*.md"])
      expect(ruleActivationOf(fields.alwaysApply, fields.globs)).toBe(activation)
    }
  })
})

describe("suggestName", () => {
  it("keeps the first meaningful words in kebab-case", () => {
    expect(suggestName("Reviews pull requests for security issues")).toBe("reviews-pull-requests")
    expect(suggestName("An agent that writes tests")).toBe("writes-tests")
  })

  it("strips accents and symbols", () => {
    expect(suggestName("Revisão de código!")).toBe("revisao-de-codigo")
    expect(suggestName("  C++ / API   docs ")).toBe("c-api-docs")
  })

  it("falls back to stop words and to empty", () => {
    expect(suggestName("use it")).toBe("use-it")
    expect(suggestName("!!!")).toBe("")
  })

  it("never returns more than 40 characters", () => {
    const name = suggestName("internationalization localization accessibility")
    expect(name.length).toBeLessThanOrEqual(40)
    expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })
})

describe("toKebabWhileTyping", () => {
  it("lowercases and joins words with single hyphens", () => {
    expect(toKebabWhileTyping("My Agent")).toBe("my-agent")
    expect(toKebabWhileTyping("my__agent  two")).toBe("my-agent-two")
    expect(toKebabWhileTyping("a--b")).toBe("a-b")
  })

  it("keeps a trailing hyphen so the user can keep typing", () => {
    expect(toKebabWhileTyping("my-")).toBe("my-")
    expect(toKebabWhileTyping("-lead")).toBe("lead")
  })

  it("removes characters outside kebab-case", () => {
    expect(toKebabWhileTyping("agent@1!")).toBe("agent1")
  })
})

describe("firstSentence", () => {
  it("returns the first sentence", () => {
    expect(firstSentence("Reviews code. Then reports.")).toBe("Reviews code.")
    expect(firstSentence("No end mark")).toBe("No end mark")
  })

  it("cuts long text with an ellipsis", () => {
    const out = firstSentence("x".repeat(300), 20)
    expect(out).toHaveLength(20)
    expect(out.endsWith("…")).toBe(true)
  })
})

describe("editorChecks", () => {
  it("passes every check for a complete agent", () => {
    const checks = editorChecks({
      type: "agent",
      name: "reviewer",
      description: "Reviews code.",
      body: STANDARDS_SPEC.agent.bodyTemplate("reviewer"),
    })
    expect(checks.every((c) => c.ok)).toBe(true)
    expect(checks.map((c) => c.id)).toContain("section:Workflow")
  })

  it("flags a bad name, an empty description and an empty body as errors", () => {
    const checks = editorChecks({ type: "command", name: "Bad Name", description: " ", body: "" })
    const failed = checks.filter((c) => !c.ok)
    expect(failed.map((c) => c.id)).toEqual(
      expect.arrayContaining(["name", "description", "body"])
    )
    expect(checks.find((c) => c.id === "name")?.severity).toBe("error")
    expect(checks.find((c) => c.id === "section:Steps")?.severity).toBe("warning")
  })

  it("flags frontmatter pasted into the body", () => {
    const checks = editorChecks({ type: "rule", name: "r", description: "d", body: "---\nx: 1\n---\n" })
    expect(checks.find((c) => c.id === "frontmatter")?.ok).toBe(false)
  })

  it("warns when a skill description does not say when to use it", () => {
    const vague = editorChecks({ type: "skill", name: "s", description: "Database stuff", body: "## When to Apply\n- x" })
    expect(vague.find((c) => c.id === "trigger")).toMatchObject({ ok: false, severity: "warning" })
    const clear = editorChecks({ type: "skill", name: "s", description: "Use when migrating", body: "## When to Apply\n- x" })
    expect(clear.find((c) => c.id === "trigger")?.ok).toBe(true)
    expect(vague.find((c) => c.id === "section:When to Apply")?.severity).toBe("error")
  })

  it("fails a rule that is too long", () => {
    const body = Array.from({ length: 41 }, (_, i) => `- line ${i}`).join("\n")
    const checks = editorChecks({ type: "rule", name: "r", description: "d", body })
    expect(checks.find((c) => c.id === "short")?.ok).toBe(false)
    expect(editorChecks({ type: "rule", name: "r", description: "d", body: "- ok" }).find((c) => c.id === "short")?.ok).toBe(true)
  })
})
