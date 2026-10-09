import type { RuntimeTool, ToolRisk } from "./types"

/** Per-request (chat) or per-run (workflow) approval state. */
export interface ApprovalPolicy {
  /** Auto-approve every `write` call. `exec` calls still need approval. */
  allowWrites: boolean
  /** Auto-approve builtin `fs_write` calls that are still `write` risk. */
  allowFileWrites: boolean
  /** Exact `exec` calls the user allowed for the rest of this run. */
  allowedCalls: Set<string>
}

export function createApprovalPolicy(allowWrites = false, allowFileWrites = false): ApprovalPolicy {
  return { allowWrites, allowFileWrites, allowedCalls: new Set() }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/** Identity of one exact call (tool + arguments). */
export function callKey(tool: RuntimeTool, args: Record<string, unknown>): string {
  return `${tool.name}:${stableStringify(args)}`
}

export function riskOf(tool: RuntimeTool, args: Record<string, unknown>): ToolRisk {
  return tool.riskFor ? tool.riskFor(args) : tool.risk
}

export function needsApproval(
  tool: RuntimeTool,
  args: Record<string, unknown>,
  policy: ApprovalPolicy
): boolean {
  const risk = riskOf(tool, args)
  if (risk === "read") return false
  if (risk === "write" && policy.allowWrites) return false
  if (risk === "write" && policy.allowFileWrites && tool.originalName === "fs_write") return false
  return !policy.allowedCalls.has(callKey(tool, args))
}

export function rememberCall(
  policy: ApprovalPolicy,
  tool: RuntimeTool,
  args: Record<string, unknown>
): void {
  policy.allowedCalls.add(callKey(tool, args))
}
