import { realpathAbs } from "@/lib/fs-service"
import { commandEnv } from "@/lib/runtime/shell-env"
import { isCommandLine, runProcess, SHELL_DEFAULT_TIMEOUT_MS, type ShellResult } from "@/lib/runtime/tools/shell"

import { K0dingError } from "./errors"

const BLOCKED_GIT = new Set([
  "add",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "init",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
  "tag",
])

/** K0ding can show git status and git diff. It does not change history or branches. */
export function blockedCommandReason(command: string): string | null {
  const tokens = command.trim().split(/\s+/)
  const gitAt = tokens.findIndex((token) => token === "git" || token.endsWith("/git"))
  if (gitAt < 0) return null
  const sub = tokens.slice(gitAt + 1).find((token) => token.length > 0 && !token.startsWith("-"))
  if (sub && BLOCKED_GIT.has(sub)) {
    return "K0ding does not commit, push, or change branches. You can run git status and git diff."
  }
  return null
}

/** Run one command in the code folder. The working directory cannot be changed. */
export async function runCodeCommand(
  root: string,
  command: string,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<ShellResult> {
  const blocked = blockedCommandReason(command)
  if (blocked) throw new K0dingError(blocked)
  const cwd = await realpathAbs(root)
  const timeoutMs = options?.timeoutMs ?? SHELL_DEFAULT_TIMEOUT_MS
  const shell = isCommandLine(command, [])
  return runProcess(shell ? command : command, [], {
    cwd,
    timeoutMs,
    signal: options?.signal,
    shell,
    env: await commandEnv(),
  })
}
