import { z } from "zod"

import { pathExists, readText, resolveInWorkspace, writeText } from "@/lib/fs-service"

import { normalizeShellProgram } from "./tools/shell-risk"

/**
 * Approval trust a workspace remembers across chats. Kept next to the other
 * workspace policy files so it travels with the project:
 *
 * - `shellCommands` — programs whose plain write-risk commands run without a
 *   card (`mkdir`, `cp`). Read-only commands never needed one, and `exec`
 *   commands (redirects, installs, arbitrary code) always ask.
 *
 * MCP trust lives in `.black-agents/mcp-policy.json` (see `lib/mcp/policy`).
 */
export const workspaceTrustSchema = z.object({
  shellCommands: z.array(z.string()).default([]),
})
export type WorkspaceTrust = z.infer<typeof workspaceTrustSchema>

export const TRUST_PATH = ".black-agents/approval-trust.json"

export async function readWorkspaceTrust(workspaceRoot: string): Promise<WorkspaceTrust> {
  const abs = resolveInWorkspace(workspaceRoot, TRUST_PATH)
  if (!(await pathExists(abs))) return { shellCommands: [] }
  try {
    const parsed = workspaceTrustSchema.safeParse(JSON.parse(await readText(abs)) as unknown)
    return parsed.success ? parsed.data : { shellCommands: [] }
  } catch {
    return { shellCommands: [] }
  }
}

/** Add or remove programs from the workspace shell trust list. */
export async function setShellCommandsTrust(
  workspaceRoot: string,
  programs: readonly string[],
  trusted: boolean
): Promise<WorkspaceTrust> {
  const trust = await readWorkspaceTrust(workspaceRoot)
  const next = new Set(trust.shellCommands)
  for (const value of programs) {
    const program = normalizeShellProgram(value)
    if (!program) continue
    if (trusted) next.add(program)
    else next.delete(program)
  }
  const updated: WorkspaceTrust = { shellCommands: [...next].sort() }
  await writeText(resolveInWorkspace(workspaceRoot, TRUST_PATH), `${JSON.stringify(updated, null, 2)}\n`)
  return updated
}
