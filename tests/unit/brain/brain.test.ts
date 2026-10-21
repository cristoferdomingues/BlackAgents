import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadBrainContext } from "@/lib/brain/context"
import {
  decideProposal,
  extractProposalDraft,
  MAX_PROPOSALS_PER_RUN,
  processSignal,
  proposeConceptReverification,
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
import { readConcept } from "@/lib/knowledge/store"
import { scanWorkspace } from "@/lib/artifacts/parser"
import type { ResolvedDecisionClient } from "@/lib/decision/client"
import { newRun } from "@/lib/workflows/executor"
import { workflowSchema } from "@/lib/workflows/schema"

import { choiceAnswer, fakeJev, loggedJev } from "../../helpers/jev"
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

  it("records learning answers against the user's level", async () => {
    const answer = (action: string, confidence: number, importance: number, cutoff?: number) =>
      loggedJev(
        { action: choiceAnswer(action, confidence), importance: { type: "score", score: importance, confidence: 0.9, probabilities: {} } },
        cutoff === undefined ? undefined : { learning: cutoff }
      )
    const unimportant = answer("memory_note", 0.95, 1)
    await processSignal(env.workspace, signal(), deps("", unimportant))
    expect(unimportant.records[0]).toMatchObject({ kind: "learning", outcome: "pass", choice: "memory_note (importance 1)" })

    const unsure = answer("new_rule", 0.88, 3, 0.9)
    expect(await processSignal(env.workspace, signal(), deps("", unsure))).toMatchObject({ kind: "recorded" })
    expect(unsure.records[0]).toMatchObject({ outcome: "below", score: 0.88, cutoff: 0.9 })

    const failing = loggedJev(new Error("down"))
    await processSignal(env.workspace, signal({ rating: "up" }), deps("", failing))
    expect(failing.records[0]).toMatchObject({ kind: "learning", outcome: "error", score: null })
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

  it("queues one re-verification request and approval only verifies the current concept", async () => {
    await seedArtifact(
      env.workspace,
      ".black-agents/knowledge/architecture/workflows.md",
      [
        "---",
        "type: Reference",
        "title: Workflows",
        "generated:",
        "  by: agent:cursor",
        "  at: '2026-10-19T12:00:00Z'",
        "verified:",
        "  - by: human:local",
        "    at: '2026-10-16T12:00:00Z'",
        "---",
        "",
        "# Workflows",
        "",
        "Current body.",
        "",
      ].join("\n")
    )

    const first = await proposeConceptReverification(
      env.workspace,
      {
        conceptId: "architecture/workflows",
        reason: "Generated after its latest human verification.",
        runId: "run-1",
      },
      new Date("2026-10-19T13:00:00.000Z")
    )
    const duplicate = await proposeConceptReverification(env.workspace, {
      conceptId: "architecture/workflows",
      reason: "Same finding again.",
      runId: "run-1",
    })
    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ created: false, proposal: { id: first.proposal.id } })
    expect(first.proposal).toMatchObject({
      kind: "reverify_concept",
      target: { type: "concept", name: "architecture/workflows" },
      source: { kind: "run", signal: "self", runId: "run-1" },
    })

    const before = await readConcept(env.workspace, "architecture/workflows")
    await decideProposal(
      env.workspace,
      first.proposal.id,
      { action: "approve" },
      new Date("2026-10-20T09:30:00.000Z")
    )
    const after = await readConcept(env.workspace, "architecture/workflows")
    expect(after?.body).toBe(before?.body)
    expect(after?.frontmatter.generated).toEqual(before?.frontmatter.generated)
    expect(after?.frontmatter.verified?.at(-1)).toEqual({
      by: "human:local",
      at: "2026-10-20T09:30:00Z",
    })

    await expect(
      proposeConceptReverification(env.workspace, {
        conceptId: "missing",
        reason: "Missing.",
      })
    ).rejects.toMatchObject({ status: 404 })
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

  function reviewRun(reviewOutput: string, selfAssess = true) {
    const wf = workflowSchema.parse({
      name: "w",
      selfAssess,
      steps: [
        { id: "build", agent: "coder", instructions: "Write the login form" },
        { id: "review", agent: "reviewer", review: true },
      ],
    })
    const run = newRun({ id: "r", workflow: wf, workspaceRoot: env.workspace, trigger: "manual", task: "Add login" })
    run.status = "succeeded"
    run.steps[0] = { ...run.steps[0], status: "succeeded", output: "form.tsx written" }
    run.steps[1] = { ...run.steps[1], status: "succeeded", output: reviewOutput }
    return { wf, run }
  }

  it("turns a reviewer reject into thumbs-down feedback for the reviewed agent, even without Jev", async () => {
    const { wf, run } = reviewRun("- No input validation\n- No tests\nVERDICT: reject")
    const d = deps(proposalReply({ action: "update_rule", content: "Validate every input with zod.", target: { type: "rule", name: "style" } }))
    const results = await selfAssessRun(run, wf, d)
    expect(results[0]).toEqual({ kind: "proposed", proposalId: expect.any(String) })
    expect(results.slice(1).every((r) => r.kind === "recorded")).toBe(true)

    const prompt = d.provider.requests[0].messages[0].content
    expect(prompt).toContain('Reviewer \\"reviewer\\" (step \\"review\\") rejected this work')
    expect(prompt).toContain("No input validation")
    expect(prompt).not.toContain("VERDICT: reject")
    expect(prompt).toContain("Write the login form")
    expect(prompt).toContain("form.tsx written")

    const [proposal] = await listProposals(env.workspace)
    expect(proposal).toMatchObject({
      kind: "update_rule",
      agent: "coder",
      target: { type: "rule", name: "style" },
      source: { kind: "run", signal: "feedback", rating: "down", runId: "r" },
    })
  })

  it("sends no review feedback on approve, missing verdict, or when selfAssess is off", async () => {
    for (const [output, selfAssess] of [
      ["Fine.\nVERDICT: approve", true],
      ["I think it is wrong.", true],
      ["Bad.\nVERDICT: reject", false],
    ] as const) {
      const { wf, run } = reviewRun(output, selfAssess)
      const d = deps(proposalReply({ action: "memory_note", content: "x" }))
      const results = await selfAssessRun(run, wf, d)
      expect(results.every((r) => r.kind === "recorded")).toBe(true)
      expect(d.provider.requests).toHaveLength(0)
    }
  })

  it("does not send review feedback to a reviewed review step", async () => {
    const wf = workflowSchema.parse({
      name: "w",
      selfAssess: true,
      steps: [
        { id: "first-review", agent: "reviewer", review: true },
        { id: "second-review", agent: "coder", review: true },
      ],
    })
    const run = newRun({ id: "r", workflow: wf, workspaceRoot: env.workspace, trigger: "manual", task: "t" })
    run.status = "succeeded"
    run.steps[0] = { ...run.steps[0], status: "succeeded", output: "VERDICT: approve" }
    run.steps[1] = { ...run.steps[1], status: "succeeded", output: "VERDICT: reject" }
    const d = deps(proposalReply({ action: "memory_note", content: "x" }))
    await selfAssessRun(run, wf, d)
    expect(d.provider.requests).toHaveLength(0)
  })
})
