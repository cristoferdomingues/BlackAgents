import { executeWorkspaceTool } from "@/lib/mcp/client"
import { readAiSettings } from "@/lib/settings"

import { runAssertStep } from "./assert"
import {
  pageSignatureFromSnapshot,
  readActionCache,
  writeActionCache,
} from "./cache"
import {
  classifyBrowserFailure,
  formatStepFailure,
  type BrowserFlowFailureCode,
} from "./classify"
import { BROWSER_MCP_SERVER } from "./constants"
import type { BrowserFlow, BrowserFlowStep } from "./flows/schema"
import { saveBrowserFlow } from "./flows/store"
import { healBrowserStep } from "./heal"
import { browserUnavailableReason } from "./platform"
import { ensureBrowserProfile, reLoginHint } from "./profile"
import { resolveStepArgsForReplay } from "./secrets"

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultSettleMs(step: BrowserFlowStep): number {
  if (step.settleMs !== undefined) return step.settleMs
  if (step.tool.includes("navigate") || step.tool.includes("click")) return 250
  return 0
}

async function executeMcp(
  workspaceRoot: string,
  tool: string,
  args: Record<string, unknown>
): Promise<{ result?: unknown; error?: string }> {
  const trace = await executeWorkspaceTool(
    workspaceRoot,
    BROWSER_MCP_SERVER,
    tool,
    args
  )
  return { result: trace.result, error: trace.error }
}

async function maybeWriteBackStep(
  workspaceRoot: string,
  flow: BrowserFlow,
  stepIndex: number,
  tool: string,
  args: Record<string, unknown>
): Promise<boolean> {
  const settings = await readAiSettings()
  if (!settings.browser.updateFlowsOnHeal) return false
  const steps = flow.steps.map((s, i) =>
    i === stepIndex
      ? {
          ...s,
          tool,
          args,
          kind: s.kind ?? "action",
        }
      : s
  )
  await saveBrowserFlow(workspaceRoot, {
    name: flow.name,
    description: flow.description,
    profile: flow.profile,
    startUrl: flow.startUrl,
    steps,
  })
  return true
}

export interface BrowserReplayResult {
  flow: string
  stepsRun: number
  results: Array<{
    tool: string
    ok: boolean
    error?: string
    code?: BrowserFlowFailureCode
    healed?: boolean
    fromCache?: boolean
  }>
  healedWriteback?: boolean
}

