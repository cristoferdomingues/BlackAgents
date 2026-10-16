import path from "node:path"

import { safeParseMatter } from "../artifacts/parser"
import { OBSIDIAN_NOTE_LIMIT } from "./explain"
import { normalizeFrontmatter, type OkfConceptFrontmatter } from "./schema"

/**
 * Turn Obsidian notes into OKF 0.2 concept drafts. This does not read or write
 * disk. A draft is not verified: approval in the Brain inbox does that.
 */

export const OBSIDIAN_ACTOR = "process:obsidian-import"
export { OBSIDIAN_NOTE_LIMIT }

const TYPES: Record<string, string> = {
  moc: "Reference",
  reference: "Reference",
  "how-to": "How To",
  guide: "How To",
  spec: "Spec",
  module: "Module",
  "api-reference": "API Reference",
  "data-model": "Data Model",
  template: "Template",
}

const RESERVED = new Set(["index", "log"])

export interface ObsidianNoteInput {
  /** Path inside the vault, with `/` separators. */
  relativePath: string
  absolutePath: string
  content: string
}

export interface ObsidianDraft {
  id: string
  title: string
  description: string
  folder: string
  frontmatter: OkfConceptFrontmatter
  body: string
  warnings: string[]
  /** Set when the note cannot become a concept. */
  error?: string
}

export function fileUri(absolutePath: string): string {
  const resolved = path.resolve(absolutePath)
  return `file://${resolved
    .split(path.sep)
    .map((part, index) => (index === 0 ? "" : encodeURIComponent(part)))
    .join("/")}`
}

function slug(name: string): string {
  const cleaned = name
    .replace(/&/g, " and ")
    .replace(/\(([^)]*)\)/g, " $1 ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return cleaned || "note"
}

function stripIndex(name: string): string {
  return name.replace(/^\d+\s*-\s*/, "").trim()
}

function segment(name: string, rootFile: boolean): string {
  const stripped = stripIndex(name)
  if (rootFile && stripped.toLowerCase() === "moc") return "map-of-content"
  const next = slug(stripped)
  return RESERVED.has(next) ? `${next}-note` : next
}

function noteId(relativePath: string, taken: Set<string>): string {
  const posix = relativePath.split(path.sep).join("/")
  const dir = path.posix.dirname(posix)
  const base = path.posix.basename(posix, ".md")
  const folders =
    dir === "."
      ? []
      : dir.split("/").map((part) => segment(part, false))
  let id = [...folders, segment(base, dir === ".")].join("/")
  if (!taken.has(id)) {
    taken.add(id)
    return id
  }
  let n = 2
  while (taken.has(`${id}-${n}`)) n += 1
  id = `${id}-${n}`
  taken.add(id)
  return id
}

function anchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
}

function relHref(fromId: string, toId: string, heading: string): string {
  const fromDir = fromId.includes("/") ? fromId.slice(0, fromId.lastIndexOf("/")) : ""
  let href = path.posix.relative(fromDir, `${toId}.md`)
  if (!href.startsWith(".")) href = `./${href}`
  if (heading) href += `#${anchor(heading)}`
  return href
}

function plain(text: string): string {
  return text
    .replace(/!?\[\[([^\]]+)\]\]/g, (_, inner: string) => {
      const normalized = inner.replace(/\\\|/g, "|")
      const pipe = normalized.indexOf("|")
      const label = pipe === -1 ? "" : normalized.slice(pipe + 1)
      const target = pipe === -1 ? normalized : normalized.slice(0, pipe)
      const hash = target.indexOf("#")
      return (label || (hash === -1 ? target : target.slice(0, hash))).trim()
    })
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function clip(text: string): string {
  const clean = plain(text).replace(/^[-*]\s+/, "")
  if (!clean) return ""
  const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean
  if (sentence.length <= 140) return sentence.replace(/[,:;]+$/, "")
  const cut = sentence.slice(0, 140)
  const space = cut.lastIndexOf(" ")
  return (space > 60 ? cut.slice(0, space) : cut).replace(/[,:;]+$/, "")
}

