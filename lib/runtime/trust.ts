import { promises as fs } from "node:fs"
import path from "node:path"
import { z } from "zod"

import { configDir } from "@/lib/config"

import { normalizeShellProgram } from "./tools/shell-risk"

/**
 * Approval trust the user remembers across chats, stored at the user level
 * (`~/.black-agents/approval-trust.json`) rather than inside the workspace.
 * Keeping it out of the project means a cloned repository cannot ship
 * pre-authorized shell commands.
 *
 * - `shellCommands` — programs whose plain write-risk commands run without a
 *   card (`mkdir`, `cp`, `npm`). Read-only commands never needed one, and
 *   `exec` commands (redirects, installs, arbitrary code) always ask.
 *
 * MCP trust lives in `.black-agents/mcp-policy.json` (see `lib/mcp/policy`).
 */

export const TRUST_FILENAME = "approval-trust.json"

export const workspaceTrustSchema = z.object({
  shellCommands: z.array(z.string()).default([]),
})
export type WorkspaceTrust = z.infer<typeof workspaceTrustSchema>

export const trustFileSchema = z.object({
  workspaces: z.record(workspaceTrustSchema).default({}),
})
export type TrustFile = z.infer<typeof trustFileSchema>

/** Absolute path of the user-level trust file. */
export function trustFilePath(): string {
  return path.join(configDir(), TRUST_FILENAME)
}

function emptyTrustFile(): TrustFile {
  return { workspaces: {} }
}

async function readTrustFile(): Promise<TrustFile> {
  try {
    const parsed = trustFileSchema.safeParse(
      JSON.parse(await fs.readFile(trustFilePath(), "utf8")) as unknown
    )
    return parsed.success ? parsed.data : emptyTrustFile()
  } catch {
    return emptyTrustFile()
  }
}

/** Trust for one workspace, keyed by its absolute path. */
export async function readWorkspaceTrust(workspaceRoot: string): Promise<WorkspaceTrust> {
  const file = await readTrustFile()
  return file.workspaces[path.resolve(workspaceRoot)] ?? { shellCommands: [] }
}

/** Add or remove programs from one workspace's shell trust list. */
export async function setShellCommandsTrust(
  workspaceRoot: string,
  programs: readonly string[],
  trusted: boolean
): Promise<WorkspaceTrust> {
  const key = path.resolve(workspaceRoot)
  const file = await readTrustFile()
  const next = new Set(file.workspaces[key]?.shellCommands ?? [])
  for (const value of programs) {
    const program = normalizeShellProgram(value)
    if (!program) continue
    if (trusted) next.add(program)
    else next.delete(program)
  }
  const updated: WorkspaceTrust = { shellCommands: [...next].sort() }
  const workspaces = { ...file.workspaces }
  if (updated.shellCommands.length > 0) workspaces[key] = updated
  else delete workspaces[key]
  await fs.mkdir(configDir(), { recursive: true })
  await fs.writeFile(
    trustFilePath(),
    `${JSON.stringify({ workspaces } satisfies TrustFile, null, 2)}\n`,
    "utf8"
  )
  return updated
}
