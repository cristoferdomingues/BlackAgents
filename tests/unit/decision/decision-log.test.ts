import { readFile, writeFile } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { cutoffFor, loadDecisionClient, recordDecision } from "@/lib/decision/client"
import {
  cutoffValues,
  DEFAULT_CUTOFFS,
  summarizeDecisions,
  type DecisionLogEntry,
} from "@/lib/decision/cutoffs"
import {
  appendDecision,
  clearDecisionLog,
  DECISION_LOG_MAX,
  decisionLogFile,
  readDecisionLog,
} from "@/lib/decision/log"
import { setJevApiKey } from "@/lib/secrets"
import { updateAiSettings } from "@/lib/settings"

import { fakeJev } from "../../helpers/jev"
import { makeTempEnv, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

function entry(over: Partial<DecisionLogEntry> = {}): DecisionLogEntry {
  return {
    at: "2026-10-21T10:00:00.000Z",
    kind: "artifactRouting",
    choice: "skill: review",
    score: 0.8,
    cutoff: 0.85,
    outcome: "below",
    provider: "direct",
    ...over,
  }
}

describe("cutoffs", () => {
  it("maps levels to scores", () => {
    expect(DEFAULT_CUTOFFS).toEqual({ artifactRouting: 0.85, skillSuggest: 0.85, stepGate: 0.85, learning: 0.85 })
    expect(cutoffValues({ artifactRouting: "eager", skillSuggest: "balanced", stepGate: "careful", learning: "careful" })).toEqual({
      artifactRouting: 0.7,
      skillSuggest: 0.85,
      stepGate: 0.9,
      learning: 0.9,
    })
  })

  it("falls back to the default when the client has no level", () => {
    expect(cutoffFor(null, "stepGate")).toBe(0.85)
    expect(cutoffFor({ ...fakeJev({}), cutoffs: { stepGate: 0.9 } }, "stepGate")).toBe(0.9)
    expect(cutoffFor({ ...fakeJev({}), cutoffs: { stepGate: 0.9 } }, "learning")).toBe(0.85)
  })

  it("summarizes one kind and counts what each level would use", () => {
    const entries = [
      entry({ score: 0.95, outcome: "acted" }),
      entry({ score: 0.87, outcome: "acted" }),
      entry({ score: 0.75 }),
      entry({ score: 0.6 }),
      entry({ choice: "none", score: 0.99, outcome: "pass" }),
      entry({ choice: "error", score: null, outcome: "error" }),
      entry({ kind: "stepGate", score: 0.99, outcome: "acted" }),
    ]
    expect(summarizeDecisions(entries, "artifactRouting")).toEqual({
      total: 6,
      acted: 2,
      below: 2,
      pass: 1,
      error: 1,
      scored: 4,
      wouldUse: { careful: 1, balanced: 2, eager: 3 },
    })
    expect(summarizeDecisions([], "learning")).toMatchObject({ total: 0, scored: 0 })
  })
})

describe("decision log file", () => {
  it("appends, keeps order, caps, and clears", async () => {
    expect(await readDecisionLog()).toEqual([])
    await Promise.all(
      Array.from({ length: DECISION_LOG_MAX + 5 }, (_, i) => appendDecision(entry({ choice: `c${i}` })))
    )
    const entries = await readDecisionLog()
    expect(entries).toHaveLength(DECISION_LOG_MAX)
    expect(entries[0].choice).toBe("c5")
    expect(entries.at(-1)?.choice).toBe(`c${DECISION_LOG_MAX + 4}`)
    expect(decisionLogFile().startsWith(env.configDir)).toBe(true)

    await clearDecisionLog()
    expect(await readDecisionLog()).toEqual([])
  })

  it("reads a broken file as empty and drops broken rows", async () => {
    await writeFile(decisionLogFile(), "not json", "utf8")
    expect(await readDecisionLog()).toEqual([])
    await writeFile(decisionLogFile(), JSON.stringify({ entries: [entry(), { kind: "other" }, entry({ score: 2 })] }), "utf8")
    expect(await readDecisionLog()).toEqual([entry()])
  })
})

describe("decision client log", () => {
  it("attaches user levels and writes labels and scores, never text", async () => {
    await updateAiSettings({ jev: { enabled: true, cutoffs: { artifactRouting: "eager", learning: "careful" } } })
    await setJevApiKey("ts-direct-key")
    const resolved = await loadDecisionClient()
    expect(resolved?.cutoffs).toEqual({ artifactRouting: 0.7, skillSuggest: 0.85, stepGate: 0.85, learning: 0.9 })

    recordDecision(resolved, { kind: "learning", choice: "nothing", score: 0.9, cutoff: 0.9, outcome: "pass" })
    await appendDecision(entry({ choice: "flush" }))
    const entries = await readDecisionLog()
    expect(entries[0]).toMatchObject({ kind: "learning", choice: "nothing", provider: "direct" })
    expect(Number.isNaN(Date.parse(entries[0].at))).toBe(false)
    expect(await readFile(decisionLogFile(), "utf8")).not.toContain("ts-direct-key")
  })

  it("never throws when the sink fails or Jev is off", () => {
    const broken = {
      ...fakeJev({}),
      log: () => {
        throw new Error("disk full")
      },
    }
    expect(() =>
      recordDecision(broken, { kind: "stepGate", choice: "stop", score: 0.9, cutoff: 0.85, outcome: "acted" })
    ).not.toThrow()
    expect(() =>
      recordDecision(null, { kind: "stepGate", choice: "stop", score: 0.9, cutoff: 0.85, outcome: "acted" })
    ).not.toThrow()
  })
})
