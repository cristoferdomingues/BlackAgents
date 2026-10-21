import type { TypeSafeClient } from "@typesafe-ai/sdk"
import { vi } from "vitest"

import type { ResolvedDecisionClient } from "@/lib/decision/client"
import type { DecisionRecord, JevCutoffs } from "@/lib/decision/cutoffs"

/** A Jev client whose `systemOne` returns the given answers (or throws). */
export function fakeJev(
  answers: Record<string, unknown> | Error,
  model = "jev-test"
): ResolvedDecisionClient & { systemOne: ReturnType<typeof vi.fn> } {
  const systemOne = vi.fn(async () => {
    if (answers instanceof Error) throw answers
    return { model, answers, usage: { input_tokens: 1, output_tokens: 1 } }
  })
  const client = { systemOne } as unknown as TypeSafeClient
  return { provider: "direct", client, systemOne }
}

/** A fake Jev that records decisions in memory, with optional user cutoffs. */
export function loggedJev(
  answers: Record<string, unknown> | Error,
  cutoffs?: Partial<JevCutoffs>
): ReturnType<typeof fakeJev> & { records: DecisionRecord[] } {
  const records: DecisionRecord[] = []
  return { ...fakeJev(answers), cutoffs, log: (record) => records.push(record), records }
}

export function choiceAnswer(choice: string, confidence: number) {
  return { type: "choice", choice, confidence, probabilities: {} }
}
