import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadBrainContext } from "@/lib/brain/context"
import {
  decideProposal,
  extractProposalDraft,
  MAX_PROPOSALS_PER_RUN,
  processSignal,
  ProposalError,
  selfAssessRun,
  validateDraft,
  type LearnDeps,
} from "@/lib/brain/learn"
import {
  appendNote,
  BRAIN_FILE_MAX_CHARS,
  listAgentBrains,
  listProposals,
  readNotes,
  readProposal,
} from "@/lib/brain/store"
import { feedbackSignalSchema, type FeedbackSignal } from "@/lib/brain/types"
import { scanWorkspace } from "@/lib/artifacts/parser"
import type { ResolvedDecisionClient } from "@/lib/decision/client"
import { newRun } from "@/lib/workflows/executor"
import { workflowSchema } from "@/lib/workflows/schema"

import { choiceAnswer, fakeJev } from "../../helpers/jev"
import { scriptedProvider } from "../../helpers/runtime"
import { makeTempEnv, seedArtifact, type TempEnv } from "../../helpers/workspace"

let env: TempEnv

const SKILL_BODY = "# Testing\n\n## When to Apply\n\nWhen writing tests.\n\n## Steps\n\n1. Write the test first.\n"

beforeEach(async () => {
  env = await makeTempEnv()
  await seedArtifact(env.workspace, ".cursor/agents/coder.md", "---\nname: coder\ndescription: Codes.\n---\nUse the `style` rule.\n")
  await seedArtifact(env.workspace, ".cursor/rules/style.mdc", "---\ndescription: House style.\nalwaysApply: true\n---\nUse short sentences.\n")
})

afterEach(async () => {
  await env.cleanup()
})

function signal(overrides: Partial<FeedbackSignal> = {}): FeedbackSignal {
  return feedbackSignalSchema.parse({
    source: "chat",
    agent: "coder",
    userMessage: "Write a function",
    reply: "function f() {}",
    ...overrides,
  })
}

function proposalReply(body: Record<string, unknown>): string {
  return `Here:\n\n\`\`\`proposal\n${JSON.stringify(body)}\n\`\`\``
}

function deps(reply: string | Error, jev: ResolvedDecisionClient | null = null): LearnDeps & { provider: ReturnType<typeof scriptedProvider> } {
  const provider = scriptedProvider([reply instanceof Error ? reply : { content: reply }])
  return {
    provider,
    decision: async () => jev,
    resolveLlm: async () => ({ provider, credentials: { apiKey: "k" }, secret: { apiKey: "k" }, model: "m" }),
    now: () => new Date("2026-10-07T12:00:00.000Z"),
  }
}

const learnJev = (action: string, confidence = 0.9, importance = 2.5) =>
  fakeJev({ action: choiceAnswer(action, confidence), importance: { type: "score", score: importance, confidence: 0.9, probabilities: {} } })

describe("brain store", () => {
  it("appends notes and drops the oldest past the cap", async () => {
    await appendNote(env.workspace, "coder", "Prefers   small\nfunctions", new Date("2026-10-01"))
    expect(await readNotes(env.workspace, "coder")).toEqual([{ date: "2026-10-01", text: "Prefers small functions" }])
    for (let i = 0; i < 40; i++) await appendNote(env.workspace, "coder", `note ${i} ${"x".repeat(400)}`)
    const file = await readFile(path.join(env.workspace, ".black-agents/brain/agents/coder.md"), "utf8")
    expect(file.length).toBeLessThanOrEqual(BRAIN_FILE_MAX_CHARS)
    const notes = await readNotes(env.workspace, "coder")
    expect(notes.at(-1)?.text).toContain("note 39")
    expect(notes[0].text).not.toContain("Prefers")
    expect((await listAgentBrains(env.workspace)).map((b) => b.name)).toEqual(["coder"])
  })

  it("rejects unsafe agent names and proposal ids", async () => {
    await expect(appendNote(env.workspace, "../x", "n")).rejects.toThrow()
    expect(await readProposal(env.workspace, "../../etc")).toBeNull()
  })
})

