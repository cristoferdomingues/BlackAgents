import { z } from "zod"

import { CredentialStateError, getVerifiedCredentials } from "@/lib/llm/credentials"
import { ModelRefError, resolveTaskRef } from "@/lib/llm/model-ref"
import { getProvider } from "@/lib/llm/registry"
import type { LLMProvider } from "@/lib/llm/types"
import { readAiSettings } from "@/lib/settings"

import { SNAPSHOT_TOOLS, type SnapshotExecutor } from "./assert"
import { BROWSER_MCP_SERVER } from "./constants"
import type { BrowserFlowStep } from "./flows/schema"

export const HEAL_FENCE = "browser_heal"

const healedStepSchema = z.object({
  tool: z.string().trim().min(1).max(100),
  args: z.record(z.unknown()).default({}),
})
export type HealedStep = z.infer<typeof healedStepSchema>

const MAX_SNAPSHOT_CHARS = 12_000

export function extractHealedStep(text: string): HealedStep | null {
  const fence = new RegExp(
    "```" + HEAL_FENCE + "\\s*\\n([\\s\\S]*?)\\n```",
    "i"
  )
  const match = text.match(fence)
  if (!match?.[1]) return null
  try {
    const parsed = healedStepSchema.safeParse(JSON.parse(match[1]))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function truncateSnapshot(text: string): string {
  if (text.length <= MAX_SNAPSHOT_CHARS) return text
  return `${text.slice(0, MAX_SNAPSHOT_CHARS)}\n…[truncated]`
}

async function captureSnapshot(execute: SnapshotExecutor): Promise<string> {
  for (const tool of SNAPSHOT_TOOLS) {
    const trace = await execute(BROWSER_MCP_SERVER, tool, {})
    if (trace.error) continue
    if (typeof trace.result === "string") return truncateSnapshot(trace.result)
    try {
      return truncateSnapshot(JSON.stringify(trace.result))
    } catch {
      return truncateSnapshot(String(trace.result))
    }
  }
  return "(snapshot unavailable)"
}

function healSystemPrompt(): string {
  return `You repair a failed browser automation step for Playwright MCP.
Given the step intent, the failed tool/args, and an accessibility snapshot of the current page,
propose ONE replacement tool call that achieves the same intent.

Reply with a single fenced code block tagged \`${HEAL_FENCE}\` containing JSON:
{ "tool": "browser_click", "args": { "element": "…", "ref": "…" } }

Rules:
- Prefer refs from the snapshot when present.
- Do not invent credentials; never put passwords in args.
- Keep the tool name in the Playwright MCP browser_* family.
- No prose outside the fence.`
}

export type HealStepResult =
  | {
      ok: true
      healed: HealedStep
      model: string
    }
  | {
      ok: false
      error: string
    }

/**
 * Ask the Fast (else Reasoning) task model to re-resolve a failed step.
 */
export async function healBrowserStep(params: {
  step: BrowserFlowStep
  failureMessage: string
  execute: SnapshotExecutor
  generate?: (
    provider: LLMProvider,
    model: string,
    credentials: { apiKey: string; baseUrl?: string },
    prompt: string
  ) => Promise<string>
}): Promise<HealStepResult> {
  const intent = params.step.intent?.trim()
  if (!intent) {
    return { ok: false, error: "Step has no intent to heal from" }
  }

  let settings
  try {
    settings = await readAiSettings()
  } catch {
    return { ok: false, error: "Could not read AI settings for heal" }
  }

  let choice: { provider: string; model: string }
  try {
    choice = resolveTaskRef("fast", settings)
  } catch {
    try {
      choice = resolveTaskRef("reasoning", settings)
    } catch (err) {
      const message =
        err instanceof ModelRefError
          ? err.message
          : "Set the Fast model in Settings → Models"
      return { ok: false, error: message }
    }
  }

  const provider = getProvider(choice.provider)
  if (!provider) {
    return { ok: false, error: `Unknown provider "${choice.provider}"` }
  }

  let credentials
  try {
    ;({ credentials } = await getVerifiedCredentials(provider))
  } catch (err) {
    if (err instanceof CredentialStateError) {
      return { ok: false, error: err.message }
    }
    return { ok: false, error: "Provider credentials are not ready for heal" }
  }

  const snapshot = await captureSnapshot(params.execute)
  const userPrompt = [
    `Intent: ${intent}`,
    `Failed tool: ${params.step.tool}`,
    `Failed args: ${JSON.stringify(params.step.args)}`,
    `Error: ${params.failureMessage}`,
    "",
    "Page snapshot:",
    snapshot,
  ].join("\n")

  const generate =
    params.generate ??
    (async (p, model, creds, prompt) => {
      const reply = await p.generate(
        {
          model,
          temperature: 0.1,
          systemContext: healSystemPrompt(),
          messages: [{ role: "user", content: prompt }],
        },
        creds
      )
      return reply.content
    })

  let content: string
  try {
    content = await generate(provider, choice.model, credentials, userPrompt)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Heal model call failed",
    }
  }

  const healed = extractHealedStep(content)
  if (!healed) {
    return { ok: false, error: "Heal response did not include a valid browser_heal block" }
  }

  return { ok: true, healed, model: choice.model }
}
