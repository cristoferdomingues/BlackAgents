import { noul } from "@typesafe-ai/sdk"

import {
  DECISION_REQUEST_OPTIONS,
  decisionErrorMessage,
  getDecisionCredentials,
  resolveDecisionClient,
  type DecisionCredentials,
  type DecisionProvider,
} from "./client"

export type DecisionProbeResult =
  | { ok: true; provider: DecisionProvider; model: string }
  | {
      ok: false
      code: "JEV_DISABLED" | "JEV_NOT_CONFIGURED" | "JEV_ERROR"
      message: string
    }

/** One cheap System One call to prove the saved Jev setup works. */
export async function probeDecisionEngine(
  credentials?: DecisionCredentials
): Promise<DecisionProbeResult> {
  try {
    const creds = credentials ?? (await getDecisionCredentials())
    if (!creds.enabled) {
      return { ok: false, code: "JEV_DISABLED", message: "Turn Jev on and save before testing." }
    }
    const resolved = resolveDecisionClient(creds)
    if (!resolved) {
      return {
        ok: false,
        code: "JEV_NOT_CONFIGURED",
        message: "No TypeSafe key or OpenRouter custom provider is available for Jev.",
      }
    }
    const result = await resolved.client.systemOne(
      {
        state: { probe: "black-agents-jev-connection-test" },
        questions: {
          alive: noul("Is this a connectivity probe from BlackAgents?", {
            true: "Yes, this is only a connection test.",
            false: "This is a real decision.",
          }),
        },
      },
      DECISION_REQUEST_OPTIONS
    )
    return { ok: true, provider: resolved.provider, model: result.model }
  } catch (err) {
    return {
      ok: false,
      code: "JEV_ERROR",
      message: decisionErrorMessage(err, "Jev connection test failed"),
    }
  }
}
