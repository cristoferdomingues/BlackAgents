import { choice } from "@typesafe-ai/sdk"

import {
  decisionErrorMessage,
  type ResolvedDecisionClient,
} from "@/lib/decision/client"

/** A positive prompt must reach this confidence to count as a real trigger. */
export const SKILL_TRIGGER_MIN_CONFIDENCE = 0.8
const MAX_SKILLS = 40
const DESCRIPTION_MAX_CHARS = 500
const PROMPT_MAX_CHARS = 2_000
const NONE_LABEL = "NONE"

/** Requests that should not open a specific skill unless that skill is about them. */
export const GENERIC_NEGATIVE_PROMPTS = [
  "refactor this function",
  "create a table",
  "write tests",
  "fix a typo in the readme",
] as const

export interface SkillCandidate {
  name: string
  description: string
}

export type SkillSuggestion =
  | { kind: "unavailable" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | {
      kind: "none"
      confidence: number
      model: string
      elapsedMs: number
      candidates: number
    }
  | {
      kind: "picked"
      name: string
      confidence: number
      model: string
      elapsedMs: number
      candidates: number
    }

export interface SkillProbe {
  prompt: string
  expect: "trigger" | "skip"
  picked: string | null
  confidence: number
  pass: boolean
}

export type SkillTriggerVerdict =
  | "ready"
  | "too-broad"
  | "never-triggers"
  | "unclear"

export interface SkillTriggerReport {
  skill: string
  verdict: SkillTriggerVerdict
  summary: string
  warning: string | null
  probes: SkillProbe[]
  counts: {
    passed: number
    total: number
    truePositives: number
    trueNegatives: number
    falsePositives: number
    falseNegatives: number
  }
}

/** The description should say when a person would use the skill. */
export function descriptionHasTrigger(description: string): boolean {
  return /\b(use when|read when|when the user|when you)\b/i.test(description)
}

/** Short prompts taken from the description, so a new skill can be tested before it is saved. */
export function defaultPositivePrompts(description: string): string[] {
  const text = description.replace(/\s+/g, " ").trim()
  if (!text) return []
  const clauses = text
    .split(/\b(?:use when|read when)\b/i)
    .flatMap((part) => part.split(/(?<=[.?!])\s+/))
    .map((part) => part.replace(/^[\s,:-]+|[\s,:-]+$/g, ""))
    .filter((part) => part.length >= 12)
  const unique = [...new Set(clauses.map((part) => part.slice(0, 180)))]
  return (unique.length > 0 ? unique : [text.slice(0, 180)]).slice(0, 3)
}

export function skillTriggerSummary(report: {
  warning: string | null
  counts: SkillTriggerReport["counts"]
}): { verdict: SkillTriggerVerdict; summary: string } {
  const { falsePositives, falseNegatives } = report.counts
  if (falsePositives > 0 && falseNegatives > 0) {
    return {
      verdict: "unclear",
      summary: "This description is unclear. Make the job specific, and say when to use it.",
    }
  }
  if (falsePositives > 0) {
    return {
      verdict: "too-broad",
      summary: "This description is too wide. Unrelated requests may open this skill.",
    }
  }
  if (falseNegatives > 0) {
    return {
      verdict: "never-triggers",
      summary: "This description may never trigger. Say when to use it, with words a person would type.",
    }
  }
  return {
    verdict: "ready",
    summary: report.warning
      ? "The checks passed. Add “Use when …” so the trigger is obvious."
      : "This skill should open only for its real job.",
  }
}

/**
 * Ask Jev which workspace skill fits this prompt. Never throws.
 * `unavailable` means Jev is off or has no key.
 */
export async function suggestSkill(params: {
  prompt: string
  skills: SkillCandidate[]
  resolved: ResolvedDecisionClient | null
}): Promise<SkillSuggestion> {
  const skills = params.skills
    .filter((skill) => skill.name.trim() && skill.description.trim())
    .slice(0, MAX_SKILLS)
  if (skills.length === 0) return { kind: "empty" }
  if (!params.resolved) return { kind: "unavailable" }

  const criteria: Record<string, string> = {}
  skills.forEach((skill, index) => {
    const description =
      skill.description.length > DESCRIPTION_MAX_CHARS
        ? `${skill.description.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`
        : skill.description
    criteria[`S${index}`] = `Skill "${skill.name}": ${description}`
  })
  criteria[NONE_LABEL] = "None of the listed skills are needed for this prompt."

  const started = Date.now()
  try {
    const result = await params.resolved.client.systemOne(
      {
        state: {
          trigger: "skill_suggestion",
          prompt: params.prompt.slice(0, PROMPT_MAX_CHARS),
        },
        questions: {
          skill: choice(
            "Which skill best matches the user request, or NONE if none is appropriate?",
            criteria
          ),
        },
      },
      { timeout: 3_500, retry: { maxRetries: 0 } }
    )
    const elapsedMs = Date.now() - started
    const answer = result.answers.skill
    const base = {
      confidence: answer.confidence,
      model: result.model,
      elapsedMs,
      candidates: skills.length,
    }
    if (answer.choice === NONE_LABEL || answer.confidence < SKILL_TRIGGER_MIN_CONFIDENCE) {
      return { kind: "none", ...base }
    }
    const picked = /^S\d+$/.test(answer.choice) ? skills[Number(answer.choice.slice(1))] : undefined
    if (!picked) {
      return { kind: "error", message: `Unknown skill label: ${answer.choice}` }
    }
    return { kind: "picked", name: picked.name, ...base }
  } catch (err) {
    return { kind: "error", message: decisionErrorMessage(err, "Jev skill suggestion failed") }
  }
}

/**
 * Run positive and negative prompts for one skill, including a draft that is not saved yet.
 * Never throws.
 */
export async function evaluateSkillTriggers(params: {
  skill: SkillCandidate
  catalog: SkillCandidate[]
  resolved: ResolvedDecisionClient | null
  positive?: string[]
  negative?: string[]
}): Promise<
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "report"; report: SkillTriggerReport }
> {
  const skill = {
    name: params.skill.name.trim(),
    description: params.skill.description.trim(),
  }
  const others = params.catalog.filter((item) => item.name !== skill.name)
  const catalog = [skill, ...others]
  const positive = (params.positive?.length ? params.positive : defaultPositivePrompts(skill.description)).slice(0, 6)
  const negative = (params.negative?.length ? params.negative : [...GENERIC_NEGATIVE_PROMPTS]).slice(0, 6)
  const warning = descriptionHasTrigger(skill.description)
    ? null
    : "Add “Use when …” so Jev knows when to open this skill."

  const probes: SkillProbe[] = []
  for (const prompt of positive) {
    const suggestion = await suggestSkill({ prompt, skills: catalog, resolved: params.resolved })
    if (suggestion.kind === "unavailable") return suggestion
    if (suggestion.kind === "error") return suggestion
    const picked = suggestion.kind === "picked" ? suggestion.name : null
    const confidence = suggestion.kind === "empty" ? 0 : suggestion.confidence
    probes.push({
      prompt,
      expect: "trigger",
      picked,
      confidence,
      pass: picked === skill.name,
    })
  }
  for (const prompt of negative) {
    const suggestion = await suggestSkill({ prompt, skills: catalog, resolved: params.resolved })
    if (suggestion.kind === "unavailable") return suggestion
    if (suggestion.kind === "error") return suggestion
    const picked = suggestion.kind === "picked" ? suggestion.name : null
    const confidence = suggestion.kind === "empty" ? 0 : suggestion.confidence
    probes.push({
      prompt,
      expect: "skip",
      picked,
      confidence,
      pass: picked !== skill.name,
    })
  }

  const counts = {
    total: probes.length,
    passed: probes.filter((probe) => probe.pass).length,
    truePositives: probes.filter((probe) => probe.expect === "trigger" && probe.pass).length,
    trueNegatives: probes.filter((probe) => probe.expect === "skip" && probe.pass).length,
    falsePositives: probes.filter((probe) => probe.expect === "skip" && !probe.pass).length,
    falseNegatives: probes.filter((probe) => probe.expect === "trigger" && !probe.pass).length,
  }
  const { verdict, summary } = skillTriggerSummary({ warning, counts })
  return { kind: "report", report: { skill: skill.name, verdict, summary, warning, probes, counts } }
}
