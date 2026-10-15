import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { PLATFORM_LAYOUTS } from "@/lib/artifacts/layout"
import {
  buildExportManifest,
  fileStatus,
  type ExportFile,
  type ExportStatus,
} from "@/lib/export/adapter"
import {
  checkDirectory,
  normalizeWorkspaceInput,
  pathExists,
  readText,
  resolveInWorkspace,
  writeText,
} from "@/lib/fs-service"
import { buildOkfBundle } from "@/lib/knowledge/export"
import { listConcepts } from "@/lib/knowledge/store"
import type { Platform } from "@/lib/artifacts/types"

const OKF_TARGET = "okf"

function isPlatform(value: string): value is Platform {
  return value in PLATFORM_LAYOUTS
}

function isExportTarget(value: string): boolean {
  return value === OKF_TARGET || isPlatform(value)
}

/**
 * Manifest preview: the files that re-emitting the active workspace to a target
 * platform would produce (no disk comparison, no writes).
 */
export async function GET(req: Request) {
  return handle(async () => {
    const platform = new URL(req.url).searchParams.get("platform") ?? "cursor"
    if (!isExportTarget(platform)) return fail(`Unknown platform: ${platform}`)

    const config = await readConfig()
    if (!config.currentPath) return ok({ platform, files: [] })

    const files = await manifestFor(config.currentPath, platform)
    return ok({ platform, files })
  })
}

interface ExportRequest {
  platform?: string
  /** "dry-run" (default) reports a diff; "write" applies it to disk. */
  mode?: "dry-run" | "write"
  /** When false, existing files that differ are left untouched. Default true. */
  overwrite?: boolean
  /**
   * Optional folder to export into. Defaults to the active workspace.
   * Set this to write the bundle into a different repository.
   */
  targetPath?: string
}

interface FileResult {
  path: string
  status: ExportStatus
  /** Only meaningful in write mode: was the file actually written? */
  applied: boolean
}

/**
 * Export the active workspace's artifacts to a target platform layout.
 * Dry-run returns a per-file diff (create / overwrite / unchanged); write mode
 * applies it through the workspace-confined filesystem service.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const json = (await req.json().catch(() => null)) as ExportRequest | null
    const platform = json?.platform ?? "cursor"
    const mode = json?.mode === "write" ? "write" : "dry-run"
    const overwrite = json?.overwrite !== false

    if (!isExportTarget(platform)) return fail(`Unknown platform: ${platform}`)

    const config = await readConfig()
    if (!config.currentPath) return fail("No workspace selected", 400)
    const sourceRoot = config.currentPath

    // Sources are always read from the active workspace; the bundle may be
    // written into a different folder (cross-repo export).
    let targetRoot = sourceRoot
    if (json?.targetPath && json.targetPath.trim()) {
      const t = normalizeWorkspaceInput(json.targetPath)
      const chk = await checkDirectory(t)
      if (!chk.exists) return fail(`Target does not exist: ${t}`, 404)
      if (!chk.isDirectory) return fail(`Target is not a directory: ${t}`)
      targetRoot = t
    }

    const manifest = await manifestFor(sourceRoot, platform)
    const diff = await diffManifest(targetRoot, manifest, mode, overwrite)

    return ok({
      platform,
      mode,
      overwrite,
      target: targetRoot,
      summary: { total: manifest.length, ...diff.counts, written: diff.written },
      files: diff.files,
    })
  })
}

async function manifestFor(workspaceRoot: string, platform: string): Promise<ExportFile[]> {
  if (platform === OKF_TARGET) return buildOkfBundle(await listConcepts(workspaceRoot))
  if (!isPlatform(platform)) return []
  return buildExportManifest(await scanWorkspace(workspaceRoot), platform)
}

async function diffManifest(
  targetRoot: string,
  manifest: ExportFile[],
  mode: "dry-run" | "write",
  overwrite: boolean
): Promise<{ files: FileResult[]; counts: Record<ExportStatus, number>; written: number }> {
  const files: FileResult[] = []
  let written = 0
  const counts: Record<ExportStatus, number> = { create: 0, overwrite: 0, unchanged: 0 }

  for (const file of manifest) {
    const abs = resolveInWorkspace(targetRoot, file.path)
    const existing = (await pathExists(abs)) ? await readText(abs) : null
    const status = fileStatus(existing, file.content)
    counts[status] += 1

    let applied = false
    if (mode === "write") {
      const shouldWrite = status === "create" || (status === "overwrite" && overwrite)
      if (shouldWrite) {
        await writeText(abs, file.content)
        written += 1
        applied = true
      }
    }
    files.push({ path: file.path, status, applied })
  }

  return { files, counts, written }
}
