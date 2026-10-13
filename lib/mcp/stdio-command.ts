import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Extra dirs prepended when spawning stdio MCP servers. GUI-launched Node
 * (Cursor, Electron, Dock) often has a PATH without Homebrew / nvm, which
 * surfaces as `spawn npx ENOENT`.
 */
export function defaultExtraBinDirs(): string[] {
  const home = os.homedir()
  const dirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local", "bin"),
  ]

  // Sibling of the running Node binary (…/bin/node → …/bin/npx).
  const execDir = path.dirname(process.execPath)
  if (execDir && execDir !== ".") dirs.unshift(execDir)

  const nvmRoot = process.env.NVM_DIR ?? path.join(home, ".nvm")
  const nvmCurrent = path.join(nvmRoot, "versions", "node")
  // Prefer the version that matches process.version when present.
  const versionDir = path.join(nvmCurrent, process.version)
  const nvmBin = path.join(versionDir, "bin")
  if (existsSync(nvmBin)) dirs.unshift(nvmBin)

  return dirs
}

/** Merge process PATH with known Node install locations (deduped, extras first). */
export function enrichPathEnv(
  pathEnv: string | undefined,
  extraDirs: string[] = defaultExtraBinDirs()
): string {
  const delim = path.delimiter
  const existing = (pathEnv ?? "")
    .split(delim)
    .map((p) => p.trim())
    .filter(Boolean)
  const seen = new Set(existing)
  const prepend: string[] = []
  for (const dir of extraDirs) {
    if (!dir || seen.has(dir) || !existsSync(dir)) continue
    seen.add(dir)
    prepend.push(dir)
  }
  return [...prepend, ...existing].join(delim)
}

function isAbsoluteCommand(command: string): boolean {
  return path.isAbsolute(command) || command.startsWith(".") || command.includes(path.sep)
}

/** Resolve a bare command (e.g. `npx`) against PATH; return absolute path when found. */
export function resolveCommandOnPath(command: string, pathEnv: string): string {
  if (!command.trim() || isAbsoluteCommand(command)) return command

  const names =
    process.platform === "win32"
      ? [`${command}.cmd`, `${command}.exe`, command]
      : [command]

  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return command
}

export interface StdioLaunch {
  command: string
  env: Record<string, string>
}

/**
 * Build env + resolved command for StdioClientTransport.
 * Always sets an enriched PATH so Homebrew/nvm `npx` is findable.
 */
export function prepareStdioLaunch(
  command: string,
  serverEnv: Record<string, string> | undefined,
  processEnv: Record<string, string | undefined> = process.env
): StdioLaunch {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(processEnv)) {
    if (typeof v === "string") env[k] = v
  }
  if (serverEnv) {
    for (const [k, v] of Object.entries(serverEnv)) {
      env[k] = v
    }
  }

  env.PATH = enrichPathEnv(env.PATH ?? processEnv.PATH)
  const resolved = resolveCommandOnPath(command, env.PATH)
  return { command: resolved, env }
}
