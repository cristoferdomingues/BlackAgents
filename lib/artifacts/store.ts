import matter from "gray-matter"
import path from "node:path"
import { z } from "zod"

import { artifactToFile } from "../export/adapter"
import {
  copyFile,
  pathExists,
  readText,
  removePath,
  resolveInWorkspace,
  writeText,
} from "../fs-service"
import { ACTIVE_PLATFORMS, DEFAULT_PLATFORM, PLATFORM_LAYOUTS, artifactDeletePath } from "./layout"
import { findArtifact, findScopedSourceArtifact, scanPlatform, scanSource, scanWorkspace } from "./parser"
import { platformSchema, type ArtifactInput } from "./schemas"
import { serializeArtifact } from "./serializer"
import { sourceDeletePath, sourceRelPath } from "./source"
import type { Artifact, ArtifactType, Platform } from "./types"

/**
 * Saves go to `.black-agents/artifacts/` (the source) and are then exported to
 * the workspace's IDE targets. Server-only.
 */

export const EXPORT_SETTINGS_REL_PATH = ".black-agents/export.json"

const ALL_PLATFORMS = Object.keys(PLATFORM_LAYOUTS) as Platform[]

const exportSettingsSchema = z.object({ targets: z.array(platformSchema) })

export interface ExportTargets {
  targets: Platform[]
  /** False when nothing was saved yet and the targets are the defaults. */
  saved: boolean
}

export class ArtifactStoreError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

function orderTargets(targets: Platform[]): Platform[] {
  return ALL_PLATFORMS.filter((platform) => targets.includes(platform))
}

/** IDE folders to export to. Default: the scanned IDE folders present, else Cursor. */
export async function readExportTargets(root: string): Promise<ExportTargets> {
  const abs = resolveInWorkspace(root, EXPORT_SETTINGS_REL_PATH)
  if (await pathExists(abs)) {
    try {
      const parsed = exportSettingsSchema.safeParse(JSON.parse(await readText(abs)) as unknown)
      if (parsed.success) return { targets: orderTargets(parsed.data.targets), saved: true }
    } catch {
      // A broken file falls back to the defaults.
    }
  }
  const present: Platform[] = []
  for (const platform of ACTIVE_PLATFORMS) {
    if (await pathExists(resolveInWorkspace(root, PLATFORM_LAYOUTS[platform].root))) present.push(platform)
  }
  return { targets: present.length > 0 ? present : [DEFAULT_PLATFORM], saved: false }
}

export async function writeExportTargets(root: string, targets: Platform[]): Promise<ExportTargets> {
  const ordered = orderTargets(targets)
  await writeText(
    resolveInWorkspace(root, EXPORT_SETTINGS_REL_PATH),
    `${JSON.stringify({ targets: ordered }, null, 2)}\n`
  )
  return { targets: ordered, saved: true }
}

async function copySupportingFiles(root: string, artifact: Artifact, toEntryRel: string): Promise<void> {
  const fromDir = path.posix.dirname(artifact.relativePath)
  const toDir = path.posix.dirname(toEntryRel)
  if (fromDir === toDir) return
  for (const rel of artifact.supportingFiles ?? []) {
    await copyFile(resolveInWorkspace(root, `${fromDir}/${rel}`), resolveInWorkspace(root, `${toDir}/${rel}`))
  }
}

/** Write one artifact into each target IDE folder. Returns the files that changed. */
export async function exportArtifact(root: string, artifact: Artifact, targets: Platform[]): Promise<string[]> {
  const written: string[] = []
  for (const platform of targets) {
    const file = artifactToFile(artifact, platform)
    const abs = resolveInWorkspace(root, file.path)
    const current = (await pathExists(abs)) ? await readText(abs) : null
    if (current !== file.content) {
      await writeText(abs, file.content)
      written.push(file.path)
    }
    await copySupportingFiles(root, artifact, file.path)
  }
  return written
}

/** Remove an artifact's copies from every IDE folder. */
async function removeEverywhere(root: string, type: ArtifactType, name: string): Promise<void> {
  for (const platform of ALL_PLATFORMS) {
    await removePath(resolveInWorkspace(root, artifactDeletePath(platform, type, name)))
  }
}

function ideDeletePath(artifact: Artifact): string {
  return artifact.type === "skill" ? path.posix.dirname(artifact.relativePath) : artifact.relativePath
}

async function finishSave(
  root: string,
  type: ArtifactType,
  name: string,
  scope?: string
): Promise<Artifact> {
  const saved = (await scanSource(root, scope)).find((a) => a.type === type && a.name === name)
  if (!saved) throw new ArtifactStoreError(`The ${type} "${name}" was not saved`, 500)
  // Project artifacts stay inside the project tree; IDE folders stay workspace-level.
  if (scope) return saved
  const { targets } = await readExportTargets(root)
  await exportArtifact(root, saved, targets)
  return saved
}

/**
 * Save an artifact into a scope's source tree. Without a scope that is the
 * workspace source (then exported to IDE folders); with `scope` it is the
 * project tree and nothing is exported. Creating over an *inherited* name is
 * allowed on purpose: project-local entries win on collision.
 */
