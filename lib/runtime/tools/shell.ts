import { spawn } from "node:child_process"
import { z } from "zod"

import { resolveInWorkspace } from "@/lib/fs-service"

import type { RuntimeTool } from "../types"

export const SHELL_OUTPUT_CAP = 20_000
export const SHELL_DEFAULT_TIMEOUT_MS = 60_000
export const SHELL_MAX_TIMEOUT_MS = 300_000

const shellArgs = z.object({
  command: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[\w./@+-]+$/, "Command must be a program name or path, without spaces or shell syntax"),
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
 * Run one program with arguments, never through a shell string, so the model
 * cannot chain commands with `;`, `&&`, pipes, or redirects.
 */
export function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal }
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const stdout = new CappedBuffer()
    const stderr = new CappedBuffer()
    let timedOut = false
    let settled = false
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const finish = (exitCode: number | null, extraError?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      resolve({
        exitCode,
        stdout: stdout.text,
        stderr: extraError ? `${stderr.text}${extraError}` : stderr.text,
        timedOut,
        truncated: stdout.truncated || stderr.truncated,
      })
    }
    const onAbort = () => child.kill("SIGTERM")
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, options.timeoutMs)
    options.signal?.addEventListener("abort", onAbort, { once: true })
    child.stdout.on("data", (c: Buffer) => stdout.push(c))
    child.stderr.on("data", (c: Buffer) => stderr.push(c))
    child.on("error", (err) => finish(null, err.message))
    child.on("close", (code) => finish(code))
  })
}

export const shellRunTool: RuntimeTool = {
  name: "shell_run",
  originalName: "shell_run",
  server: "builtin",
  source: "builtin",
  risk: "exec",
  timeoutMs: SHELL_MAX_TIMEOUT_MS + 5_000,
  description:
    "Run one program inside the workspace, e.g. {\"command\":\"npm\",\"args\":[\"test\"]}. No shell syntax (pipes, &&, redirects). The user must approve every call.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Program name or path" },
      args: { type: "array", items: { type: "string" } },
      cwd: { type: "string", description: "Folder relative to the workspace root" },
      timeoutMs: { type: "number" },
    },
    required: ["command"],
  },
  summarize(args) {
    const list = Array.isArray(args.args) ? args.args.map(String) : []
    return `$ ${[String(args.command ?? ""), ...list].join(" ")}`
  },
  async execute(args, ctx) {
    const parsed = shellArgs.safeParse(args)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid arguments" }
    }
    const cwd = resolveInWorkspace(ctx.workspaceRoot, parsed.data.cwd)
    const result = await runProcess(parsed.data.command, parsed.data.args, {
      cwd,
      timeoutMs: parsed.data.timeoutMs,
      signal: ctx.signal,
    })
    return {
      result,
      error:
        result.exitCode === 0
          ? undefined
          : result.timedOut
            ? "Command timed out"
            : `Command exited with code ${String(result.exitCode)}`,
    }
  },
}
