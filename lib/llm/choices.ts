import { z } from "zod"

import { findFencedJson } from "./fenced-json"

/**
 * A reply can ask the user to pick one or more answers. The model may send a
 * ```choices block, or write plain lettered options ("A) …", "- **B)** …").
 * Either way the chat shows clickable options plus a free-text "Other".
 * Isomorphic: the client parses replies with the same code the tests use.
 */

export const CHOICES_FENCE = "choices"
export const MAX_CHOICE_OPTIONS = 10
export const MAX_OTHER_ANSWER = 500

export const choicesBlockSchema = z.object({
  question: z.string().trim().max(500).optional(),
  multiple: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(MAX_CHOICE_OPTIONS),
})

export interface ChoiceOption {
  /** "A", "B", … */
  label: string
  text: string
}

export interface ChoicePrompt {
  question?: string
  multiple: boolean
  options: ChoiceOption[]
}

export interface ChoiceInspection {
  prompt: ChoicePrompt
  /** The reply without the block or the option lines. */
  rest: string
}

const LETTERS = "ABCDEFGHIJ"

/** `A)`, `A.`, `A:`, `(A)`, optional list bullet and bold around the letter. */
const OPTION_LINE =
  /^\s*(?:[-*+]\s+)?(?:\*\*|__)?\(?([A-Ja-j])[).:](?:\*\*|__)?\s+(.+?)\s*$/

const MULTIPLE_HINT =
  /\b(select|choose|pick|mark) (all|every|each|two|three|\d+)\b|\ball that apply\b|\bmore than one\b|\bmultiple (answers|choices|options)\b/i

/** Lines after the last option that can still belong to the question (e.g. "Reply with a letter"). */
const MAX_TRAILING_LINES = 3

function cleanText(text: string): string {
  return text.replace(/\*\*|__/g, "").trim()
}

function fromBlock(text: string): ChoiceInspection | null {
  const block = findFencedJson(text, CHOICES_FENCE)
  if (!block) return null
  const parsed = choicesBlockSchema.safeParse(block.value)
  if (!parsed.success) return null
  const options = parsed.data.options.map((raw, i) => ({
    label: LETTERS[i] ?? String(i + 1),
    text: cleanText(raw.replace(/^\(?[A-Ja-j][).:]\s+/, "")),
  }))
  return {
    prompt: {
      ...(parsed.data.question ? { question: parsed.data.question } : {}),
      multiple: parsed.data.multiple,
      options,
    },
    rest: (text.slice(0, block.start) + text.slice(block.end)).trim(),
  }
}

/** The last run of options lettered A, B, C… in order, near the end of the reply. */
function fromLetteredLines(text: string): ChoiceInspection | null {
  type Run = { from: number; to: number; options: ChoiceOption[] }
  const lines = text.split(/\r?\n/)
  let found: Run | null = null
  let run: Run | null = null
  let inFence = false

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      run = null
      continue
    }
    if (inFence) continue
    const match = OPTION_LINE.exec(line)
    if (!match) {
      if (line.trim() !== "") run = null
      continue
    }
    const letter = match[1].toUpperCase()
    if (letter === "A") run = { from: index, to: index, options: [] }
    if (!run || letter !== LETTERS[run.options.length]) {
      run = null
      continue
    }
    run.options.push({ label: letter, text: cleanText(match[2]) })
    run.to = index
    if (run.options.length >= 2) found = { ...run, options: [...run.options] }
  }

  if (!found || found.options.length > MAX_CHOICE_OPTIONS) return null
  const trailing = lines.slice(found.to + 1).filter((line) => line.trim() !== "")
  if (trailing.length > MAX_TRAILING_LINES) return null

  const rest = [...lines.slice(0, found.from), ...lines.slice(found.to + 1)].join("\n").trim()
  return {
    prompt: { multiple: MULTIPLE_HINT.test(text), options: found.options },
    rest,
  }
}

/** Find a choice question in an assistant reply. A valid block wins over lettered lines. */
export function inspectChoices(text: string): ChoiceInspection | null {
  return fromBlock(text) ?? fromLetteredLines(text)
}

/** The user message sent for a pick: one line per chosen option, then "Other: …". */
export function formatChoiceAnswer(prompt: ChoicePrompt, selected: readonly string[], other: string): string {
  const picked = prompt.options
    .filter((option) => selected.includes(option.label))
    .map((option) => `${option.label}) ${option.text}`)
  const custom = other.trim().slice(0, MAX_OTHER_ANSWER)
  if (custom) picked.push(`Other: ${custom}`)
  return picked.join("\n")
}
