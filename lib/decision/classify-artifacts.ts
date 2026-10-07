import { choice } from "@typesafe-ai/sdk"

import type { ArtifactType } from "@/lib/artifacts/types"

import {
  DECISION_REQUEST_OPTIONS,
  decisionErrorMessage,
  type ResolvedDecisionClient,
} from "./client"

/** Apply a Jev pick only when Jev is at least this sure. */
export const ARTIFACT_ROUTING_MIN_CONFIDENCE = 0.85
/** Most artifacts offered to Jev in one call. */
export const MAX_ROUTING_CANDIDATES = 40
const NONE_LABEL = "NONE"
const DESCRIPTION_MAX_CHARS = 200
const MESSAGE_MAX_CHARS = 2_000

export interface ArtifactRoutingCandidate {
  type: ArtifactType
  name: string
  description: string
}

export type ArtifactRoutingDecision =
  | { kind: "skipped" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "none"; confidence: number; model: string }
  | { kind: "picked"; type: ArtifactType; name: string; confidence: number; model: string }

function describe(candidate: ArtifactRoutingCandidate): string {
  const text = `${candidate.type} "${candidate.name}": ${candidate.description || "(no description)"}`
  return text.length > DESCRIPTION_MAX_CHARS
    ? `${text.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`
    : text
}

/**
 * Ask Jev which workspace artifact best helps with this chat message.
 * Never throws; anything but `picked` keeps the default context.
 */
export async function evaluateArtifactRouting(params: {
  message: string
  candidates: ArtifactRoutingCandidate[]
  resolved: ResolvedDecisionClient | null
}): Promise<ArtifactRoutingDecision> {
  const candidates = params.candidates.slice(0, MAX_ROUTING_CANDIDATES)
  if (candidates.length === 0) return { kind: "skipped" }
  if (!params.resolved) return { kind: "unavailable" }
  try {
    const criteria: Record<string, string> = {}
    candidates.forEach((candidate, index) => {
      criteria[`C${index}`] = describe(candidate)
    })
    criteria[NONE_LABEL] = "No listed artifact clearly helps with this message."

    const result = await params.resolved.client.systemOne(
      {
        state: {
          trigger: "assistant_artifacts",
          message: params.message.slice(0, MESSAGE_MAX_CHARS),
        },
        questions: {
          artifact: choice(
            "Which workspace agent, command, rule, or skill best supports answering this message?",
            criteria
          ),
        },
      },
      DECISION_REQUEST_OPTIONS
    )
    const answer = result.answers.artifact
    if (answer.choice === NONE_LABEL) {
      return { kind: "none", confidence: answer.confidence, model: result.model }
    }
    const candidate = /^C\d+$/.test(answer.choice)
      ? candidates[Number(answer.choice.slice(1))]
      : undefined
    if (!candidate) {
      return { kind: "error", message: `Unknown artifact label: ${answer.choice}` }
    }
    return {
      kind: "picked",
      type: candidate.type,
      name: candidate.name,
      confidence: answer.confidence,
      model: result.model,
    }
  } catch (err) {
    return { kind: "error", message: decisionErrorMessage(err, "Jev artifact routing failed") }
  }
}
