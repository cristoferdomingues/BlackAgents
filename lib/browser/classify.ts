/** Failure categories surfaced by browser_run_flow. */
export type BrowserFlowFailureCode = "auth" | "selector" | "assert" | "heal" | "secret" | "other"

export function looksLikeAuthFailure(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes("login") ||
    lower.includes("sign in") ||
    lower.includes("sign-in") ||
    lower.includes("log in") ||
    lower.includes("unauthorized") ||
    lower.includes("unauthenticated") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("session expired") ||
    lower.includes("session invalid") ||
    lower.includes("cookie") ||
    lower.includes("sso") ||
    lower.includes("authenticate") ||
    lower.includes("re-login") ||
    lower.includes("relogin")
  )
}

export function looksLikeSelectorFailure(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes("timeout") ||
    lower.includes("not found") ||
    lower.includes("no element") ||
    lower.includes("unable to find") ||
    lower.includes("strict mode violation") ||
    lower.includes("locator") ||
    lower.includes("selector") ||
    lower.includes("ref ") ||
    lower.includes("detached") ||
    lower.includes("not visible") ||
    lower.includes("not interactable")
  )
}

export function classifyBrowserFailure(
  message: string,
  kind?: "action" | "assert" | "extract" | "heal" | "secret"
): BrowserFlowFailureCode {
  if (kind === "assert" || kind === "extract") return "assert"
  if (kind === "heal") return "heal"
  if (kind === "secret") return "secret"
  if (looksLikeAuthFailure(message)) return "auth"
  if (looksLikeSelectorFailure(message)) return "selector"
  return "other"
}

export function formatStepFailure(params: {
  flowName: string
  stepIndex: number
  stepId: string
  intent?: string
  tool: string
  code: BrowserFlowFailureCode
  message: string
  hint?: string
}): string {
  const where = `step ${params.stepIndex + 1} (${params.stepId})`
  const intent = params.intent ? ` intent="${params.intent}"` : ""
  const hint = params.hint ? ` ${params.hint}` : ""
  return (
    `Flow "${params.flowName}" failed on ${where}${intent} ` +
    `[${params.code}] ${params.tool}: ${params.message}.${hint}`
  )
}
