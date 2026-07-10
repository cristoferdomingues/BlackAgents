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
