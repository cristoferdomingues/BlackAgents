import { conceptLinkTarget, linkedConceptIds } from "./links"
import type { OkfConcept } from "./parse"

/**
 * Finds saved concepts that look related to a new one, and writes the links.
 * Isomorphic and pure: the Brain approval flow does the reading and writing.
 *
 * The score mixes three signals: rare words both notes share (TF-IDF cosine),
 * shared tags, and one note naming the other's title or already linking to it.
 */

export interface RelatedInput {
  id: string
  title?: string
  description?: string
  tags?: readonly string[]
  body: string
}

export interface ConceptLink {
  id: string
  title: string
  /** Plain-language reason shown in the Inbox. */
  reason: string
}

export function relatedInputOf(concept: OkfConcept): RelatedInput {
  return {
    id: concept.id,
    title: concept.frontmatter.title,
    description: concept.frontmatter.description,
    tags: concept.frontmatter.tags,
    body: concept.body,
  }
}

export const RELATED_LIMIT = 5
const MIN_SCORE = 0.12
const TAG_BOOST = 0.15
const MENTION_BOOST = 0.3
const REASON_TERMS = 3

const STOPWORDS = new Set([
  // English
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out",
  "has", "have", "his", "how", "its", "may", "new", "now", "old", "see", "two", "way", "who", "did", "get", "got",
  "let", "say", "she", "too", "use", "used", "uses", "using", "this", "that", "with", "from", "they", "will", "would",
  "there", "their", "what", "when", "where", "which", "while", "about", "into", "than", "then", "them", "these",
  "those", "been", "being", "were", "each", "only", "also", "more", "most", "some", "such", "very", "just", "over",
  "under", "your", "yours", "here", "should", "could", "must", "does", "done", "make", "made", "like", "after",
  "before", "other", "same", "because", "between", "without", "within", "every", "none", "noted",
  // Portuguese
  "que", "nao", "uma", "para", "com", "por", "mais", "como", "mas", "dos", "das", "nos", "nas", "sao", "ser", "foi",
  "tem", "ter", "isso", "esse", "essa", "este", "esta", "pelo", "pela", "sobre", "entre", "quando", "onde", "tambem",
  "muito", "seu", "sua", "seus", "suas", "ele", "ela", "eles", "elas", "voce", "nosso", "nossa", "vamos", "vai",
  // Spanish
  "los", "las", "del", "por", "con", "una", "para", "como", "pero", "sus", "este", "esta", "tambien", "muy", "cuando",
])

function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1)
  return word
}

/** Content words of a text: folded, without stop words, numbers, or link targets. */
export function conceptTerms(text: string): string[] {
  return fold(text)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !STOPWORDS.has(word))
    .map(stem)
}

function termCounts(input: RelatedInput): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (text: string | undefined, weight: number): void => {
    if (!text) return
    for (const term of conceptTerms(text)) counts.set(term, (counts.get(term) ?? 0) + weight)
  }
  add(input.title, 3)
  add(input.tags?.join(" "), 3)
  add(input.description, 2)
  add(input.body, 1)
  return counts
}

type Vector = Map<string, number>

function vectorize(counts: Map<string, number>, idf: Map<string, number>): Vector {
  const vector: Vector = new Map()
  for (const [term, count] of counts) {
    vector.set(term, (1 + Math.log(count)) * (idf.get(term) ?? 0))
  }
  return vector
}

function norm(vector: Vector): number {
  let sum = 0
  for (const value of vector.values()) sum += value * value
  return Math.sqrt(sum)
}

function sharedTerms(a: Vector, b: Vector): Array<{ term: string; weight: number }> {
  const shared: Array<{ term: string; weight: number }> = []
  for (const [term, value] of a) {
    const other = b.get(term)
    if (other) shared.push({ term, weight: value * other })
  }
  return shared.sort((x, y) => y.weight - x.weight)
}

function titleOf(input: RelatedInput): string {
  return input.title?.trim() || input.id.split("/").at(-1) || input.id
}

