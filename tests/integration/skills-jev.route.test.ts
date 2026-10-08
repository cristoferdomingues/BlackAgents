import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST as SUGGEST } from "@/app/api/skills/suggest/route"
import { POST as EVAL } from "@/app/api/skills/eval/route"
import { choiceAnswer, fakeJev } from "../helpers/jev"
import { jsonRequest, makeTempEnv, seedArtifact, type TempEnv } from "../helpers/workspace"

const loadDecisionClient = vi.hoisted(() => vi.fn())

vi.mock("@/lib/decision/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/decision/client")>("@/lib/decision/client")
  return { ...actual, loadDecisionClient }
})

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
  loadDecisionClient.mockReset()
  loadDecisionClient.mockResolvedValue(null)
})
afterEach(async () => {
  await env.cleanup()
})

describe("/api/skills/suggest", () => {
  it("asks for a task and for Jev", async () => {
    expect((await SUGGEST(jsonRequest("http://t/api/skills/suggest", "POST", {}))).status).toBe(400)
    expect((await SUGGEST(jsonRequest("http://t/api/skills/suggest", "POST", { prompt: "review this" }))).status).toBe(
      412
    )
  })

  it("suggests a saved skill", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/skills/code-review/SKILL.md",
      "---\nname: code-review\ndescription: Use when the user asks for a code review.\n---\n\n# Review\n"
    )
    loadDecisionClient.mockResolvedValue(fakeJev({ skill: choiceAnswer("S0", 0.93) }))
    const res = await SUGGEST(jsonRequest("http://t/api/skills/suggest", "POST", { prompt: "review this pull request" }))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ kind: "picked", name: "code-review", confidence: 0.93 })
  })
})

describe("/api/skills/eval", () => {
  it("rejects a bad skill and reports when Jev is off", async () => {
    expect((await EVAL(jsonRequest("http://t/api/skills/eval", "POST", { name: "Bad Name", description: "x" }))).status).toBe(
      400
    )
    const off = await EVAL(
      jsonRequest("http://t/api/skills/eval", "POST", {
        name: "code-review",
        description: "Use when the user asks for a code review.",
      })
    )
    expect(off.status).toBe(412)
  })

  it("checks a draft description that is not saved yet", async () => {
    loadDecisionClient.mockResolvedValue(fakeJev({ skill: choiceAnswer("S0", 0.95) }))
    const res = await EVAL(
      jsonRequest("http://t/api/skills/eval", "POST", {
        name: "code-review",
        description: "Helps with anything.",
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.verdict).toBe("too-broad")
    expect(body.data.warning).toContain("Use when")
    expect(body.data.skill).toBe("code-review")
  })
})
