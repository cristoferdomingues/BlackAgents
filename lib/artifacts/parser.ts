import matter from "gray-matter"
import path from "node:path"

import {
  listDir,
  pathExists,
  readText,
  resolveInWorkspace,
  walkFiles,
} from "../fs-service"
import {
  ACTIVE_PLATFORMS,
  DEFAULT_PLATFORM,
  PLATFORM_LAYOUTS,
  typeLayout,
  type TypeLayout,
} from "./layout"
import { sourceLayout } from "./source"
import { loadProjectScope } from "./projects"
import type { ScopeToken } from "./schemas"
import type {
  Artifact,
  ArtifactFrontmatter,
  ArtifactType,
  Platform,
} from "./types"

const TYPES: ArtifactType[] = ["agent", "command", "rule", "skill"]

function toFrontmatter(data: Record<string, unknown>): ArtifactFrontmatter {
  return data as ArtifactFrontmatter
}

function cleanYamlValue(val: string): unknown {
  let trimmed = val.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1)
  } else if (trimmed === "true") {
    return true
  } else if (trimmed === "false") {
    return false
  }
  return trimmed
}

export function safeParseMatter(raw: string): {
  data: Record<string, unknown>
  content: string
} {
  try {
    return matter(raw)
  } catch {
    // Graceful fallback when YAML is malformed (e.g. unquoted colons or unescaped quotes in values)
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (!match) {
      return { data: {}, content: raw }
    }
    const [, fmText, body] = match
    const data: Record<string, unknown> = {}
    const lines = fmText.split(/\r?\n/)
    let currentKey = ""
    let currentValue = ""

    for (const line of lines) {
      const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
      if (keyMatch) {
        if (currentKey) {
          data[currentKey] = cleanYamlValue(currentValue)
        }
        currentKey = keyMatch[1]
        currentValue = keyMatch[2]
      } else if (currentKey) {
        currentValue += "\n" + line
      }
    }
    if (currentKey) {
      data[currentKey] = cleanYamlValue(currentValue)
    }
    return { data, content: body }
  }
}

function buildArtifact(
  type: ArtifactType,
  platform: Platform,
  name: string,
  relativePath: string,
  raw: string,
  supportingFiles?: string[]
): Artifact {
  const parsed = safeParseMatter(raw)
  const frontmatter = toFrontmatter(parsed.data)
  const description =
    typeof frontmatter.description === "string" ? frontmatter.description : ""
  return {
    name,
    type,
    platform,
    description,
    frontmatter,
    body: parsed.content.replace(/^\n+/, ""),
    relativePath,
    supportingFiles,
  }
}

async function scanType(
  root: string,
  platform: Platform,
  type: ArtifactType
): Promise<Artifact[]> {
  return scanLayout(root, platform, type, typeLayout(platform, type))
}

async function scanLayout(
  root: string,
  platform: Platform,
  type: ArtifactType,
  layout: TypeLayout
): Promise<Artifact[]> {
  const dirAbs = resolveInWorkspace(root, layout.dir)
  if (!(await pathExists(dirAbs))) return []

  const out: Artifact[] = []
  const entries = await listDir(dirAbs)

  if (layout.nested) {
    for (const entry of entries) {
      if (!entry.isDirectory) continue
      const entryRel = `${layout.dir}/${entry.name}/${layout.entryFile}`
      const entryAbs = resolveInWorkspace(root, entryRel)
      if (!(await pathExists(entryAbs))) continue
      const raw = await readText(entryAbs)
      const allFiles = await walkFiles(
        resolveInWorkspace(root, `${layout.dir}/${entry.name}`)
      )
      const supportingFiles = allFiles.filter((f) => f !== layout.entryFile)
      out.push(
        buildArtifact(type, platform, entry.name, entryRel, raw, supportingFiles)
      )
    }
  } else {
    for (const entry of entries) {
      if (entry.isDirectory) continue
      if (!entry.name.endsWith(layout.ext)) continue
      const name = entry.name.slice(0, -layout.ext.length)
      const rel = `${layout.dir}/${entry.name}`
      const raw = await readText(resolveInWorkspace(root, rel))
      out.push(buildArtifact(type, platform, name, rel, raw))
    }
  }

  return out
}

