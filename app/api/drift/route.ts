import matter from "gray-matter"

import { ok, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { scanWorkspace, detectPlatforms } from "@/lib/artifacts/parser"
import { PLATFORM_LAYOUTS, artifactRelPath } from "@/lib/artifacts/layout"
import { frontmatterFor } from "@/lib/export/adapter"
import { pathExists, readText, resolveInWorkspace } from "@/lib/fs-service"
import type { Artifact, ArtifactType, Platform } from "@/lib/artifacts/types"

/**
 * Read-only drift report: for every platform present in the active workspace,
 * compare the canonical artifacts (the deduped scan, which prefers Cursor)
 * against what's actually on disk for that platform.
 *
 * Comparison is *semantic*, not byte-exact: a file is "in-sync" when its
 * managed frontmatter keys and body match, regardless of formatting. This is
 * what keeps the platform an artifact was read from from showing as drifted
 * purely because re-serialization reorders or re-quotes the frontmatter.
 */

type DriftStatus = "in-sync" | "drifted" | "missing"

interface DriftFile {
  id: string
  name: string
  type: ArtifactType
  path: string
  status: DriftStatus
}

function semanticStatus(
  existingRaw: string | null,
  artifact: Artifact,
  platform: Platform
): DriftStatus {
  if (existingRaw === null) return "missing"

  const parsed = matter(existingRaw)
  const onDiskBody = parsed.content.replace(/^\n+/, "").trimEnd()
  if (onDiskBody.trim() !== artifact.body.trim()) return "drifted"

  // Only the keys we manage must match; extra keys the user added are ignored.
  const expected = frontmatterFor(platform, artifact)
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(parsed.data[key]) !== JSON.stringify(value)) {
      return "drifted"
    }
  }
  return "in-sync"
}

export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return ok({ platforms: [] })
    const root = config.currentPath

    const present = await detectPlatforms(root)
    const artifacts = await scanWorkspace(root)

    const platforms = []
    for (const platform of present) {
      const files: DriftFile[] = []
      const counts = { "in-sync": 0, drifted: 0, missing: 0 }

      for (const artifact of artifacts) {
        const rel = artifactRelPath(platform, artifact.type, artifact.name)
        const abs = resolveInWorkspace(root, rel)
        const existing = (await pathExists(abs)) ? await readText(abs) : null
        const status = semanticStatus(existing, artifact, platform)
        counts[status] += 1
        files.push({
          id: `${artifact.type}:${artifact.name}`,
          name: artifact.name,
          type: artifact.type,
          path: rel,
          status,
        })
      }

      platforms.push({
        platform,
        label: PLATFORM_LAYOUTS[platform].label,
        summary: { total: artifacts.length, ...counts },
        files,
      })
    }

    return ok({ platforms })
  })
}
