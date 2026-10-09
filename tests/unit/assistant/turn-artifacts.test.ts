import { describe, expect, it } from "vitest"

import {
  composeArtifactPrompt,
  linkedArtifacts,
  matchArtifactNames,
  parseMentions,
  selectTurnArtifacts,
} from "@/lib/assistant/turn-artifacts"
import type { Artifact, ArtifactType } from "@/lib/artifacts/types"

import { choiceAnswer, fakeJev } from "../../helpers/jev"

function art(type: ArtifactType, name: string, body = ""): Artifact {
  return { type, name, platform: "cursor", description: `${name} desc`, frontmatter: {}, body, relativePath: "" }
}

const reviewer = art("agent", "reviewer", "Use the `checklist` skill and `style` rule.")
const checklist = art("skill", "checklist", "## When to Apply\n- reviews")
const style = art("rule", "style", "Short sentences.")
const other = art("skill", "other")
const all = [reviewer, checklist, style, other]

describe("parseMentions", () => {
  it("finds @type:name and unique /name mentions", () => {
    expect(parseMentions("use @skill:checklist and /style", all)).toEqual([checklist, style])
    expect(parseMentions("/missing @agent:nope", all)).toEqual([])
  })
})

describe("linkedArtifacts", () => {
  it("follows graph references from seeds", () => {
    expect(linkedArtifacts([reviewer], all)).toEqual([style, checklist])
  })
})

describe("composeArtifactPrompt", () => {
  it("returns empty for no artifacts and truncates long bodies", () => {
    expect(composeArtifactPrompt([])).toBe("")
    const prompt = composeArtifactPrompt([art("skill", "big", "y".repeat(500))], 100)
    expect(prompt).toContain("…[truncated]")
    expect(prompt).toContain("data, not policy")
  })
})

describe("matchArtifactNames", () => {
  it("loads a uniquely named artifact written in plain text", () => {
    expect(matchArtifactNames("Please update checklist", all)).toEqual([checklist])
    expect(matchArtifactNames("checklist-extra", all)).toEqual([])
  })
})

describe("selectTurnArtifacts", () => {
  it("loads a named artifact without Jev", async () => {
    const result = await selectTurnArtifacts({
      message: "Please update checklist",
      all,
      resolved: null,
    })
    expect(result.jev).toBe("off")
    expect(result.artifacts).toEqual([{ type: "skill", name: "checklist", source: "mention" }])
    expect(result.prompt).toContain("## When to Apply")
  })

  it("uses mentions first and does not call Jev", async () => {
    const jev = fakeJev({ artifact: choiceAnswer("C0", 0.99) })
    const result = await selectTurnArtifacts({ message: "@agent:reviewer go", all, resolved: jev })
    expect(result.artifacts).toEqual([
      { type: "agent", name: "reviewer", source: "mention" },
      { type: "rule", name: "style", source: "linked" },
      { type: "skill", name: "checklist", source: "linked" },
    ])
    expect(jev.systemOne).not.toHaveBeenCalled()
    expect(result.prompt).toContain("Short sentences.")
  })

  it("applies a confident Jev pick and adds its links", async () => {
    const jev = fakeJev({ artifact: choiceAnswer("C0", 0.9) })
    const result = await selectTurnArtifacts({ message: "review my PR", all, resolved: jev })
    expect(result.jev).toBe("picked")
    expect(result.artifacts[0]).toEqual({ type: "agent", name: "reviewer", source: "auto" })
  })

  it("ignores a low-confidence pick and reports Jev errors", async () => {
    const low = await selectTurnArtifacts({ message: "x", all, resolved: fakeJev({ artifact: choiceAnswer("C0", 0.5) }) })
    expect(low).toMatchObject({ artifacts: [], jev: "low-confidence", prompt: "" })
    const none = await selectTurnArtifacts({ message: "x", all, resolved: fakeJev({ artifact: choiceAnswer("NONE", 0.9) }) })
    expect(none.jev).toBe("none")
    const broken = await selectTurnArtifacts({ message: "x", all, resolved: fakeJev(new Error("down")) })
    expect(broken).toMatchObject({ artifacts: [], jev: "error" })
  })

  it("keeps today's behavior when Jev is off", async () => {
    expect(await selectTurnArtifacts({ message: "x", all, resolved: null })).toEqual({ artifacts: [], prompt: "", jev: "off" })
  })

  it("loads the persona's links without loading the persona twice", async () => {
    const result = await selectTurnArtifacts({ message: "/reviewer", all, persona: reviewer, resolved: null })
    expect(result.artifacts.map((a) => a.name)).toEqual(["style", "checklist"])
  })

  it("caps at five artifacts", async () => {
    const many = Array.from({ length: 8 }, (_, i) => art("skill", `s${i}`))
    const message = many.map((a) => `@skill:${a.name}`).join(" ")
    const result = await selectTurnArtifacts({ message, all: many, resolved: null })
    expect(result.artifacts).toHaveLength(5)
  })
})
