import { choice, noul, score, type NoulQuestion } from "@typesafe-ai/sdk"

import { isLearningAction, type FeedbackSignal, type LearningAction } from "@/lib/brain/types"

import {
  DECISION_REQUEST_OPTIONS,
  decisionErrorMessage,
  type ResolvedDecisionClient,
} from "./client"

/** Act on a learning decision only at this confidence and importance. */
export const LEARNING_MIN_CONFIDENCE = 0.85
export const LEARNING_MIN_IMPORTANCE = 2
/** A note is relevant to a task when its noul is at least this. */
export const NOTE_RELEVANCE_MIN_NOUL = 0.5
export const MAX_NOTES_PER_RELEVANCE_CALL = 12

const TEXT_MAX = 3_000

function clip(text: string | undefined): string {
  if (!text) return ""
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text
}

export type LearningDecision =
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "decided"; action: LearningAction; confidence: number; importance: number; model: string }

/**
 * Is there something worth remembering in this interaction, and what kind
 * of change would capture it? Never throws.
 */
export async function evaluateLearning(params: {
  resolved: ResolvedDecisionClient | null
  signal: FeedbackSignal
  skills: string[]
  rules: string[]
}): Promise<LearningDecision> {
  if (!params.resolved) return { kind: "unavailable" }
  const { signal } = params
  try {
    const result = await params.resolved.client.systemOne(
      {
        state: {
          trigger: signal.kind === "self" ? "self_assessment" : "user_feedback",
          source: signal.source,
          agent: signal.agent ?? null,
          rating: signal.rating ?? null,
          comment: clip(signal.comment),
          task: clip(signal.userMessage),
          reply: clip(signal.reply),
          existingSkills: params.skills.slice(0, 60),
          existingRules: params.rules.slice(0, 60),
        },
        questions: {
          action: choice("What should the workspace learn from this?", {
            nothing: "Nothing reusable; a one-off or already covered.",
            memory_note: "A short fact or preference this agent should remember.",
            update_skill: "An existing skill should change.",
            new_skill: "A new reusable procedure should become a skill.",
            update_rule: "An existing rule should change.",
            new_rule: "A new always-true constraint should become a rule.",
          }),
          importance: score("How much would remembering this improve future work?", [
            "Not at all",
            "A little",
            "Clearly useful",
            "Very important",
          ]),
        },
      },
      DECISION_REQUEST_OPTIONS
    )
    const action = result.answers.action
    if (!isLearningAction(action.choice)) {
      return { kind: "error", message: `Unknown learning action: ${action.choice}` }
    }
    return {
      kind: "decided",
      action: action.choice,
      confidence: action.confidence,
      importance: result.answers.importance.score,
      model: result.model,
    }
  } catch (err) {
    return { kind: "error", message: decisionErrorMessage(err, "Jev learning decision failed") }
  }
}

export type NoteRelevance =
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ranked"; relevant: number[] }

/** Which notes matter for this task (indexes into `notes`). Never throws. */
export async function evaluateNoteRelevance(params: {
  resolved: ResolvedDecisionClient | null
  task: string
  notes: string[]
}): Promise<NoteRelevance> {
  if (!params.resolved) return { kind: "unavailable" }
  const notes = params.notes.slice(0, MAX_NOTES_PER_RELEVANCE_CALL)
  if (notes.length === 0) return { kind: "ranked", relevant: [] }
  try {
    const questions: Record<string, NoulQuestion> = Object.fromEntries(
      notes.map((note, i) => [
        `note_${i}`,
        noul(`Does this memory note help with the task? Note: ${note.slice(0, 400)}`),
      ])
    )
    const result = await params.resolved.client.systemOne(
      { state: { trigger: "brain_context", task: clip(params.task) }, questions },
      DECISION_REQUEST_OPTIONS
    )
    const relevant = notes
      .map((_, i) => i)
      .filter((i) => (result.answers[`note_${i}`]?.noul ?? 0) >= NOTE_RELEVANCE_MIN_NOUL)
    return { kind: "ranked", relevant }
  } catch (err) {
    return { kind: "error", message: decisionErrorMessage(err, "Jev relevance check failed") }
  }
}
