import path from "node:path"

import { pathExists, readText, walkFiles } from "../fs-service"
import { safeParseMatter } from "../artifacts/parser"
import { parseConceptContent, type ConceptParse } from "./parse"
import { assertOkfVersion, declaredVersion } from "./schema"

/**
 * Read an OKF bundle from a folder. Zip archives are not supported yet.
 * `index.md` is walked one directory at a time; concept bodies stay unread
 * until `readBundleConcept` is called.
 */

const RESERVED = new Set(["index.md", "log.md"])

export interface IndexEntry {
  title: string
  href: string
  description: string
  kind: "concept" | "directory"
  /** Concept id, or the directory path. Both are relative to the bundle root. */
  target: string
}

export interface IndexSection {
  heading: string
  entries: IndexEntry[]
}

export interface IndexLevel {
  /** "" is the bundle root. */
  dir: string
  present: boolean
  /** Set only on the bundle root, from `okf_version`. */
  version?: string
  sections: IndexSection[]
}

export interface BundleLink {
  from: string
  href: string
  target: string
}

export interface BundleReport {
  version: string | undefined
  levels: IndexLevel[]
  /** Every concept file, whether or not an index links to it. */
  conceptIds: string[]
  /** Concept files no index links to. */
  orphans: string[]
  /** Index links whose concept file is not in the bundle. */
  missing: BundleLink[]
}

function resolveInside(root: string, relativePath: string): string {
  const normalizedRoot = path.resolve(root)
  const target = path.resolve(normalizedRoot, relativePath)
  const rel = path.relative(normalizedRoot, target)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the bundle: ${relativePath}`)
  }
  return target
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/")
}

/** Turn an index href into a bundle-relative concept id or directory. */
export function resolveIndexHref(dir: string, href: string): { kind: "concept" | "directory" | "external"; target: string } | null {
  const trimmed = href.trim()
  if (!trimmed || /^[a-z]+:/i.test(trimmed)) return { kind: "external", target: trimmed }
  const decoded = trimmed.split("#")[0]?.split("?")[0] ?? ""
  if (!decoded) return null
  const base = decoded.startsWith("/") ? decoded.slice(1) : dir ? `${dir}/${decoded}` : decoded
  const normalized = path.posix.normalize(base)
  if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) return null
  if (normalized.endsWith("/")) return { kind: "directory", target: normalized.replace(/\/$/, "") }
  if (normalized.endsWith("/index.md") || normalized === "index.md") {
    const folder = path.posix.dirname(normalized)
    return { kind: "directory", target: folder === "." ? "" : folder }
  }
  if (!normalized.endsWith(".md")) return { kind: "external", target: trimmed }
  return { kind: "concept", target: normalized.slice(0, -".md".length) }
}

function parseIndexBody(dir: string, body: string): IndexSection[] {
  const sections: IndexSection[] = []
  let current: IndexSection = { heading: "", entries: [] }
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^#\s+(.+?)\s*$/)
    if (heading) {
      current = { heading: heading[1] ?? "", entries: [] }
      sections.push(current)
      continue
    }
    const item = line.match(/^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:[-–—]\s*(.*))?$/)
    if (!item) continue
    const resolved = resolveIndexHref(dir, item[2] ?? "")
    if (!resolved || resolved.kind === "external") continue
    if (sections.length === 0) sections.push(current)
    current.entries.push({
      title: item[1] ?? "",
      href: (item[2] ?? "").trim(),
      description: (item[3] ?? "").trim(),
      kind: resolved.kind,
      target: resolved.target,
    })
  }
  return sections.filter((section) => section.heading !== "" || section.entries.length > 0)
}

/** One directory's `index.md` only. A bad `okf_version` throws before any concept is read. */
export async function readIndexLevel(bundleRoot: string, dir = ""): Promise<IndexLevel> {
  const rel = dir ? `${dir}/index.md` : "index.md"
  const abs = resolveInside(bundleRoot, rel)
  if (!(await pathExists(abs))) return { dir, present: false, sections: [] }
  const parsed = safeParseMatter(await readText(abs))
  const version = dir === "" ? declaredVersion(parsed.data.okf_version) : undefined
  if (dir === "") assertOkfVersion(version)
  return { dir, present: true, version, sections: parseIndexBody(dir, parsed.content) }
}

async function conceptFiles(bundleRoot: string): Promise<string[]> {
  if (!(await pathExists(bundleRoot))) return []
  const ids: string[] = []
  for (const rel of await walkFiles(bundleRoot)) {
    const posix = toPosix(rel)
    if (!posix.endsWith(".md") || RESERVED.has(path.posix.basename(posix))) continue
    ids.push(posix.slice(0, -".md".length))
  }
  return ids.sort()
}

/**
 * Check the version, walk every `index.md` one level at a time, and compare
 * those links with the concept files. Concept bodies are not read.
 */
export async function inspectBundle(bundleRoot: string): Promise<BundleReport> {
  const root = await readIndexLevel(bundleRoot, "")
  const levels: IndexLevel[] = [root]
  const linked = new Set<string>()
  const missing: BundleLink[] = []
  const seenDirs = new Set<string>([""])
  const queue = [""]

  while (queue.length > 0) {
    const dir = queue.shift() ?? ""
    const level = dir === "" ? root : await readIndexLevel(bundleRoot, dir)
    if (dir !== "") levels.push(level)
    for (const section of level.sections) {
      for (const entry of section.entries) {
        if (entry.kind === "directory") {
          if (!seenDirs.has(entry.target)) {
            seenDirs.add(entry.target)
            queue.push(entry.target)
          }
          continue
        }
        linked.add(entry.target)
      }
    }
  }

  const conceptIds = await conceptFiles(bundleRoot)
  const present = new Set(conceptIds)
  for (const level of levels) {
    for (const section of level.sections) {
      for (const entry of section.entries) {
        if (entry.kind === "concept" && !present.has(entry.target)) {
          missing.push({ from: level.dir, href: entry.href, target: entry.target })
        }
      }
    }
  }

  return {
    version: root.version,
    levels,
    conceptIds,
    orphans: conceptIds.filter((id) => !linked.has(id)),
    missing,
  }
}

/** Read one concept body. This is the on-demand step after an index walk. */
export async function readBundleConcept(bundleRoot: string, id: string): Promise<ConceptParse> {
  if (id.startsWith("/") || id.split("/").some((segment) => segment === ".." || segment === "")) {
    return { ok: false, message: `Concept id "${id}" is outside the bundle` }
  }
  const abs = resolveInside(bundleRoot, `${id}.md`)
  if (!(await pathExists(abs))) return { ok: false, message: `No concept "${id}" in this bundle` }
  return parseConceptContent(id, await readText(abs))
}
