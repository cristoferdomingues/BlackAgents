import { z } from "zod"

/**
 * How sure Jev must be before the app uses its answer. Safe for the browser:
 * Settings shows these levels and the decision log next to each other.
 */

export const JEV_CUTOFF_LEVELS = ["careful", "balanced", "eager"] as const
export const jevCutoffLevelSchema = z.enum(JEV_CUTOFF_LEVELS)
export type JevCutoffLevel = z.infer<typeof jevCutoffLevelSchema>

export const JEV_CUTOFF_VALUES: Readonly<Record<JevCutoffLevel, number>> = {
  careful: 0.9,
  balanced: 0.85,
  eager: 0.7,
}

/** Decisions the user can tune. Skipping a scheduled run stays fixed. */
export const TUNABLE_DECISIONS = ["artifactRouting", "skillSuggest", "stepGate", "learning"] as const
export type TunableDecision = (typeof TUNABLE_DECISIONS)[number]

export const DECISION_KINDS = [...TUNABLE_DECISIONS, "preflight"] as const
export const decisionKindSchema = z.enum(DECISION_KINDS)
export type DecisionKind = z.infer<typeof decisionKindSchema>

export type JevCutoffLevels = Record<TunableDecision, JevCutoffLevel>
export type JevCutoffs = Record<TunableDecision, number>

export const DEFAULT_CUTOFF_LEVELS: Readonly<JevCutoffLevels> = {
  artifactRouting: "balanced",
  skillSuggest: "balanced",
  stepGate: "balanced",
  learning: "balanced",
}

/** Skip a scheduled run only when Jev is this sure and sees no action needed. */
export const PREFLIGHT_SKIP_CONFIDENCE = 0.95
export const PREFLIGHT_ACTION_NOUL_MAX = 0.05

export function cutoffValues(levels: JevCutoffLevels): JevCutoffs {
  return {
    artifactRouting: JEV_CUTOFF_VALUES[levels.artifactRouting],
    skillSuggest: JEV_CUTOFF_VALUES[levels.skillSuggest],
    stepGate: JEV_CUTOFF_VALUES[levels.stepGate],
    learning: JEV_CUTOFF_VALUES[levels.learning],
  }
}

export const DEFAULT_CUTOFFS: Readonly<JevCutoffs> = cutoffValues(DEFAULT_CUTOFF_LEVELS)

/**
 * - `acted` — the app used Jev's answer.
 * - `below` — Jev picked something, but was less sure than the cutoff.
 * - `pass` — Jev saw nothing to do, so the app kept its normal path.
 * - `error` — the call failed; the app kept its normal path.
 */
export const DECISION_OUTCOMES = ["acted", "below", "pass", "error"] as const
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number]

/** One Jev call. Never holds chat text: only the kind, the answer label, and the score. */
export const decisionLogEntrySchema = z.object({
  at: z.string().datetime(),
  kind: decisionKindSchema,
  choice: z.string().max(200),
  score: z.number().min(0).max(1).nullable(),
  cutoff: z.number().min(0).max(1),
  outcome: z.enum(DECISION_OUTCOMES),
  provider: z.enum(["direct", "openrouter"]),
})
export type DecisionLogEntry = z.infer<typeof decisionLogEntrySchema>
export type DecisionRecord = Omit<DecisionLogEntry, "at" | "provider">

export interface DecisionSummary {
  total: number
  acted: number
  below: number
  pass: number
  error: number
  /** Answers that pass or miss only on the score, so a level change would matter. */
  scored: number
  /** How many scored answers each level would use. */
  wouldUse: Record<JevCutoffLevel, number>
}

export function summarizeDecisions(entries: readonly DecisionLogEntry[], kind: DecisionKind): DecisionSummary {
  const own = entries.filter((entry) => entry.kind === kind)
  const scored = own.filter(
    (entry): entry is DecisionLogEntry & { score: number } =>
      (entry.outcome === "acted" || entry.outcome === "below") && entry.score !== null
  )
  const count = (outcome: DecisionOutcome): number => own.filter((entry) => entry.outcome === outcome).length
  const uses = (level: JevCutoffLevel): number =>
    scored.filter((entry) => entry.score >= JEV_CUTOFF_VALUES[level]).length
  const wouldUse = { careful: uses("careful"), balanced: uses("balanced"), eager: uses("eager") }
  return {
    total: own.length,
    acted: count("acted"),
    below: count("below"),
    pass: count("pass"),
    error: count("error"),
    scored: scored.length,
    wouldUse,
  }
}
