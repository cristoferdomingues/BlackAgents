import type { ArtifactType } from "./types"

/**
 * `@`-mention support for the artifact body editor.
 *
 * While authoring, the user references other artifacts by typing `@` and
 * picking from a type-grouped list. The picked artifact is inserted as a
 * **type-qualified token** — `@type:name` — so an agent and a skill that share
 * a name can never be confused. On save, `applyMentions` rewrites those tokens
 * into the inline markdown cross-reference conventions the relationship graph
 * understands (see `lib/artifacts/graph.ts`).
 *
 * Kept isomorphic (no node imports) so the editor and any route can share it.
 */

export const MENTION_TYPES: ArtifactType[] = [
  "agent",
  "command",
  "rule",
  "skill",
]

/** The token inserted into the editor when a mention is picked. */
export function mentionToken(type: ArtifactType, name: string): string {
  return `@${type}:${name}`
}

/** Matches an inserted mention token: `@agent:tester`, `@skill:code-review`, … */
export const MENTION_TOKEN_RE =
  /@(agent|command|rule|skill):([a-z0-9]+(?:-[a-z0-9]+)*)/g

/**
 * The inline markdown convention for referencing an artifact of `type`:
 * - agent / command → **name** (bold)
 * - rule            → `name` rule
 * - skill           → `name` skill
 *
 * These are exactly the forms the graph extractor detects, so a saved mention
 * becomes a real edge in the relationship graph.
 */
export function formatMention(type: ArtifactType, name: string): string {
  switch (type) {
    case "rule":
      return `\`${name}\` rule`
    case "skill":
      return `\`${name}\` skill`
    case "agent":
    case "command":
    default:
      return `**${name}**`
  }
}

/**
 * Replace every `@type:name` token with its markdown convention. Idempotent on
 * text that has no tokens (already-formatted bodies pass through unchanged).
 */
export function applyMentions(body: string): string {
  return body.replace(
    MENTION_TOKEN_RE,
    (_match, type: ArtifactType, name: string) => formatMention(type, name)
  )
}

/** True when the body still contains unresolved mention tokens. */
export function hasMentionTokens(body: string): boolean {
  MENTION_TOKEN_RE.lastIndex = 0
  return MENTION_TOKEN_RE.test(body)
}

export interface MentionQuery {
  /** Index of the `@` in the full text. */
  start: number
  /** Characters typed after `@`, up to the caret. */
  query: string
}

/** The `@` the caret is still typing, or null when the caret is outside one. */
export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret)
  const match = /(?:^|\s)@([a-z0-9:-]*)$/i.exec(before)
  if (!match) return null
  return { start: before.lastIndexOf("@"), query: match[1] ?? "" }
}

/** True when an artifact matches the text typed after `@`. */
export function mentionMatches(
  item: { type: string; name: string; description?: string },
  query: string
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const token = `${item.type}:${item.name}`.toLowerCase()
  return (
    token.startsWith(q) ||
    item.name.toLowerCase().includes(q) ||
    item.type.toLowerCase().startsWith(q) ||
    (item.description ?? "").toLowerCase().includes(q)
  )
}

const MENTION_TYPE_ORDER: Record<ArtifactType, number> = {
  agent: 0,
  command: 1,
  rule: 2,
  skill: 3,
}

/** Matching artifacts, grouped by type then name. */
export function filterMentions<T extends { type: ArtifactType; name: string; description?: string }>(
  items: T[],
  query: string
): T[] {
  return items
    .filter((item) => mentionMatches(item, query))
    .sort(
      (a, b) =>
        MENTION_TYPE_ORDER[a.type] - MENTION_TYPE_ORDER[b.type] ||
        a.name.localeCompare(b.name)
    )
}

/** Replace the in-progress `@` query with a type-qualified token. */
export function insertMention(
  text: string,
  caret: number,
  query: MentionQuery,
  type: ArtifactType,
  name: string
): { text: string; caret: number } {
  const token = mentionToken(type, name)
  const boundary = text[caret] ?? ""
  const insertion = /\s/.test(boundary) ? token : `${token} `
  const next = text.slice(0, query.start) + insertion + text.slice(caret)
  return { text: next, caret: query.start + insertion.length }
}
