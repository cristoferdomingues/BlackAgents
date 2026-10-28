import { spawn } from "node:child_process"
import { z } from "zod"

import { resolveInWorkspace } from "@/lib/fs-service"

import { hostShell, unixOnlyCommand } from "../host-shell"
import { commandEnv } from "../shell-env"
import type { RuntimeTool } from "../types"
import { toolArgsError } from "./args"

export const SHELL_OUTPUT_CAP = 20_000
export const SHELL_DEFAULT_TIMEOUT_MS = 120_000
export const SHELL_MAX_TIMEOUT_MS = 600_000
export const SHELL_MAX_COMMAND_CHARS = 8_000

const PROGRAM = /^[\w./@+-]+$/

const shellArgs = z.object({
  command: z.string().trim().min(1).max(SHELL_MAX_COMMAND_CHARS),
  args: z.array(z.string().max(4_000)).max(50).default([]),
  cwd: z.string().trim().default("."),
  timeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(SHELL_MAX_TIMEOUT_MS)
    .default(SHELL_DEFAULT_TIMEOUT_MS),
})

export interface ShellResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  truncated: boolean
}

class CappedBuffer {
  text = ""
  truncated = false
  push(chunk: Buffer): void {
    if (this.text.length >= SHELL_OUTPUT_CAP) {
      this.truncated = true
      return
    }
    const next = this.text + chunk.toString("utf8")
    if (next.length > SHELL_OUTPUT_CAP) {
      this.text = next.slice(0, SHELL_OUTPUT_CAP)
      this.truncated = true
    } else {
      this.text = next
    }
  }
}

/**
 * A plain program name plus `args` runs directly. Anything else (spaces,
 * pipes, `&&`, redirects) is a command line for the system shell.
 */
export function isCommandLine(command: string, args: string[]): boolean {
  return args.length === 0 && !PROGRAM.test(command)
}

/** Run one program, or one shell command line when `shell` is true. */
export function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string
    timeoutMs: number
    signal?: AbortSignal
    shell?: boolean
    env?: NodeJS.ProcessEnv
  }
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const stdout = new CappedBuffer()
    const stderr = new CappedBuffer()
    let timedOut = false
    let settled = false
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })
    const kill = () => {
      try {
        // Kill the whole group so dev servers started by `sh -c` stop too.
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM")
        else child.kill("SIGTERM")
      } catch {
        child.kill("SIGTERM")
      }
    }
    const finish = (exitCode: number | null, extraError?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", kill)
      resolve({
        exitCode,
        stdout: stdout.text,
        stderr: extraError ? `${stderr.text}${extraError}` : stderr.text,
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
      })
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, options.timeoutMs)
    options.signal?.addEventListener("abort", kill, { once: true })
    child.stdout.on("data", (c: Buffer) => stdout.push(c))
    child.stderr.on("data", (c: Buffer) => stderr.push(c))
    child.on("error", (err) => finish(null, err.message))
    child.on("close", (code) => finish(code))
  })
}

/** Why a finished command failed, including a rewrite hint when the shell was wrong. */
export function shellFailureMessage(
  result: Pick<ShellResult, "exitCode" | "stderr" | "timedOut">,
  command: string,
  interpreter: string = hostShell().interpreter
): string | undefined {
  if (result.exitCode === 0) return undefined
  if (result.timedOut) return "Command timed out"
  const name = command.trim().split(/\s+/)[0] ?? command
  const unrecognizedCmd =
    interpreter === "cmd.exe" && /is not recognized as an internal or external command/i.test(result.stderr)
  const unrecognizedPowerShell =
    interpreter === "PowerShell" && /is not recognized as the name of a cmdlet/i.test(result.stderr)
  if ((unrecognizedCmd || unrecognizedPowerShell) && unixOnlyCommand(name)) {
    const syntax = interpreter === "cmd.exe" ? "cmd.exe syntax (dir, type, findstr)" : "PowerShell syntax"
    return `Command exited with code ${String(result.exitCode)}. '${name}' is a Unix command and this shell is ${interpreter}. Rewrite it with ${syntax}. Do not try another shell.`
  }
  if (
    (result.exitCode === null && /ENOENT/.test(result.stderr)) ||
    result.exitCode === 127 ||
    unrecognizedCmd ||
    unrecognizedPowerShell
  ) {
    return `Program not found: ${command}. Install it or check the PATH.`
  }
  return `Command exited with code ${String(result.exitCode)}`
}

const runningHost = hostShell()

export const shellRunTool: RuntimeTool = {
  name: "shell_run",
  originalName: "shell_run",
  server: "builtin",
  source: "builtin",
  risk: "exec",
  timeoutMs: SHELL_MAX_TIMEOUT_MS + 5_000,
  description:
    "Run a terminal command inside the workspace and get its exit code, stdout and stderr. " +
    `${runningHost.guidance} ` +
    "Pass a full command line, e.g. {\"command\":\"npm install && npm test\"} (pipes, &&, redirects work), " +
    "or a program with args, e.g. {\"command\":\"node\",\"args\":[\"--version\"]}. " +
    "A program plus args runs directly, with no shell, and works the same on every operating system. " +
    "`cwd` is a folder relative to the workspace root. Commands must finish on their own: do not start " +
    "dev servers or watch modes (use build/test commands instead). The user approves every call.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: `A full command line for ${runningHost.interpreter}, or a program name when args are given`,
      },
      args: { type: "array", items: { type: "string" } },
      cwd: { type: "string", description: "Folder relative to the workspace root" },
      timeoutMs: { type: "number", description: `Default ${SHELL_DEFAULT_TIMEOUT_MS}, max ${SHELL_MAX_TIMEOUT_MS}` },
    },
    required: ["command"],
  },
  summarize(args) {
    const list = Array.isArray(args.args) ? args.args.map(String) : []
    const cwd = typeof args.cwd === "string" && args.cwd.trim() && args.cwd.trim() !== "." ? ` (in ${args.cwd.trim()})` : ""
    return `$ ${[String(args.command ?? ""), ...list].join(" ")}${cwd}`
  },
  async execute(args, ctx) {
    const parsed = shellArgs.safeParse(args)
    if (!parsed.success) {
      return { error: toolArgsError(parsed.error) }
    }
    const { command, args: list, timeoutMs } = parsed.data
    const shell = isCommandLine(command, list)
    if (!shell && command.length > 200) return { error: "Program name is too long" }
    const cwd = resolveInWorkspace(ctx.workspaceRoot, parsed.data.cwd)
    const result = await runProcess(command, list, {
      cwd,
      timeoutMs,
      signal: ctx.signal,
      shell,
      env: await commandEnv(),
    })
    return { result, error: shellFailureMessage(result, shell ? command.split(/\s+/)[0] ?? command : command) }
  },
}