export async function createArtifact(
  root: string,
  input: ArtifactInput,
  scope?: string
): Promise<Artifact> {
  const exists = scope
    ? await findScopedSourceArtifact(root, input.type, input.name, scope)
    : await findArtifact(root, input.type, input.name)
  if (exists) {
    throw new ArtifactStoreError(`A ${input.type} named "${input.name}" already exists`, 409)
  }
  const { relPath, content } = serializeArtifact(input, undefined, scope)
  await writeText(resolveInWorkspace(root, relPath), content)
  return finishSave(root, input.type, input.name, scope)
}

/**
 * Save over an existing artifact (optionally renaming it). An IDE-only artifact
 * moves into the source folder, supporting files included.
 *
 * In a project scope only project-local artifacts can change; inherited
 * workspace copies are read-only (403) so a child can never mutate its parent.
 */
export async function updateArtifact(
  root: string,
  originalName: string,
  input: ArtifactInput,
  scope?: string
): Promise<Artifact> {
  const existing = await findArtifact(root, input.type, originalName, scope)
  if (!existing) throw new ArtifactStoreError(`Not found: ${input.type}/${originalName}`, 404)
  if (scope && existing.scope?.project !== scope) {
    throw new ArtifactStoreError(
      `Inherited ${input.type} "${originalName}" is read-only in project "${scope}" — create a project copy to change it`,
      403
    )
  }
  const renamed = input.name !== originalName
  if (renamed) {
    const clash = scope
      ? await findScopedSourceArtifact(root, input.type, input.name, scope)
      : await findArtifact(root, input.type, input.name)
    if (clash) {
      throw new ArtifactStoreError(`A ${input.type} named "${input.name}" already exists`, 409)
    }
  }

  const { relPath, content } = serializeArtifact(input, existing.frontmatter, scope)
  await copySupportingFiles(root, existing, relPath)
  await writeText(resolveInWorkspace(root, relPath), content)

  if (renamed) {
    if (existing.managed) {
      await removePath(resolveInWorkspace(root, sourceDeletePath(input.type, originalName, scope)))
    }
    // IDE copies only ever belong to the workspace scope.
    if (!scope) await removeEverywhere(root, input.type, originalName)
  }
  return finishSave(root, input.type, input.name, scope)
}

/** Delete the artifact from the source and from every IDE folder. */
export async function deleteArtifact(
  root: string,
  type: ArtifactType,
  name: string,
  scope?: string
): Promise<void> {
  const existing = await findArtifact(root, type, name, scope)
  if (!existing) throw new ArtifactStoreError(`Not found: ${type}/${name}`, 404)
  if (scope) {
    if (existing.scope?.project !== scope) {
      throw new ArtifactStoreError(
        `Inherited ${type} "${name}" cannot be deleted from project "${scope}"`,
        403
      )
    }
    await removePath(resolveInWorkspace(root, sourceDeletePath(type, name, scope)))
    return
  }
  if (existing.managed) {
    await removePath(resolveInWorkspace(root, sourceDeletePath(type, name)))
    await removeEverywhere(root, type, name)
  } else {
    await removePath(resolveInWorkspace(root, ideDeletePath(existing)))
  }
}

/** Copy an IDE artifact into the source, keeping source-only keys (tools, provider…). */
async function adopt(root: string, ide: Artifact, current: Artifact | undefined): Promise<void> {
  const frontmatter = { ...(current?.frontmatter ?? {}), ...ide.frontmatter }
  const body = ide.body.trim()
  const relPath = sourceRelPath(ide.type, ide.name)
  await copySupportingFiles(root, ide, relPath)
  await writeText(resolveInWorkspace(root, relPath), matter.stringify(body ? `\n${body}\n` : "\n", frontmatter))
}

export interface ImportResult {
  imported: string[]
  written: string[]
}

/**
 * Move IDE-only artifacts into the source. With `only`, take that IDE copy of
 * one artifact instead (for "keep the IDE version" after a hand edit).
 */
export async function importArtifacts(
  root: string,
  only?: { platform: Platform; type: ArtifactType; name: string }
): Promise<ImportResult> {
  const source = await scanSource(root)
  let picked: Artifact[]
  if (only) {
    const copy = (await scanPlatform(root, only.platform)).find(
      (a) => a.type === only.type && a.name === only.name
    )
    if (!copy) throw new ArtifactStoreError(`No ${only.platform} copy of ${only.type}/${only.name}`, 404)
    picked = [copy]
  } else {
    picked = (await scanWorkspace(root)).filter((a) => !a.managed && !a.builtin)
  }

  for (const ide of picked) {
    await adopt(root, ide, source.find((a) => a.type === ide.type && a.name === ide.name))
  }
  const { written } = await exportAll(root, picked.map((a) => `${a.type}:${a.name}`))
  return { imported: picked.map((a) => `${a.type}:${a.name}`), written }
}

/** Export source artifacts (all, or only the given ids) to the IDE targets. */
export async function exportAll(root: string, ids?: string[]): Promise<{ written: string[] }> {
  const { targets } = await readExportTargets(root)
  const written: string[] = []
  for (const artifact of await scanSource(root)) {
    if (ids && !ids.includes(`${artifact.type}:${artifact.name}`)) continue
    written.push(...(await exportArtifact(root, artifact, targets)))
  }
  return { written }
}
