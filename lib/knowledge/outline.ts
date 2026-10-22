/** Reading helpers for a concept body (safe for the browser). */

export interface OutlineItem {
  level: 2 | 3
  text: string
}

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/

/** Plain text of a markdown heading: no links, code marks, or emphasis. */
function plainHeading(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*~]/g, "")
    .replace(/(^|\s)_+|_+(?=\s|$)/g, "$1")
    .trim()
}

/** The `##` and `###` headings of a concept, in order, for an "On this page" list. Headings in code blocks are skipped. */
export function conceptOutline(body: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let inFence = false
  for (const line of body.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = HEADING.exec(line)
    const hashes = match?.[1]
    const raw = match?.[2]
    if (!hashes || !raw) continue
    if (hashes.length !== 2 && hashes.length !== 3) continue
    const text = plainHeading(raw)
    if (text) items.push({ level: hashes.length === 2 ? 2 : 3, text })
  }
  return items
}

/** Drops a first `# Title` line when it repeats the concept title shown above the body. */
export function withoutLeadingTitle(body: string, title: string): string {
  const lines = body.split("\n")
  const first = lines.findIndex((line) => line.trim() !== "")
  if (first === -1) return body
  const match = HEADING.exec(lines[first] ?? "")
  if (!match || match[1] !== "#" || !match[2]) return body
  if (plainHeading(match[2]).toLowerCase() !== title.trim().toLowerCase()) return body
  return lines.slice(first + 1).join("\n").replace(/^\s*\n/, "")
}
