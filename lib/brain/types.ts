import { z } from "zod"

import { nameSchema } from "../artifacts/schemas"
import type { OkfConceptFrontmatter } from "../knowledge/schema"

/**
 * Second Brain domain types (isomorphic). Each agent has its own brain file
 * (approved memory notes); together with the shared workspace notes they form
 * the workspace brain. Every change goes through the review inbox.
 */

/** Characters of memory notes one chat or run gets. */
export const BRAIN_CONTEXT_BUDGET = 3_000

export const LEARNING_ACTIONS = [
  "nothing",
  "memory_note",
  "update_skill",
  "new_skill",
  "update_rule",
  "new_rule",
] as const
export type LearningAction = (typeof LEARNING_ACTIONS)[number]

/** Inbox kinds. `new_concept` is an OKF import, not something Jev drafts. */
export const PROPOSAL_KINDS = [
  "memory_note",
  "update_skill",
  "new_skill",
  "update_rule",
  "new_rule",
  "new_concept",
  "update_concept",
] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

export function isLearningAction(value: unknown): value is LearningAction {
  return typeof value === "string" && (LEARNING_ACTIONS as readonly string[]).includes(value)
}

export const feedbackSignalSchema = z.object({
  source: z.enum(["chat", "run"]),
  /** `feedback` = the user rated it; `self` = end-of-run self-assessment. */
  kind: z.enum(["feedback", "self"]).default("feedback"),
  agent: nameSchema.optional(),
  rating: z.enum(["up", "down"]).optional(),
  comment: z.string().trim().max(2_000).optional(),
  userMessage: z.string().max(4_000).default(""),
  reply: z.string().max(8_000).default(""),
  runId: z.string().max(100).optional(),
  provider: z.string().trim().optional(),
  model: z.string().trim().optional(),
})
export type FeedbackSignal = z.infer<typeof feedbackSignalSchema>

export interface ProposalTarget {
  type: "skill" | "rule" | "concept"
  name: string
}

export interface BrainProposal {
  id: string
  kind: ProposalKind
  /** Owner brain; absent = shared workspace notes. */
  agent?: string
  /** Artifact to create or update, or the concept id for `new_concept`. */
  target?: ProposalTarget
  /** OKF frontmatter kept until a `new_concept` proposal is approved. */
  concept?: OkfConceptFrontmatter
  title: string
  rationale: string
  /** Note text, or the full new markdown body for skill/rule kinds. */
  content: string
  description?: string
  source: {
    kind: FeedbackSignal["source"] | "import" | "memory" | "assistant"
    signal: FeedbackSignal["kind"]
    runId?: string
    rating?: "up" | "down"
    comment?: string
  }
  decision: { by: "jev" | "feedback"; confidence?: number; importance?: number }
  status: "pending" | "approved" | "rejected"
  createdAt: string
  resolvedAt?: string
}

export type FeedbackResult =
  | { kind: "recorded"; reason: string }
  | { kind: "proposed"; proposalId: string }

export interface BrainNote {
  date: string
  text: string
}

export interface BrainOverview {
  proposals: BrainProposal[]
  workspaceNotes: BrainNote[]
  agents: Array<{ name: string; notes: BrainNote[] }>
}

export const proposalDecisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  edits: z
    .object({
      content: z.string().min(1).max(20_000).optional(),
      description: z.string().trim().min(1).max(500).optional(),
    })
    .optional(),
})
export type ProposalDecisionInput = z.infer<typeof proposalDecisionSchema>
