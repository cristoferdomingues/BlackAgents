import {
  JEV_CUTOFF_VALUES,
  PREFLIGHT_SKIP_CONFIDENCE,
  type DecisionKind,
  type DecisionLogEntry,
  type DecisionOutcome,
  type DecisionSummary,
  type JevCutoffLevel,
  type TunableDecision,
} from "./cutoffs"

/** Plain-language copy for the Jev decisions screen (safe for the browser). */

export const DECISIONS_TITLE = "Jev decisions"

export const DECISIONS_INTRO =
  "See what Jev decided lately. Choose how sure Jev must be before the app uses its answer."

export const CUTOFFS_TITLE = "How sure Jev must be"

export const CUTOFFS_INTRO =
  "Jev gives each answer a score. The app uses the answer only when the score reaches the level you pick. Below it, the app does what it does without Jev."

export const RECENT_TITLE = "Recent decisions"

export const DECISIONS_WHERE =
  "Saved in ~/.black-agents/jev-decisions.json. It keeps the kind of decision, Jev's answer, and the score. It never keeps your chat text."

export const CLEAR_EFFECT = "Clear decisions removes this list. Your levels stay as they are."
export const CLEAR_DIALOG_TITLE = "Clear the decision list?"
export const LEVEL_SAVE_EFFECT = "A new level is saved at once and used on the next decision."

export const DECISIONS_LOAD_ERROR = "Could not load Jev decisions."

export const EMPTY_TITLE = "No Jev decisions yet"

export function emptyText(jevEnabled: boolean): string {
  const fill = "Chat, run a workflow with a step check, or rate a reply. Each answer from Jev shows up here."
  return jevEnabled ? fill : `Turn on Use Jev above first. ${fill}`
}

export const LEVEL_LABELS: Readonly<Record<JevCutoffLevel, string>> = {
  careful: "Careful",
  balanced: "Balanced",
  eager: "Eager",
}

export const LEVEL_SUMMARIES: Readonly<Record<JevCutoffLevel, string>> = {
  careful: "Uses only answers Jev is very sure about.",
  balanced: "The default. A good mix.",
  eager: "Uses more answers. Some may be wrong.",
}

export const LEVEL_RISK: Readonly<Record<JevCutoffLevel, "low" | "medium">> = {
  careful: "low",
  balanced: "low",
  eager: "medium",
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function levelLabel(level: JevCutoffLevel): string {
  return `${LEVEL_LABELS[level]} · ${percent(JEV_CUTOFF_VALUES[level])}`
}

export const DECISION_LABELS: Readonly<Record<DecisionKind, string>> = {
  artifactRouting: "Pick a file for the chat",
  skillSuggest: "Suggest a skill",
  stepGate: "Check a workflow step",
  learning: "Learn from feedback",
  preflight: "Skip a scheduled run",
}

export const DECISION_HELP: Readonly<Record<TunableDecision, string>> = {
  artifactRouting:
    "When you do not name an agent, rule, or skill, Jev picks one to add to the chat. A wrong pick only adds extra context, so a lower level is fine.",
  skillSuggest: "Jev suggests a skill that fits your message. You still choose to use it.",
  stepGate:
    "After a workflow step, Jev says continue, try again, or stop. A wrong stop ends the run early, so keep this level high.",
  learning:
    "Jev decides if a reply or rating holds something worth remembering. A wrong answer adds noise to the Brain inbox, so keep this level high.",
}

/** Decisions where a wrong answer costs more; Eager shows a warning. */
export const HIGH_STAKES: ReadonlySet<TunableDecision> = new Set<TunableDecision>(["stepGate", "learning"])

export const EAGER_WARNING =
  "Eager is risky here. Jev may act on answers it is not sure about."

export const PREFLIGHT_FIXED = `Fixed at ${percent(PREFLIGHT_SKIP_CONFIDENCE)}. A wrong skip misses real work, so this level does not change.`

export const OUTCOME_LABELS: Readonly<Record<DecisionOutcome, string>> = {
  acted: "Used",
  below: "Below level",
  pass: "No change",
  error: "Failed",
}

export const OUTCOME_HELP: Readonly<Record<DecisionOutcome, string>> = {
  acted: "The app used Jev's answer.",
  below: "Jev had an answer, but its score was under your level. The app did not use it.",
  pass: "Jev saw nothing to do, so the app kept its normal path.",
  error: "The call to Jev failed. The app kept its normal path.",
}

export function summaryLine(summary: DecisionSummary): string {
  if (summary.total === 0) return "No decisions yet."
  const parts = [`${summary.acted} used`, `${summary.below} below level`, `${summary.pass} no change`]
  if (summary.error > 0) parts.push(`${summary.error} failed`)
  return `Last ${summary.total}: ${parts.join(", ")}.`
}

/** "Would use 4 of 6" — only when some answers depend on the level. */
export function wouldUseLine(summary: DecisionSummary, level: JevCutoffLevel): string | null {
  if (summary.scored === 0) return null
  return `Would use ${summary.wouldUse[level]} of ${summary.scored}`
}

export function choiceLabel(entry: Pick<DecisionLogEntry, "kind" | "choice">): string {
  if (entry.choice === "error") return "—"
  if (entry.choice === "none" || entry.choice === "nothing") return "Nothing"
  return entry.choice
}

/** "80% / 85%": Jev's score, then the level it had to reach. */
export function scoreLine(entry: Pick<DecisionLogEntry, "score" | "cutoff">): string {
  return `${entry.score === null ? "—" : percent(entry.score)} / ${percent(entry.cutoff)}`
}

export function logLimitLine(count: number, max: number): string {
  return `${count} of ${max} kept. The oldest drop off first.`
}
