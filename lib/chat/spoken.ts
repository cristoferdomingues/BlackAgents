import type { VoiceStyle } from "@/lib/chat/voice-persona"
import { inspectChoices } from "@/lib/llm/choices"
import { stripDraftBlock } from "@/lib/llm/draft"
import { stripBundleBlock } from "@/lib/llm/bundle"
import { stripKnowledgeBlock } from "@/lib/llm/knowledge-draft"
import { stripMemoryBlock } from "@/lib/llm/memory-draft"
import { stripWorkflowBlock } from "@/lib/llm/workflow-draft"

/** Stop a spoken reply before it goes on too long. */
export const SPOKEN_MAX_CHARS = 1_500

const CODE_NOTE = "Some of it is code, shown on the screen."
const CODE_ONLY = "The answer is on the screen."
const REST_NOTE = "The rest is on the screen."

/** Short style keeps this many sentences, then says the rest is on the screen. */
export const SHORT_SPOKEN_SENTENCES = 2

/** The words to say for an assistant reply. Draft blocks and code are left out. */
export function assistantSpeechText(content: string, style: VoiceStyle = "normal"): string {
  const visible = stripMemoryBlock(
    stripKnowledgeBlock(stripWorkflowBlock(stripBundleBlock(stripDraftBlock(content))))
  )
  const choices = inspectChoices(visible)
  const prose = markdownToSpeech(choices ? choices.rest : visible)
  const ask = choices
    ? [choices.prompt.question?.trim(), ...choices.prompt.options.map((option) => `${option.label}. ${option.text}`)]
        .filter((part): part is string => Boolean(part))
        .join(". ")
    : ""
  const full = cap(joinParts(prose.text, ask, prose.skippedCode))
  return style === "short" ? shortenSpeech(full) : full
}

/** Split spoken text into short pieces so the browser voice does not stop early. */
export function speechChunks(text: string, max = 220): string[] {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) return []
  const parts = clean.split(/(?<=[.!?])\s+/).flatMap((sentence) => {
    if (sentence.length <= max) return [sentence]
    const slices: string[] = []
    for (let index = 0; index < sentence.length; index += max) slices.push(sentence.slice(index, index + max).trim())
    return slices.filter(Boolean)
  })
  const chunks: string[] = []
  let current = ""
  for (const part of parts) {
    const next = current ? `${current} ${part}` : part
    if (current && next.length > max) {
      chunks.push(current)
      current = part
    } else {
      current = next
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function joinParts(prose: string, ask: string, skippedCode: boolean): string {
  const parts = [prose, ask].filter(Boolean)
  if (parts.length === 0) return skippedCode ? CODE_ONLY : ""
  if (skippedCode) parts.push(CODE_NOTE)
  return parts.join(". ").replace(/\.\s*\./g, ".")
}

function cap(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= SPOKEN_MAX_CHARS) return clean
  const cut = clean.slice(0, SPOKEN_MAX_CHARS).replace(/\s+\S*$/, "").replace(/[.!?]+$/, "")
  return `${cut}. ${REST_NOTE}`
}

function shortenSpeech(text: string): string {
  if (!text) return text
  const sentences = text.split(/(?<=[.!?])\s+/)
  const kept = sentences.slice(0, SHORT_SPOKEN_SENTENCES).join(" ")
  if (kept.length >= text.length) return text
  const base = /[.!?]$/.test(kept) ? kept : `${kept}.`
  return `${base} ${REST_NOTE}`
}

function markdownToSpeech(markdown: string): { text: string; skippedCode: boolean } {
  const lines: string[] = []
  let inFence = false
  let skippedCode = false
  for (const raw of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      if (!inFence) skippedCode = true
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const line = cleanLine(raw)
    if (line) lines.push(line)
  }
  if (inFence) skippedCode = true
  return { text: joinLines(lines), skippedCode }
}

function joinLines(lines: string[]): string {
  let out = ""
  for (const line of lines) {
    if (!out) {
      out = line
      continue
    }
    out = `${out}${/[.!?]$/.test(out) ? "" : "."} ${line}`
  }
  return out
}

function cleanLine(raw: string): string {
  let text = raw.trim()
  if (!text || /^(?:---|\*\*\*|___)$/.test(text)) return ""
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(text)) return ""
  text = text.replace(/^>\s?/, "")
  text = text.replace(/^#{1,6}\s+/, "")
  text = text.replace(/^[-*+]\s+/, "")
  text = text.replace(/^\d+[.)]\s+/, "")
  if (text.includes("|")) {
    text = text
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(", ")
  }
  text = text.replace(/!\[[^\]]*]\([^)]*\)/g, "")
  text = text.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, label: string, href: string) =>
    label.trim() === href.trim() ? "a link" : label.trim()
  )
  text = text.replace(/https?:\/\/\S+/g, "a link")
  text = text.replace(/`([^`]+)`/g, "$1")
  text = text.replace(/(\*\*|__)(.+?)\1/g, "$2")
  text = text.replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, "$1$2")
  text = text.replace(/(^|\s)_(.+?)_(?=\s|$)/g, "$1$2")
  text = text.replace(/~~(.+?)~~/g, "$1")
  text = text.replace(/<[^>]+>/g, "")
  return text.replace(/\s+/g, " ").trim()
}
