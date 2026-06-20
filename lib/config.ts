import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Local app configuration persisted to ~/.black-agents/config.json.
 * Server-only: imported exclusively by route handlers.
 */

export interface AppConfig {
  /** Absolute path of the currently active workspace. */
  currentPath?: string
  /** Most-recently-used workspace paths (newest first). */
  recents: string[]
}

const DEFAULT_CONFIG: AppConfig = { recents: [] }
const MAX_RECENTS = 12

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

export async function readConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(configFile(), "utf8")
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return {
      currentPath: parsed.currentPath,
      recents: Array.isArray(parsed.recents) ? parsed.recents : [],
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export async function writeConfig(config: AppConfig): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true })
  await fs.writeFile(configFile(), JSON.stringify(config, null, 2), "utf8")
}

export async function setCurrentWorkspace(absPath: string): Promise<AppConfig> {
  const config = await readConfig()
  const recents = [absPath, ...config.recents.filter((p) => p !== absPath)].slice(
    0,
    MAX_RECENTS
  )
  const next: AppConfig = { currentPath: absPath, recents }
  await writeConfig(next)
  return next
}

export async function removeRecent(absPath: string): Promise<AppConfig> {
  const config = await readConfig()
  const recents = config.recents.filter((p) => p !== absPath)
  const currentPath =
    config.currentPath === absPath ? undefined : config.currentPath
  const next: AppConfig = { currentPath, recents }
  await writeConfig(next)
  return next
}

export { expandHome }