/** True when `text` names `title` as whole words. Short titles are ignored. */
function mentions(text: string, title: string): boolean {
  const phrase = fold(title).replace(/[^a-z0-9]+/g, " ").trim()
  if (phrase.length < 4) return false
  const haystack = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `
  return haystack.includes(` ${phrase} `)
}

function sameTags(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
  if (!a?.length || !b?.length) return []
  const other = new Set(b.map((tag) => fold(tag)))
  return a.filter((tag) => other.has(fold(tag)))
}

/**
 * Saved concepts most related to `target`, best first. Skips the target itself
 * and concepts the target body already links to.
 */
export function suggestConceptLinks(
  target: RelatedInput,
  concepts: readonly RelatedInput[],
  limit = RELATED_LIMIT
): ConceptLink[] {
  const others = concepts.filter((concept) => concept.id !== target.id)
  if (others.length === 0) return []
  const alreadyLinked = new Set(linkedConceptIds(target.id, target.body))

  const docs = [target, ...others].map(termCounts)
  const df = new Map<string, number>()
  for (const counts of docs) for (const term of counts.keys()) df.set(term, (df.get(term) ?? 0) + 1)
  const total = docs.length
  const idf = new Map<string, number>()
  for (const [term, count] of df) idf.set(term, Math.log((total + 1) / (count + 1)) + 1)

  const [targetCounts, ...otherCounts] = docs
  const targetVector = vectorize(targetCounts ?? new Map(), idf)
  const targetNorm = norm(targetVector)
  const targetTitle = titleOf(target)
  const targetText = `${target.description ?? ""}\n${target.body}`

  const scored: Array<ConceptLink & { score: number }> = []
  others.forEach((concept, index) => {
    if (alreadyLinked.has(concept.id)) return
    const vector = vectorize(otherCounts[index] ?? new Map(), idf)
    const denominator = targetNorm * norm(vector)
    const shared = sharedTerms(targetVector, vector)
    const dot = shared.reduce((sum, item) => sum + item.weight, 0)
    const cosine = denominator > 0 ? dot / denominator : 0

    const title = titleOf(concept)
    const tags = sameTags(target.tags, concept.tags)
    const namesIt = mentions(targetText, title)
    const namedBy = mentions(`${concept.description ?? ""}\n${concept.body}`, targetTitle)
    const linksBack = linkedConceptIds(concept.id, concept.body).includes(target.id)

    const score =
      cosine + tags.length * TAG_BOOST + (namesIt || namedBy || linksBack ? MENTION_BOOST : 0)
    if (score < MIN_SCORE) return

    const reasons: string[] = []
    if (linksBack) reasons.push("It already links to this note")
    else if (namesIt) reasons.push(`This note names “${title}”`)
    else if (namedBy) reasons.push(`It names “${targetTitle}”`)
    if (tags.length > 0) reasons.push(`Same tag: ${tags.join(", ")}`)
    const words = shared.slice(0, REASON_TERMS).map((item) => item.term)
    if (words.length > 0) reasons.push(`Both talk about: ${words.join(", ")}`)

    scored.push({ id: concept.id, title, reason: reasons.join(". "), score })
  })

  return scored
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(({ id, title, reason }) => ({ id, title, reason }))
}

/** Relative markdown href from one concept file to another. */
export function relativeConceptHref(fromId: string, toId: string): string {
  const fromDir = fromId.split("/").slice(0, -1)
  const to = toId.split("/")
  let common = 0
  while (common < fromDir.length && common < to.length - 1 && fromDir[common] === to[common]) common++
  const up = "../".repeat(fromDir.length - common)
  return `${up}${to.slice(common).join("/")}.md`
}

function linkLabel(title: string): string {
  return title.replace(/[[\]]/g, "").trim() || "note"
}

const RELATED_HEADING = /^##\s+related\s*$/i
const ANY_HEADING = /^#{1,2}\s/

/**
 * Add links under `## Related`, creating the section when it is missing.
 * Targets already linked from the body are skipped, so this is safe to repeat.
 */
export function addRelatedLinks(
  fromId: string,
  body: string,
  targets: readonly { id: string; title: string }[]
): string {
  const existing = new Set(linkedConceptIds(fromId, body))
  const fresh: { id: string; title: string }[] = []
  for (const target of targets) {
    if (target.id === fromId || existing.has(target.id)) continue
    existing.add(target.id)
    fresh.push(target)
  }
  if (fresh.length === 0) return body

  const bullets = fresh.map((target) => {
    const href = relativeConceptHref(fromId, target.id)
    if (conceptLinkTarget(fromId, href) !== target.id) throw new Error(`Could not link to "${target.id}"`)
    return `- [${linkLabel(target.title)}](${href})`
  })

  const lines = body.replace(/\s+$/, "").split("\n")
  const start = lines.findIndex((line) => RELATED_HEADING.test(line.trim()))
  if (start === -1) {
    return `${[...lines, "", "## Related", ...bullets].join("\n")}\n`
  }
  let end = lines.findIndex((line, index) => index > start && ANY_HEADING.test(line))
  if (end === -1) end = lines.length
  let insertAt = end
  while (insertAt > start + 1 && (lines[insertAt - 1] ?? "").trim() === "") insertAt--
  const next = [...lines.slice(0, insertAt), ...bullets, ...lines.slice(insertAt)]
  if (end < lines.length && (next[insertAt + bullets.length] ?? "").trim() !== "") {
    next.splice(insertAt + bullets.length, 0, "")
  }
  return `${next.join("\n")}\n`
}
