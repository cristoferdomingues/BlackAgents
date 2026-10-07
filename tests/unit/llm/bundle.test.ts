import { describe, expect, it } from "vitest"

import type { Artifact } from "@/lib/artifacts/types"
import { extractBundle, stripBundleBlock, validateBundle } from "@/lib/llm/bundle"
import { buildSystemContext } from "@/lib/llm/context"
import { checkArtifactStandards } from "@/lib/standards/checks"

import { makeTempEnv } from "../../helpers/workspace"

const AGENT_BODY = `## Input\nA PR.\n## Workflow\nUse the \`review-checklist\` skill and the \`short-comments\` rule.\n## Output\nComments.\n## Error handling\nAsk.`

function reply(bundle: unknown): string {
  return `Here is a team.\n\n\`\`\`bundle\n${JSON.stringify(bundle)}\n\`\`\`\nDone.`
}

const good = {
  summary: "PR review team",
  agent: { name: "pr-reviewer", description: "Reviews PRs", body: AGENT_BODY, tools: ["fs_read"] },
  skills: [{ name: "review-checklist", description: "Checklist", body: "## When to Apply\n- reviews\n" }],
  rules: [{ name: "short-comments", description: "Be brief", body: "- Keep comments short." }],
}

describe("extractBundle", () => {
  it("parses a bundle with skills and rules before the agent", () => {
    const bundle = extractBundle(reply(good))
    expect(bundle?.summary).toBe("PR review team")
    expect(bundle?.items.map((i) => `${i.type}:${i.name}`)).toEqual([
      "skill:review-checklist",
      "rule:short-comments",
      "agent:pr-reviewer",
    ])
    expect(bundle?.items[2].extra.tools).toEqual(["fs_read"])
    expect(stripBundleBlock(reply(good))).toBe("Here is a team.\n\n\nDone.")
  })

  it("returns null for missing, invalid, oversized, or empty bundles", () => {
    expect(extractBundle("no block")).toBeNull()
    expect(extractBundle("```bundle\n{not json}\n```")).toBeNull()
    expect(extractBundle(reply({ ...good, skills: [1, 2, 3, 4].map((n) => ({ ...good.skills[0], name: `s${n}` })) }))).toBeNull()
    expect(extractBundle(reply({ skills: [], rules: [] }))).toBeNull()
    expect(extractBundle(reply({ agent: { ...good.agent, name: "Bad Name" } }))).toBeNull()
  })
})

describe("validateBundle", () => {
  it("accepts a linked, standards-compliant bundle", () => {
    const bundle = extractBundle(reply(good))
    expect(bundle && validateBundle(bundle, []).ok).toBe(true)
  })

  it("flags missing links, clashes, duplicates, and standards errors", () => {
    const bad = {
      agent: { ...good.agent, body: "## Input\nx" },
      skills: [
        { name: "review-checklist", description: "dup", body: "no section" },
        { name: "review-checklist", description: "dup", body: "## When to Apply\n- x" },
      ],
      rules: [{ name: "short-comments", description: "long", body: "- x\n".repeat(41) }],
    }
    const bundle = extractBundle(reply(bad))
    if (!bundle) throw new Error("bundle expected")
    const existing: Artifact[] = [
      { type: "rule", name: "short-comments", platform: "cursor", description: "", frontmatter: {}, body: "", relativePath: "" },
    ]
    const report = validateBundle(bundle, existing)
    expect(report.ok).toBe(false)
    const messages = report.items.flatMap((i) => i.issues.map((x) => `${i.name}: ${x.message}`))
    expect(messages).toEqual(
      expect.arrayContaining([
        'review-checklist: Missing "## When to Apply" section',
        "review-checklist: Duplicate name inside the bundle",
        'short-comments: A rule named "short-comments" already exists',
        expect.stringContaining("short-comments: Rules must stay short"),
        "pr-reviewer: Agent body must reference `review-checklist` skill",
        "pr-reviewer: Agent body must reference `short-comments` rule",
      ])
    )
  })
})

describe("checkArtifactStandards", () => {
  it("warns on missing agent sections and errors on bad names or frontmatter", () => {
    const issues = checkArtifactStandards({ type: "agent", name: "Bad", description: "", body: "---\nname: x\n---" })
    expect(issues.filter((i) => i.severity === "error").map((i) => i.message)).toEqual([
      "Name must be kebab-case (max 80 chars)",
      "Description is required",
      "Body must not include YAML frontmatter",
    ])
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("Workflow"))).toBe(true)
  })
})

describe("system context", () => {
  it("documents the bundle protocol", async () => {
    const env = await makeTempEnv()
    const context = await buildSystemContext().finally(() => env.cleanup())
    expect(context).toContain("## Bundle protocol")
    expect(context).toContain("shell_run")
  })
})