export async function replayBrowserFlow(
  workspaceRoot: string,
  flow: BrowserFlow
): Promise<{ ok: true; result: BrowserReplayResult } | { ok: false; error: string; result?: BrowserReplayResult }> {
  const unavailable = browserUnavailableReason()
  if (unavailable) return { ok: false, error: unavailable }

  const profile = await ensureBrowserProfile(flow.profile)
  if (!profile.ok) return { ok: false, error: profile.error }
  if (!profile.exists) {
    return { ok: false, error: reLoginHint(profile.profileDir) }
  }
  if (flow.steps.length === 0) {
    return { ok: false, error: `Flow "${flow.name}" has no steps to run` }
  }

  const results: BrowserReplayResult["results"] = []
  let healedWriteback = false

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i]!
    const kind = step.kind ?? "action"

    if (step.waitForMs && step.waitForMs > 0) {
      await delay(step.waitForMs)
    }

    if (kind === "assert" || kind === "extract") {
      const asserted = await runAssertStep(step, (server, tool, args) =>
        executeMcp(workspaceRoot, tool, args)
      )
      if (!asserted.ok) {
        const code = classifyBrowserFailure(asserted.error, kind)
        results.push({ tool: step.tool || "assert", ok: false, error: asserted.error, code })
        return {
          ok: false,
          error: formatStepFailure({
            flowName: flow.name,
            stepIndex: i,
            stepId: step.id,
            intent: step.intent,
            tool: step.tool || kind,
            code,
            message: asserted.error,
          }),
          result: { flow: flow.name, stepsRun: results.length, results },
        }
      }
      results.push({ tool: step.tool || kind, ok: true })
      continue
    }

    const resolved = await resolveStepArgsForReplay(step.args)
    if (!resolved.ok) {
      const code = classifyBrowserFailure(resolved.error, "secret")
      results.push({ tool: step.tool, ok: false, error: resolved.error, code })
      return {
        ok: false,
        error: formatStepFailure({
          flowName: flow.name,
          stepIndex: i,
          stepId: step.id,
          intent: step.intent,
          tool: step.tool,
          code,
          message: resolved.error,
        }),
        result: { flow: flow.name, stepsRun: results.length, results },
      }
    }

    let tool = step.tool
    let args = resolved.args
    let fromCache = false
    let healed = false

    // Cache lookup when we have intent (page signature from a quick snapshot).
    if (step.intent?.trim()) {
      const snap = await executeMcp(workspaceRoot, "browser_snapshot", {})
      const snapText =
        typeof snap.result === "string"
          ? snap.result
          : snap.result != null
            ? JSON.stringify(snap.result)
            : ""
      if (snapText) {
        const sig = pageSignatureFromSnapshot(snapText)
        const cached = await readActionCache(
          workspaceRoot,
          flow.name,
          step.intent,
          sig
        )
        if (cached) {
          tool = cached.tool
          const cachedResolved = await resolveStepArgsForReplay(cached.args)
          if (cachedResolved.ok) {
            args = cachedResolved.args
            fromCache = true
          }
        }
      }
    }

    let trace = await executeMcp(workspaceRoot, tool, args)
    if (trace.error && fromCache) {
      // Fall back to original step args once.
      fromCache = false
      tool = step.tool
      args = resolved.args
      trace = await executeMcp(workspaceRoot, tool, args)
    }

    if (trace.error) {
      const code = classifyBrowserFailure(trace.error)
      if (code === "auth") {
        results.push({ tool, ok: false, error: trace.error, code })
        return {
          ok: false,
          error: formatStepFailure({
            flowName: flow.name,
            stepIndex: i,
            stepId: step.id,
            intent: step.intent,
            tool,
            code,
            message: trace.error,
            hint: reLoginHint(profile.profileDir),
          }),
          result: { flow: flow.name, stepsRun: results.length, results },
        }
      }

      // LLM self-heal once when intent is present.
      if (step.intent?.trim()) {
        const heal = await healBrowserStep({
          step,
          failureMessage: trace.error,
          execute: (server, t, a) => executeMcp(workspaceRoot, t, a),
        })
        if (heal.ok) {
          const healResolved = await resolveStepArgsForReplay(heal.healed.args)
          if (healResolved.ok) {
            const retry = await executeMcp(
              workspaceRoot,
              heal.healed.tool,
              healResolved.args
            )
            if (!retry.error) {
              healed = true
              tool = heal.healed.tool
              args = healResolved.args
              const wrote = await maybeWriteBackStep(
                workspaceRoot,
                flow,
                i,
                tool,
                // Persist secretId form, not plaintext
                heal.healed.args
              )
              if (wrote) healedWriteback = true

              const snap = await executeMcp(workspaceRoot, "browser_snapshot", {})
              const snapText =
                typeof snap.result === "string"
                  ? snap.result
                  : snap.result != null
                    ? JSON.stringify(snap.result)
                    : ""
              if (snapText && step.intent) {
                await writeActionCache(workspaceRoot, flow.name, {
                  intent: step.intent,
                  pageSignature: pageSignatureFromSnapshot(snapText),
                  tool,
                  args: heal.healed.args,
                })
              }

              const settle = defaultSettleMs(step)
              if (settle > 0) await delay(settle)
              results.push({ tool, ok: true, healed, fromCache })
              continue
            }
            trace = retry
          }
        } else {
          results.push({
            tool,
            ok: false,
            error: `${trace.error}; heal failed: ${heal.error}`,
            code: "heal",
          })
          return {
            ok: false,
            error: formatStepFailure({
              flowName: flow.name,
              stepIndex: i,
              stepId: step.id,
              intent: step.intent,
              tool,
              code: "heal",
              message: `${trace.error}; heal failed: ${heal.error}`,
            }),
            result: { flow: flow.name, stepsRun: results.length, results },
          }
        }
      }

      const finalCode = classifyBrowserFailure(trace.error ?? "unknown")
      results.push({ tool, ok: false, error: trace.error, code: finalCode })
      return {
        ok: false,
        error: formatStepFailure({
          flowName: flow.name,
          stepIndex: i,
          stepId: step.id,
          intent: step.intent,
          tool,
          code: finalCode,
          message: trace.error ?? "unknown",
          hint:
            finalCode === "auth" ? reLoginHint(profile.profileDir) : undefined,
        }),
        result: { flow: flow.name, stepsRun: results.length, results },
      }
    }

    // Success: update cache
    if (step.intent?.trim()) {
      const snap = await executeMcp(workspaceRoot, "browser_snapshot", {})
      const snapText =
        typeof snap.result === "string"
          ? snap.result
          : snap.result != null
            ? JSON.stringify(snap.result)
            : ""
      if (snapText) {
        await writeActionCache(workspaceRoot, flow.name, {
          intent: step.intent,
          pageSignature: pageSignatureFromSnapshot(snapText),
          tool,
          args: step.args,
        })
      }
    }

    const settle = defaultSettleMs(step)
    if (settle > 0) await delay(settle)
    results.push({ tool, ok: true, healed, fromCache })
  }

  return {
    ok: true,
    result: {
      flow: flow.name,
      stepsRun: results.length,
      results,
      ...(healedWriteback ? { healedWriteback: true } : {}),
    },
  }
}
