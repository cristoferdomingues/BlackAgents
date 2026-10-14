import { execFile } from "node:child_process"
import os from "node:os"
import path from "node:path"

/**
 * Apps opened from the Dock or Finder get a minimal PATH (`/usr/bin:/bin:…`),
 * so `node`, `pnpm`, Homebrew or nvm tools are "not found". Commands run with
 * the PATH of the user's login shell plus the usual tool folders.
 */

const MARKER = "__BLACK_AGENTS_PATH__"
const LOOKUP_TIMEOUT_MS = 5_000

/** Folders where developer tools usually live, in priority order. */
export function commonToolDirs(home: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") return []
  return [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    path.join(home, ".volta", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".deno", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, "Library", "pnpm"),
    path.join(home, ".local", "share", "pnpm"),
    path.join(home, ".asdf", "shims"),
    path.join(home, ".local", "share", "mise", "shims"),
  ]
}

/** Join PATH lists, keeping the first copy of each folder. */
export function mergePathLists(delimiter: string, ...lists: Array<string | undefined>): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const dir of (list ?? "").split(delimiter)) {
      const trimmed = dir.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out.join(delimiter)
}

/** The PATH printed between markers (profile scripts may print other text). */
export function parseMarkedPath(output: string): string | null {
  const start = output.indexOf(MARKER)
  const end = output.lastIndexOf(MARKER)
  if (start === -1 || end <= start) return null
  const value = output.slice(start + MARKER.length, end).trim()
  return value || null
}

function loginShellPath(shell: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", `printf '%s%s%s' '${MARKER}' "$PATH" '${MARKER}'`],
      { timeout: LOOKUP_TIMEOUT_MS, env: { ...process.env, TERM: "dumb" }, encoding: "utf8" },
      (_error, stdout) => resolve(parseMarkedPath(String(stdout ?? "")))
    )
  })
}

let cached: Promise<NodeJS.ProcessEnv> | null = null

/** process.env with a PATH that finds the user's tools. Resolved once. */
export function commandEnv(): Promise<NodeJS.ProcessEnv> {
  cached ??= (async () => {
    if (process.platform === "win32") return { ...process.env }
    const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
    const fromShell = await loginShellPath(shell)
    return {
      ...process.env,
      PATH: mergePathLists(
        path.delimiter,
        fromShell ?? undefined,
        process.env.PATH,
        commonToolDirs(os.homedir()).join(path.delimiter)
      ),
    }
  })()
  return cached
}

/** Test helper. */
export function resetCommandEnv(): void {
  cached = null
}
