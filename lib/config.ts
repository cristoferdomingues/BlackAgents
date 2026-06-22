import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Local app configuration persisted to ~/.black-agents/config.json.
 * Server-only: imported exclusively by route handlers.
 *
 * The app manages an explicit list of saved `workspaces` plus the `currentPath`
 * of the active one. `currentPath` keeps its name (rather than `activePath`) so
 * the rest of the server — fs-service, artifacts/graph/export routes — needs no
 * changes; here it always means "the active workspace".
 */

export interface AppConfig {
  /** Absolute path of the currently active workspace. */
  currentPath?: string
  /** All saved workspace paths (insertion order, de-duplicated). */
  workspaces: string[]
}

/** Shape of older config files, kept for one-time migration. */
interface LegacyConfig {
  currentPath?: string
  recents?: string[]
  workspaces?: string[]
}

const DEFAULT_CONFIG: AppConfig = { workspaces: [] }

function expandHome(p: string): string {
  if (p === "~") return os.homedir()
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2))
  return p
}

function configDir(): string {
  const override = process.env.BLACK_AGENTS_CONFIG_DIR
  return override ? expandHome(override) : path.join(os.homedir(), ".black-agents")
}

function configFile(): string {
  return path.join(configDir(), "config.json")
}

/** De-duplicate while preserving first-seen order. */
function unique(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

export async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(configFile(), "utf8")
    const parsed = JSON.parse(raw) as LegacyConfig
    // Migrate the legacy `recents` field into the explicit `workspaces` list.
    const workspaces = unique([
      parsed.currentPath,
      ...(parsed.workspaces ?? []),
      ...(parsed.recents ?? []),
    ])
    const currentPath =
      parsed.currentPath && workspaces.includes(parsed.currentPath)
        ? parsed.currentPath
        : workspaces[0]
    return { currentPath, workspaces }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export async function writeConfig(config: AppConfig): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true })
  await fs.writeFile(configFile(), JSON.stringify(config, null, 2), "utf8")
}

/** Add a workspace to the saved list. Activates it if none is active yet. */
export async function addWorkspace(absPath: string): Promise<AppConfig> {
  const config = await readConfig()
  const workspaces = unique([...config.workspaces, absPath])
  const next: AppConfig = {
    currentPath: config.currentPath ?? absPath,
    workspaces,
  }
  await writeConfig(next)
  return next
}

/** Set the active workspace, adding it to the saved list if necessary. */
export async function setActiveWorkspace(absPath: string): Promise<AppConfig> {
  const config = await readConfig()
  const workspaces = unique([...config.workspaces, absPath])
  const next: AppConfig = { currentPath: absPath, workspaces }
  await writeConfig(next)
  return next
}

/** Remove a workspace; if it was active, fall back to the first remaining. */
export async function removeWorkspace(absPath: string): Promise<AppConfig> {
  const config = await readConfig()
  const workspaces = config.workspaces.filter((p) => p !== absPath)
  const currentPath =
    config.currentPath === absPath ? workspaces[0] : config.currentPath
  const next: AppConfig = { currentPath, workspaces }
  await writeConfig(next)
  return next
}

export { expandHome }
