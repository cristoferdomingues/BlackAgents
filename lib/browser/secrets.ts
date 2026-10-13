import { getBrowserSecrets, setBrowserSecrets } from "@/lib/secrets"

import { looksLikeSecretFill } from "./flows/from-traces"
import type { BrowserFlowStep } from "./flows/schema"

const browserSecretIdPattern = /^browser\.[a-zA-Z0-9._-]+$/

export function isBrowserSecretId(id: string): boolean {
  return browserSecretIdPattern.test(id.trim())
}

/** Suggested secret id for a fill step (stable, kebab-ish). */
export function suggestBrowserSecretId(
  flowName: string,
  step: Pick<BrowserFlowStep, "id" | "args">
): string {
  const element =
    (typeof step.args.element === "string" && step.args.element) ||
    (typeof step.args.ref === "string" && step.args.ref) ||
    step.id
  const slug = element
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
  return `browser.${flowName}.${slug || step.id}`
}

function plaintextFillValue(args: Record<string, unknown>): string | undefined {
  for (const key of ["text", "value"] as const) {
    const v = args[key]
    if (typeof v === "string" && v.length > 0) return v
  }
  return undefined
}

/**
 * Move password-like fill values into secrets.json and leave `secretId` on the step.
 * Returns the sanitized steps (no plaintext secrets in args).
 */
export async function promoteFlowSecrets(
  flowName: string,
  steps: BrowserFlowStep[]
): Promise<BrowserFlowStep[]> {
  const upserts: Record<string, string> = {}
  const next: BrowserFlowStep[] = []

  for (const step of steps) {
    const args = { ...step.args }
    const existingId =
      typeof args.secretId === "string" ? args.secretId.trim() : ""
    const plaintext = plaintextFillValue(args)

    if (
      plaintext &&
      looksLikeSecretFill(step.tool, args) &&
      (!existingId || !isBrowserSecretId(existingId))
    ) {
      const id = suggestBrowserSecretId(flowName, step)
      upserts[id] = plaintext
      delete args.text
      delete args.value
      args.secretId = id
      next.push({ ...step, args })
      continue
    }

    if (existingId && isBrowserSecretId(existingId) && plaintext) {
      upserts[existingId] = plaintext
      delete args.text
      delete args.value
      next.push({ ...step, args })
      continue
    }

    next.push(step)
  }

  if (Object.keys(upserts).length > 0) {
    await setBrowserSecrets(upserts)
  }

  return next
}

/**
 * Resolve `secretId` on a step into the MCP fill text/value args.
 * Does not mutate the stored flow — returns args for one MCP call.
 */
export async function resolveStepArgsForReplay(
  args: Record<string, unknown>
): Promise<
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string; secretId?: string }
> {
  const secretId =
    typeof args.secretId === "string" ? args.secretId.trim() : ""
  if (!secretId) {
    return { ok: true, args }
  }

  if (!isBrowserSecretId(secretId) && !secretId.startsWith("mcp.")) {
    return {
      ok: false,
      error: `Invalid secretId "${secretId}". Use browser.* or mcp.* ids.`,
      secretId,
    }
  }

  const browser = await getBrowserSecrets()
  let value = browser[secretId]
  if (value === undefined && secretId.startsWith("mcp.")) {
    const { getMcpSecrets } = await import("@/lib/secrets")
    const mcp = await getMcpSecrets()
    value = mcp[secretId]
  }

  if (value === undefined || value === "") {
    return {
      ok: false,
      error:
        `Browser secret "${secretId}" is not configured. ` +
        `Add it in Settings → Browser → Flow secrets.`,
      secretId,
    }
  }

  const resolved = { ...args }
  delete resolved.secretId
  // Playwright MCP type/fill typically takes `text`.
  if (resolved.text === undefined && resolved.value === undefined) {
    resolved.text = value
  } else if (typeof resolved.text === "string" && resolved.text.length === 0) {
    resolved.text = value
  } else if (typeof resolved.value === "string" && resolved.value.length === 0) {
    resolved.value = value
  } else if (resolved.text === undefined) {
    resolved.text = value
  }

  return { ok: true, args: resolved }
}

/** Collect secretIds referenced by flow steps. */
export function collectFlowSecretIds(steps: BrowserFlowStep[]): string[] {
  const ids = new Set<string>()
  for (const step of steps) {
    const id = step.args.secretId
    if (typeof id === "string" && id.trim()) ids.add(id.trim())
  }
  return [...ids].sort()
}