/** Artifacts in a scope's source tree (`.black-agents/.../artifacts/`). */
export async function scanSource(root: string, scope?: string): Promise<Artifact[]> {
  const layout = sourceLayout(scope)
  const out: Artifact[] = []
  for (const type of TYPES) {
    const found = await scanLayout(root, DEFAULT_PLATFORM, type, layout[type])
    out.push(
      ...found.map((artifact) => ({
        ...artifact,
        managed: true,
        ...(scope ? { scope: { project: scope } } : {}),
      }))
    )
  }
  return out
}

/** The copies of artifacts in one IDE folder. */
export async function scanPlatform(root: string, platform: Platform): Promise<Artifact[]> {
  const rootDir = resolveInWorkspace(root, PLATFORM_LAYOUTS[platform].root)
  if (!(await pathExists(rootDir))) return []
  const out: Artifact[] = []
  for (const type of TYPES) out.push(...(await scanType(root, platform, type)))
  return out
}

/** First occurrence of `type:name` wins (used with project entries first). */
export function dedupeByTypeId(collected: Artifact[]): Artifact[] {
  const seen = new Map<string, Artifact>()
  for (const artifact of collected) {
    const key = `${artifact.type}:${artifact.name}`
    if (!seen.has(key)) seen.set(key, artifact)
  }
  return [...seen.values()].sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
  )
}

const TOKEN_BY_TYPE: Record<ArtifactType, ScopeToken> = {
  agent: "agents",
  command: "commands",
  rule: "rules",
  skill: "skills",
}

/**
 * Every artifact visible in a scope, deduped by type+name, project entry first.
 *
 * - No scope: today's behavior — the workspace source wins, then IDE folders.
 * - With a scope: scope-first and fail-closed. The project source is always
 *   scanned; the workspace source and IDE folders only contribute types whose
 *   token is whitelisted in `project.json` (`inherits`). An invalid or missing
 *   manifest inherits nothing.
 */
export async function scanWorkspace(root: string, scope?: string): Promise<Artifact[]> {
  if (!scope) {
    const collected: Artifact[] = await scanSource(root)
    for (const platform of ACTIVE_PLATFORMS) {
      collected.push(...(await scanPlatform(root, platform)))
    }
    return dedupeByTypeId(collected)
  }

  const loaded = await loadProjectScope(root, scope)
  const inherits: ScopeToken[] = loaded.ok ? loaded.project.inherits : []
  const allow = (type: ArtifactType): boolean => inherits.includes(TOKEN_BY_TYPE[type])

  const collected: Artifact[] = []
  collected.push(...(await scanSource(root, scope)))
  collected.push(...(await scanSource(root)).filter((a) => allow(a.type)))
  for (const platform of ACTIVE_PLATFORMS) {
    collected.push(...(await scanPlatform(root, platform)).filter((a) => allow(a.type)))
  }
  return dedupeByTypeId(collected)
}

export async function findArtifact(
  root: string,
  type: ArtifactType,
  name: string,
  scope?: string
): Promise<Artifact | null> {
  const all = await scanWorkspace(root, scope)
  return all.find((a) => a.type === type && a.name === name) ?? null
}

/**
 * The artifact as stored in the given scope's own source tree (not an
 * inherited copy). Null when the scope does not own that artifact.
 */
export async function findScopedSourceArtifact(
  root: string,
  type: ArtifactType,
  name: string,
  scope?: string
): Promise<Artifact | null> {
  const local = (await scanSource(root, scope)).find(
    (a) => a.type === type && a.name === name
  )
  return local ?? null
}

/** True if the platform marker directory exists in the workspace. */
export async function detectPlatforms(root: string): Promise<Platform[]> {
  const present: Platform[] = []
  for (const platform of Object.keys(PLATFORM_LAYOUTS) as Platform[]) {
    const dir = resolveInWorkspace(root, PLATFORM_LAYOUTS[platform].root)
    if (await pathExists(dir)) present.push(platform)
  }
  return present
}

export { path }
