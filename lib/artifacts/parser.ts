import matter from "gray-matter"
import path from "node:path"

import {
  listDir,
  pathExists,
  readText,
  resolveInWorkspace,
  walkFiles,
} from "../fs-service"
import { ACTIVE_PLATFORMS, PLATFORM_LAYOUTS, typeLayout } from "./layout"
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

function buildArtifact(
  type: ArtifactType,
  platform: Platform,
  name: string,
  relativePath: string,
  raw: string,
  supportingFiles?: string[]
): Artifact {
  const parsed = matter(raw)
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
  const layout = typeLayout(platform, type)
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

/** Scan every active platform present in the workspace, deduped by type+name. */
export async function scanWorkspace(root: string): Promise<Artifact[]> {
  const collected: Artifact[] = []
  for (const platform of ACTIVE_PLATFORMS) {
    const rootDir = resolveInWorkspace(root, PLATFORM_LAYOUTS[platform].root)
    if (!(await pathExists(rootDir))) continue
    for (const type of TYPES) {
      collected.push(...(await scanType(root, platform, type)))
    }
  }

  // Prefer the first platform (Cursor) when the same artifact exists twice.
  const seen = new Map<string, Artifact>()
  for (const artifact of collected) {
    const key = `${artifact.type}:${artifact.name}`
    if (!seen.has(key)) seen.set(key, artifact)
  }
  return [...seen.values()].sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
  )
}

export async function findArtifact(
  root: string,
  type: ArtifactType,
  name: string
): Promise<Artifact | null> {
  const all = await scanWorkspace(root)
  return all.find((a) => a.type === type && a.name === name) ?? null
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
