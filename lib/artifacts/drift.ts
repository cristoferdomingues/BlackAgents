import matter from "gray-matter"

import { exportedFrontmatter } from "../export/adapter"
import { pathExists, readText, resolveInWorkspace } from "../fs-service"
import { ACTIVE_PLATFORMS, PLATFORM_LAYOUTS, artifactRelPath } from "./layout"
import { scanSource, scanWorkspace } from "./parser"
import { readExportTargets } from "./store"
import type { Artifact, ArtifactType, Platform } from "./types"

/**
 * Compare the source copies with each IDE folder. Semantic, not byte-exact:
 * a file is "in-sync" when its body and the keys BlackAgents writes match.
 */

export type DriftStatus = "in-sync" | "drifted" | "missing"

export interface DriftFile {
  id: string
  name: string
  type: ArtifactType
  path: string
  status: DriftStatus
}

export interface PlatformDrift {
  platform: Platform
  label: string
  /** True when saves export to this IDE folder. */
  target: boolean
  summary: { total: number; "in-sync": number; drifted: number; missing: number }
  files: DriftFile[]
}

export interface IdeOnlyArtifact {
  id: string
  name: string
  type: ArtifactType
  platform: Platform
  path: string
}

export interface DriftReport {
  targets: Platform[]
  targetsSaved: boolean
  sourceCount: number
  ideOnly: IdeOnlyArtifact[]
  platforms: PlatformDrift[]
}

export function semanticStatus(existingRaw: string | null, artifact: Artifact, platform: Platform): DriftStatus {
  if (existingRaw === null) return "missing"
  const parsed = matter(existingRaw)
  if (parsed.content.trim() !== artifact.body.trim()) return "drifted"
  const expected = exportedFrontmatter(platform, artifact)
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(parsed.data[key]) !== JSON.stringify(value)) return "drifted"
  }
  return "in-sync"
}

export async function driftReport(root: string): Promise<DriftReport> {
  const { targets, saved } = await readExportTargets(root)
  const source = await scanSource(root)
  const ideOnly = (await scanWorkspace(root))
    .filter((a) => !a.managed && !a.builtin)
    .map((a) => ({ id: `${a.type}:${a.name}`, name: a.name, type: a.type, platform: a.platform, path: a.relativePath }))

  const shown: Platform[] = [...targets]
  for (const platform of ACTIVE_PLATFORMS) {
    if (shown.includes(platform)) continue
    if (await pathExists(resolveInWorkspace(root, PLATFORM_LAYOUTS[platform].root))) shown.push(platform)
  }

  const platforms: PlatformDrift[] = []
  for (const platform of shown) {
    const files: DriftFile[] = []
    const summary = { total: source.length, "in-sync": 0, drifted: 0, missing: 0 }
    for (const artifact of source) {
      const rel = artifactRelPath(platform, artifact.type, artifact.name)
      const abs = resolveInWorkspace(root, rel)
      const status = semanticStatus((await pathExists(abs)) ? await readText(abs) : null, artifact, platform)
      summary[status] += 1
      files.push({ id: `${artifact.type}:${artifact.name}`, name: artifact.name, type: artifact.type, path: rel, status })
    }
    platforms.push({ platform, label: PLATFORM_LAYOUTS[platform].label, target: targets.includes(platform), summary, files })
  }

  return { targets, targetsSaved: saved, sourceCount: source.length, ideOnly, platforms }
}
