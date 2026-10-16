import type { OkfConcept } from "./parse"
import { isStale, trustTier, type TrustTier } from "./schema"

/** One saved concept, without its body. Safe to list. */
export interface KnowledgeListItem {
  id: string
  title: string
  description: string
  type: string
  status?: "draft" | "stable" | "deprecated"
  trust: TrustTier
  folder: string
  tags: string[]
  stale: boolean
}

/** One saved concept opened for reading. */
export interface KnowledgeConceptView extends KnowledgeListItem {
  body: string
  sources: Array<{ title?: string; resource: string }>
  generatedBy?: string
  file: string
}

function folderOf(id: string): string {
  return id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : ""
}

/** A list row for the Knowledge library. */
export function toKnowledgeListItem(concept: OkfConcept, now: Date): KnowledgeListItem {
  return {
    id: concept.id,
    title: concept.frontmatter.title?.trim() || concept.id,
    description: concept.frontmatter.description?.trim() || "",
    type: concept.frontmatter.type,
    status: concept.frontmatter.status,
    trust: trustTier(concept.frontmatter.verified),
    folder: folderOf(concept.id),
    tags: concept.frontmatter.tags ?? [],
    stale: isStale(concept.frontmatter.stale_after, now),
  }
}

/** The concept a person opens in the library. */
export function toKnowledgeConceptView(concept: OkfConcept, now: Date): KnowledgeConceptView {
  return {
    ...toKnowledgeListItem(concept, now),
    body: concept.body,
    sources: (concept.frontmatter.sources ?? []).map((source) => ({
      title: source.title,
      resource: source.resource,
    })),
    generatedBy: concept.frontmatter.generated?.by,
    file: `.black-agents/knowledge/${concept.id}.md`,
  }
}
