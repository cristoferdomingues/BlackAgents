import { composeArtifactPrompt } from "@/lib/assistant/turn-artifacts"
import { scanWorkspace } from "@/lib/artifacts/parser"
import type { Artifact } from "@/lib/artifacts/types"

import { compileGitignore, isIgnored } from "./ignore"
import { K0dingError } from "./errors"
import type { GuidancePick, GuidanceRef } from "./schema"

function keyOf(value: { type: string; name: string }): string {
  return `${value.type}:${value.name}`
}

function matchesGlob(artifact: Artifact, paths: readonly string[]): boolean {
  const patterns = artifact.frontmatter.globs ?? []
  if (patterns.length === 0 || paths.length === 0) return false
  const rules = compileGitignore(patterns.join("\n"))
  return paths.some((filePath) => isIgnored(filePath, false, rules))
}

export async function resolveGuidance(
  workspace: string,
  scope: string | undefined,
  picks: readonly GuidancePick[],
  paths: readonly string[]
): Promise<GuidanceRef[]> {
  const artifacts = (await scanWorkspace(workspace, scope)).filter(
    (artifact) => artifact.type === "agent" || artifact.type === "rule" || artifact.type === "skill"
  )
  const byKey = new Map(artifacts.map((artifact) => [keyOf(artifact), artifact]))
  const refs = new Map<string, GuidanceRef>()

  for (const artifact of artifacts) {
    if (artifact.type !== "rule") continue
    if (artifact.frontmatter.alwaysApply === true) {
      refs.set(keyOf(artifact), { type: "rule", name: artifact.name, source: "always" })
    } else if (matchesGlob(artifact, paths)) {
      refs.set(keyOf(artifact), { type: "rule", name: artifact.name, source: "glob" })
    }
  }

  for (const pick of picks) {
    if (!byKey.has(keyOf(pick))) throw new K0dingError(`Guidance not found: ${pick.name}`)
    refs.set(keyOf(pick), { ...pick, source: "user" })
  }
  return [...refs.values()].slice(0, 20)
}

export async function guidancePrompt(
  workspace: string,
  scope: string | undefined,
  refs: readonly GuidanceRef[]
): Promise<string> {
  if (refs.length === 0) return ""
  const artifacts = await scanWorkspace(workspace, scope)
  const byKey = new Map(artifacts.map((artifact) => [keyOf(artifact), artifact]))
  const selected = refs.flatMap((ref) => {
    const artifact = byKey.get(keyOf(ref))
    return artifact ? [artifact] : []
  })
  return composeArtifactPrompt(selected)
}
