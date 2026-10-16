import { BRAIN_CONTEXT_BUDGET, type BrainProposal, type ProposalKind } from "./types"

/** Plain-language help for the Brain screen (isomorphic). */

export const KIND_LABEL: Record<ProposalKind, string> = {
  memory_note: "Memory note",
  update_skill: "Update skill",
  new_skill: "New skill",
  update_rule: "Update rule",
  new_rule: "New rule",
  new_concept: "New concept",
  update_concept: "Update concept",
}

export const KIND_HELP: Record<ProposalKind, string> = {
  memory_note: "A short fact or preference. It is added to future chats and workflow runs.",
  update_skill: "Replaces the text of an existing skill with an improved version.",
  new_skill: "Creates a new skill: reference knowledge the assistant loads when a task matches.",
  update_rule: "Replaces the text of an existing rule with an improved version.",
  new_rule: "Creates a new rule: a short guardrail the assistant follows.",
  new_concept: "A durable fact from an OKF bundle. It is saved as knowledge, not as a memory note.",
  update_concept: "Replaces the text of a knowledge concept that is already saved.",
}

/** One sentence: what happens on Approve. */
export function approveEffect(proposal: Pick<BrainProposal, "kind" | "agent" | "target">): string {
  const who = proposal.agent ? `the ${proposal.agent} agent` : "every agent"
  const target = proposal.target?.name ?? "the artifact"
  switch (proposal.kind) {
    case "memory_note":
      return `Approve adds this note to the memory of ${who}.`
    case "update_skill":
      return `Approve rewrites the skill ${target} with the text below.`
    case "new_skill":
      return `Approve creates the skill ${target} in this workspace.`
    case "update_rule":
      return `Approve rewrites the rule ${target} with the text below.`
    case "new_rule":
      return `Approve creates the rule ${target} in this workspace.`
    case "new_concept":
      return `Approve saves ${target} into .black-agents/knowledge/ and marks it reviewed by you.`
    case "update_concept":
      return `Approve updates ${target} in .black-agents/knowledge/ and marks it reviewed by you.`
  }
}

/** Where a proposal came from, in plain words. */
export function proposalOrigin(proposal: Pick<BrainProposal, "source" | "decision">): string {
  if (proposal.source.kind === "import") return "From an OKF bundle you previewed."
  if (proposal.source.kind === "memory") return "From a memory note you chose to save as knowledge."
  if (proposal.source.kind === "assistant") return "From the Assistant. You asked to save it as knowledge."
  const from =
    proposal.source.signal === "self"
      ? "a workflow self-check"
      : proposal.source.kind === "run"
        ? "your feedback on a workflow run"
        : proposal.source.rating === "down"
          ? "your thumbs down in the Assistant"
          : proposal.source.rating === "up"
            ? "your thumbs up in the Assistant"
            : "your feedback in the Assistant"
  if (proposal.decision.by !== "jev") return `From ${from}.`
  const confidence = Math.round((proposal.decision.confidence ?? 0) * 100)
  return `From ${from}. Jev picked it (${confidence}% sure).`
}

export function scopeLabel(agent: string | undefined): string {
  return agent ? `Only ${agent}` : "All agents"
}

export const MEMORY_BUDGET_CHARS = BRAIN_CONTEXT_BUDGET

/** Total characters of memory notes, and whether they fit what one chat gets. */
export function memoryUsage(texts: readonly string[]): { chars: number; fits: boolean } {
  const chars = texts.reduce((sum, text) => sum + text.length, 0)
  return { chars, fits: chars <= MEMORY_BUDGET_CHARS }
}