function calloutText(body: string): string {
  const preamble = body.split(/^## /m)[0] ?? body
  const match = preamble.match(/>\s*\[!(?:abstract|info|summary)\][^\n]*\n((?:>.*\n?)*)/i)
  if (!match) return ""
  return match[1]
    .split(/\n/)
    .map((line) => line.replace(/^\s*>\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
}

function firstParagraph(body: string): string {
  const chunks: string[] = []
  let current: string[] = []
  const flush = (): void => {
    if (current.length > 0) chunks.push(current.join(" "))
    current = []
  }
  for (const line of body.replace(/```[\s\S]*?```/g, "\n").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === "---" || trimmed.startsWith("#") || trimmed.startsWith("|") || trimmed.startsWith(">")) {
      flush()
      continue
    }
    const bullet = trimmed.match(/^[-*]\s+(.*)/)
    if (bullet) {
      flush()
      chunks.push(bullet[1] ?? "")
      continue
    }
    current.push(trimmed)
  }
  flush()
  return chunks.find((chunk) => /[.!?]/.test(chunk)) ?? chunks[0] ?? ""
}

function okfType(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (TYPES[raw]) return TYPES[raw]
  if (!raw) return "Reference"
  return raw
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function isoDay(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().replace(/\.\d{3}Z$/, "Z")
  }
  if (typeof value !== "string") return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return value
  return undefined
}

function rewriteBody(noteIdValue: string, body: string, byName: Map<string, string>, warnings: string[]): string {
  const parts = body.split(/(```[\s\S]*?```)/g)
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part
      const linked = part.replace(/!?\[\[([^\]]+)\]\]/g, (full, inner: string) => {
        const normalized = inner.replace(/\\\|/g, "|")
        const pipe = normalized.indexOf("|")
        const label = pipe === -1 ? "" : normalized.slice(pipe + 1).trim()
        const target = (pipe === -1 ? normalized : normalized.slice(0, pipe)).trim()
        const hash = target.indexOf("#")
        const name = (hash === -1 ? target : target.slice(0, hash)).trim()
        const heading = hash === -1 ? "" : target.slice(hash + 1).trim()
        const id = name ? byName.get(name.toLowerCase()) : noteIdValue
        if (!id) {
          warnings.push(full)
          return label || name || full
        }
        const text = (label || name || heading || id).trim()
        return `[${text}](${relHref(noteIdValue, id, heading)})`
      })
      return linked.replace(/^> \[!([A-Za-z]+)\][ \t]*(.*)$/gm, (_, kind: string, title: string) => {
        const label = kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase()
        const rest = title.trim()
        return rest ? `> **${label} — ${rest}**` : `> **${label}**`
      })
    })
    .join("")
}

interface ParsedNote {
  input: ObsidianNoteInput
  id: string
  base: string
  data: Record<string, unknown>
  body: string
}

function addName(map: Map<string, string>, clashes: string[], name: string, id: string): void {
  const key = name.trim().toLowerCase()
  if (!key) return
  const prev = map.get(key)
  if (prev && prev !== id) {
    clashes.push(name)
    return
  }
  map.set(key, id)
}

/**
 * Convert vault notes into concept drafts. `now` is the import time stored on
 * `generated.at`. Nothing is marked verified.
 */
export function convertObsidianNotes(notes: ObsidianNoteInput[], now: Date): ObsidianDraft[] {
  const taken = new Set<string>()
  const parsed: ParsedNote[] = notes
    .filter((note) => note.relativePath.toLowerCase().endsWith(".md"))
    .map((note) => {
      const matter = safeParseMatter(note.content)
      const base = path.posix.basename(note.relativePath, ".md")
      return {
        input: note,
        id: noteId(note.relativePath, taken),
        base,
        data: matter.data,
        body: matter.content.replace(/^\n+/, ""),
      }
    })

  const byName = new Map<string, string>()
  const clashes: string[] = []
  for (const note of parsed) {
    addName(byName, clashes, note.base, note.id)
    addName(byName, clashes, stripIndex(note.base), note.id)
    const aliases = note.data.aliases
    if (Array.isArray(aliases)) {
      for (const alias of aliases) addName(byName, clashes, String(alias), note.id)
    }
  }

  const blurbs = new Map<string, string>()
  for (const note of parsed) {
    const isMoc = note.data.type === "moc" || note.id === "map-of-content" || note.id.endsWith("/map-of-content")
    if (!isMoc) continue
    for (const line of note.body.split(/\r?\n/)) {
      const item = line.match(/\[\[([^\]|#\\]+).*?\]\]\s*[—–-]\s*(.+)/)
      if (!item) continue
      blurbs.set((item[1] ?? "").trim().toLowerCase(), plain(item[2] ?? ""))
    }
  }

  const generatedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z")

  return parsed.map((note) => {
    const title = note.id === "map-of-content" ? "Map of content" : stripIndex(note.base) || note.base
    const warnings: string[] = []
    if (clashes.length > 0 && clashes.some((name) => byName.get(name.toLowerCase()) !== note.id && note.base.toLowerCase() === name.toLowerCase())) {
      warnings.push(`More than one note is named "${note.base}". Links use the first one.`)
    }
    const description =
      blurbs.get(note.base.toLowerCase()) ||
      blurbs.get(stripIndex(note.base).toLowerCase()) ||
      clip(calloutText(note.body) || firstParagraph(note.body)) ||
      title
    const tags = Array.isArray(note.data.tags) ? note.data.tags.map(String).filter(Boolean) : undefined
    const updated = isoDay(note.data.updated)
    const body = rewriteBody(note.id, note.body, byName, warnings)
    const draftData: Record<string, unknown> = {
      type: okfType(note.data.type),
      title,
      description,
      ...(tags && tags.length > 0 ? { tags } : {}),
      generated: { by: OBSIDIAN_ACTOR, at: generatedAt },
      status: "draft",
      sources: [
        {
          title: note.base,
          resource: fileUri(note.input.absolutePath),
          ...(updated ? { last_modified: updated } : {}),
        },
      ],
    }
    const normalized = normalizeFrontmatter(draftData, body)
    if ("error" in normalized) {
      return {
        id: note.id,
        title,
        description,
        folder: note.id.includes("/") ? note.id.slice(0, note.id.lastIndexOf("/")) : "",
        frontmatter: { type: "Reference", title, description, extra: {} },
        body,
        warnings,
        error: normalized.error,
      }
    }
    return {
      id: note.id,
      title,
      description,
      folder: note.id.includes("/") ? note.id.slice(0, note.id.lastIndexOf("/")) : "",
      frontmatter: normalized.frontmatter,
      body,
      warnings,
    }
  })
}