describe("brain context", () => {
  it("is empty without notes and lists notes that fit", async () => {
    expect(await loadBrainContext({ workspaceRoot: env.workspace, agent: "coder", task: "t", resolved: null })).toBe("")
    await appendNote(env.workspace, undefined, "Repo uses pnpm")
    await appendNote(env.workspace, "coder", "Likes tests")
    const text = await loadBrainContext({ workspaceRoot: env.workspace, agent: "coder", task: "t", resolved: null })
    expect(text).toContain("## Memory notes")
    expect(text).toContain("(workspace,")
    expect(text).toContain("Likes tests")
  })

  it("uses Jev relevance when notes do not fit", async () => {
    for (let i = 0; i < 12; i++) await appendNote(env.workspace, "coder", `fact ${i} ${"y".repeat(400)}`)
    const answers = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`note_${i}`, { type: "noul", noul: i === 3 ? 0.9 : 0.1 }])
    )
    const jev = fakeJev(answers)
    const text = await loadBrainContext({ workspaceRoot: env.workspace, agent: "coder", task: "t", resolved: jev })
    expect(text.match(/fact \d+/g)).toEqual(["fact 3"])
    const fallback = await loadBrainContext({ workspaceRoot: env.workspace, agent: "coder", task: "t", resolved: fakeJev(new Error("x")) })
    expect(fallback).toContain("fact 11")
    expect(fallback).not.toContain("fact 0 ")
  })
})

describe("proposal drafts", () => {
  it("parses and validates drafts against the workspace", async () => {
    const all = await scanWorkspace(env.workspace)
    expect(extractProposalDraft("no block")).toBeNull()
    expect(extractProposalDraft("```proposal\n{bad\n```")).toBeNull()
    const draft = extractProposalDraft(proposalReply({ action: "update_rule", content: "New text", target: { type: "rule", name: "style" } }))
    expect(draft && validateDraft(draft, all)).toBeNull()
    expect(validateDraft({ action: "update_rule", rationale: "", content: "x", target: { type: "rule", name: "ghost" } }, all)).toContain("does not exist")
    expect(validateDraft({ action: "new_rule", rationale: "", content: "x", description: "d", target: { type: "rule", name: "style" } }, all)).toContain("already exists")
    expect(validateDraft({ action: "new_skill", rationale: "", content: "no sections", description: "d", target: { type: "skill", name: "testing" } }, all)).not.toBeNull()
    expect(validateDraft({ action: "update_skill", rationale: "", content: "x" }, all)).toContain("target")
    expect(validateDraft({ action: "memory_note", rationale: "", content: " " }, all)).toContain("empty")
  })
})

describe("processSignal", () => {
  it("only records positive feedback without Jev", async () => {
    const d = deps(proposalReply({ action: "memory_note", content: "x" }))
    expect(await processSignal(env.workspace, signal({ rating: "up" }), d)).toMatchObject({ kind: "recorded" })
    expect(await processSignal(env.workspace, signal({ kind: "self" }), d)).toMatchObject({ kind: "recorded" })
    expect(d.provider.requests).toHaveLength(0)
  })

  it("drafts a proposal from explicit feedback without Jev", async () => {
    const d = deps(proposalReply({ action: "memory_note", title: "Use pnpm", content: "The repo uses pnpm" }))
    const result = await processSignal(env.workspace, signal({ rating: "down", comment: "We use pnpm, not npm" }), d)
    expect(result.kind).toBe("proposed")
    const [proposal] = await listProposals(env.workspace)
    expect(proposal).toMatchObject({ kind: "memory_note", agent: "coder", status: "pending", decision: { by: "feedback" } })
    expect(d.provider.requests[0].messages[0].content).toContain("We use pnpm, not npm")
  })

  it("follows Jev: skip unimportant, draft important", async () => {
    expect(await processSignal(env.workspace, signal({ rating: "up" }), deps("", learnJev("memory_note", 0.9, 1)))).toMatchObject({ kind: "recorded" })
    expect(await processSignal(env.workspace, signal(), deps("", learnJev("nothing", 0.99)))).toMatchObject({ kind: "recorded" })
    expect(await processSignal(env.workspace, signal(), deps("", learnJev("new_rule", 0.6)))).toMatchObject({ kind: "recorded" })

    const d = deps(
      proposalReply({ action: "update_rule", content: "Use short, plain sentences.", target: { type: "rule", name: "style" } }),
      learnJev("update_rule")
    )
    const result = await processSignal(env.workspace, signal({ rating: "up" }), d)
    expect(result.kind).toBe("proposed")
    expect(d.provider.requests[0].messages[0].content).toContain('chose the action "update_rule"')
    expect((await listProposals(env.workspace))[0].decision).toMatchObject({ by: "jev", importance: 2.5 })
  })

  it("records unusable drafts and provider failures", async () => {
    const explicit = signal({ comment: "fix it" })
    expect(await processSignal(env.workspace, explicit, deps("no block here"))).toMatchObject({ kind: "recorded" })
    expect(await processSignal(env.workspace, explicit, deps(new Error("down")))).toMatchObject({ kind: "recorded" })
    expect(
      await processSignal(env.workspace, explicit, deps(proposalReply({ action: "update_skill", content: "x", target: { type: "skill", name: "ghost" } })))
    ).toMatchObject({ kind: "recorded", reason: expect.stringContaining("does not exist") })
    const log = await readFile(path.join(env.workspace, ".black-agents/brain/log.jsonl"), "utf8")
    expect(log.trim().split("\n")).toHaveLength(3)
  })

  it("caps proposals per run", async () => {
    const reply = proposalReply({ action: "memory_note", content: "note" })
    for (let i = 0; i < MAX_PROPOSALS_PER_RUN; i++) {
      expect((await processSignal(env.workspace, signal({ comment: "c", runId: "r1" }), deps(reply))).kind).toBe("proposed")
    }
    expect(await processSignal(env.workspace, signal({ comment: "c", runId: "r1" }), deps(reply))).toMatchObject({
      kind: "recorded",
      reason: expect.stringContaining("this run"),
    })
  })
})

