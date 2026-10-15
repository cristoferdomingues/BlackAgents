import matter from "gray-matter"

import type { ExportFile } from "../export/adapter"
import type { OkfConcept } from "./parse"
import type { OkfConceptFrontmatter } from "./schema"
import { OKF_BUNDLE_DIR } from "./explain"

/**
 * Turn workspace concepts into an OKF 0.2 bundle. This only builds file
 * text. It never writes `.black-agents/knowledge/`.
 */

export function renderConceptFile(input: { frontmatter: OkfConceptFrontmatter; body: string }): string {
  const { extra, ...frontmatter } = input.frontmatter
  const data: Record<string, unknown> = { ...frontmatter, ...extra }
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) delete data[key]
  }
  const body = input.body.trim()
  return matter.stringify(body ? `\n${body}\n` : "\n", data)
}

function headingFor(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function parentOf(id: string): string {
  const slash = id.lastIndexOf("/")
  return slash === -1 ? "" : id.slice(0, slash)
}

function directoriesOf(ids: string[]): string[] {
  const dirs = new Set<string>([""])
  for (const id of ids) {
    const parts = id.split("/").slice(0, -1)
    let acc = ""
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      dirs.add(acc)
    }
  }
  return [...dirs].sort()
}

function renderIndex(dir: string, concepts: OkfConcept[], dirs: string[]): string {
  const lines: string[] = []
  if (dir === "") {
    lines.push("---", 'okf_version: "0.2"', "---", "")
  }
  lines.push(`# ${dir ? headingFor(dir.split("/").at(-1) ?? dir) : "Knowledge"}`, "")
  const here = concepts.filter((concept) => parentOf(concept.id) === dir)
  for (const concept of here) {
    const name = concept.id.split("/").at(-1) ?? concept.id
    const title = concept.frontmatter.title?.trim() || headingFor(name)
    const description = concept.frontmatter.description?.trim()
    const item = `* [${title}](${name}.md)`
    lines.push(description ? `${item} - ${description}` : item)
  }
  const children = dirs.filter((child) => child !== "" && parentOf(child) === dir)
  for (const child of children) {
    const name = child.split("/").at(-1) ?? child
    const count = concepts.filter((concept) => concept.id.startsWith(`${child}/`)).length
    const noun = count === 1 ? "concept" : "concepts"
    lines.push(`* [${headingFor(name)}](${name}/) - ${count} ${noun}.`)
  }
  lines.push("")
  return lines.join("\n")
}

function renderLog(concepts: OkfConcept[]): string {
  const events: Array<{ at: string; text: string }> = []
  for (const concept of concepts) {
    const name = concept.id.split("/").at(-1) ?? concept.id
    const title = concept.frontmatter.title?.trim() || headingFor(name)
    const href = `/${concept.id}.md`
    const generated = concept.frontmatter.generated
    if (generated?.at && /^\d{4}-\d{2}-\d{2}T/.test(generated.at)) {
      events.push({
        at: generated.at,
        text: `* **Creation**: Added [${title}](${href}) by ${generated.by}.`,
      })
    }
    for (const event of concept.frontmatter.verified ?? []) {
      if (/^\d{4}-\d{2}-\d{2}T/.test(event.at)) {
        events.push({
          at: event.at,
          text: `* **Update**: Reviewed [${title}](${href}) by ${event.by}.`,
        })
      }
    }
  }
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.text.localeCompare(b.text)))

  const lines = ["# Directory Update Log", ""]
  let date = ""
  for (const event of events) {
    const next = event.at.slice(0, 10)
    if (next !== date) {
      if (date) lines.push("")
      date = next
      lines.push(`## ${date}`)
    }
    lines.push(event.text)
  }
  if (events.length > 0) lines.push("")
  return lines.join("\n")
}

/** Concept files, one `index.md` per folder, and a root `log.md`. */
export function buildOkfBundle(concepts: OkfConcept[]): ExportFile[] {
  const sorted = [...concepts].sort((a, b) => a.id.localeCompare(b.id))
  const dirs = directoriesOf(sorted.map((concept) => concept.id))
  const files: ExportFile[] = sorted.map((concept) => ({
    path: `${OKF_BUNDLE_DIR}/${concept.id}.md`,
    content: renderConceptFile(concept),
  }))
  for (const dir of dirs) {
    files.push({
      path: dir ? `${OKF_BUNDLE_DIR}/${dir}/index.md` : `${OKF_BUNDLE_DIR}/index.md`,
      content: renderIndex(dir, sorted, dirs),
    })
  }
  files.push({ path: `${OKF_BUNDLE_DIR}/log.md`, content: renderLog(sorted) })
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}