describe("decideProposal", () => {
  async function propose(body: Record<string, unknown>): Promise<string> {
    const result = await processSignal(env.workspace, signal({ comment: "c" }), deps(proposalReply(body)))
    if (result.kind !== "proposed") throw new Error(`not proposed: ${result.reason}`)
    return result.proposalId
  }

  it("applies a memory note with edits", async () => {
    const id = await propose({ action: "memory_note", content: "Uses pnpm" })
    const applied = await decideProposal(env.workspace, id, { action: "approve", edits: { content: "Uses pnpm 9" } })
    expect(applied.status).toBe("approved")
    expect((await readNotes(env.workspace, "coder")).map((n) => n.text)).toEqual(["Uses pnpm 9"])
    await expect(decideProposal(env.workspace, id, { action: "reject" })).rejects.toMatchObject({ status: 409 })
  })

  it("updates a rule and keeps its frontmatter", async () => {
    const id = await propose({ action: "update_rule", content: "Use plain words.", target: { type: "rule", name: "style" } })
    await decideProposal(env.workspace, id, { action: "approve" })
    const file = await readFile(path.join(env.workspace, ".cursor/rules/style.mdc"), "utf8")
    expect(file).toContain("alwaysApply: true")
    expect(file).toContain("description: House style.")
    expect(file).toContain("Use plain words.")
  })

  it("creates a new skill", async () => {
    const id = await propose({
      action: "new_skill",
      content: SKILL_BODY,
      description: "How to write tests.",
      target: { type: "skill", name: "testing" },
    })
    await decideProposal(env.workspace, id, { action: "approve" })
    expect((await scanWorkspace(env.workspace)).some((a) => a.type === "skill" && a.name === "testing")).toBe(true)
  })

  it("rejects without changing files and reports missing proposals", async () => {
    const id = await propose({ action: "update_rule", content: "Changed", target: { type: "rule", name: "style" } })
    expect((await decideProposal(env.workspace, id, { action: "reject" })).status).toBe("rejected")
    expect(await readFile(path.join(env.workspace, ".cursor/rules/style.mdc"), "utf8")).toContain("Use short sentences.")
    await expect(decideProposal(env.workspace, "missing", { action: "reject" })).rejects.toBeInstanceOf(ProposalError)
  })
})

describe("selfAssessRun", () => {
  it("sends each finished step as a self signal when enabled", async () => {
    const wf = workflowSchema.parse({ name: "w", selfAssess: true, steps: [{ id: "a", agent: "coder" }] })
    const run = newRun({ id: "r", workflow: wf, workspaceRoot: env.workspace, trigger: "manual", task: "t" })
    run.status = "succeeded"
    run.steps[0] = { ...run.steps[0], status: "succeeded", output: "did it" }
    const d = deps(proposalReply({ action: "memory_note", content: "Lesson" }), learnJev("memory_note"))
    expect(await selfAssessRun(run, wf, d)).toEqual([{ kind: "proposed", proposalId: expect.any(String) }])
    expect(await selfAssessRun(run, { ...wf, selfAssess: false }, d)).toEqual([])
  })
})
