import { describe, expect, it } from "vitest"

import {
  abilityLabel,
  agentBuiltinTools,
  inputForKind,
  stepAbility,
  stepFacts,
  stepIndexOfIssue,
  stepKindFlags,
  stepKindOf,
  stepLinkText,
} from "@/lib/workflows/step-explain"

describe("stepKindOf / stepKindFlags", () => {
  it("reads the kind from the review and login flags", () => {
    expect(stepKindOf({ review: false, login: false })).toBe("work")
    expect(stepKindOf({ review: true, login: false })).toBe("review")
    expect(stepKindOf({ review: false, login: true })).toBe("login")
  })

  it("shows sign in when a saved step has both flags", () => {
    expect(stepKindOf({ review: true, login: true })).toBe("login")
  })

  it("sets exactly one flag per kind", () => {
    expect(stepKindFlags("work")).toEqual({ review: false, login: false })
    expect(stepKindFlags("review")).toEqual({ review: true, login: false })
    expect(stepKindFlags("login")).toEqual({ review: false, login: true })
  })
})

describe("inputForKind", () => {
  it("moves a review from the previous output to all earlier outputs", () => {
    expect(inputForKind("review", "previous")).toBe("all")
  })

  it("keeps an input the user picked on purpose", () => {
    expect(inputForKind("review", "task")).toBe("task")
    expect(inputForKind("work", "previous")).toBe("previous")
    expect(inputForKind("login", "all")).toBe("all")
  })
})

describe("stepLinkText", () => {
  it("says the first step starts with the task, whatever its input", () => {
    expect(stepLinkText(0, "all")).toBe("Starts with the task")
  })

  it("describes how later steps get their input", () => {
    expect(stepLinkText(1, "previous")).toBe("Gets the previous step's result")
    expect(stepLinkText(2, "all")).toBe("Gets every earlier result")
    expect(stepLinkText(3, "task")).toBe("Starts fresh from the task")
  })
})

describe("agentBuiltinTools", () => {
  it("gives read-only tools when the agent lists none", () => {
    expect(agentBuiltinTools(undefined)).toEqual(["fs_list", "fs_read"])
    expect(agentBuiltinTools({ tools: "fs_write" })).toEqual(["fs_list", "fs_read"])
  })

  it("keeps only known built-in tools", () => {
    expect(agentBuiltinTools({ tools: ["fs_read", "web_magic", 3, "shell_run"] })).toEqual(["fs_read", "shell_run"])
    expect(agentBuiltinTools({ tools: [] })).toEqual([])
  })
})

describe("abilityLabel", () => {
  it("names levels, custom sets and no tools", () => {
    expect(abilityLabel(["fs_list", "fs_read"])).toBe("Read only")
    expect(abilityLabel(["fs_list", "fs_read", "fs_write", "shell_run"])).toBe("Full")
    expect(abilityLabel(["shell_run"])).toBe("Custom tools")
    expect(abilityLabel([])).toBe("Talk only")
  })
})

describe("stepAbility", () => {
  it("uses the agent's tools when the step keeps them", () => {
    expect(stepAbility({ ownTools: true, tools: [], agentTools: ["fs_list", "fs_read", "fs_write"] })).toEqual({
      label: "Read and write",
      risk: "medium",
      canWrite: true,
      fromAgent: true,
    })
  })

  it("uses the step's own tools otherwise", () => {
    expect(stepAbility({ ownTools: false, tools: ["fs_list", "fs_read"], agentTools: null })).toMatchObject({
      label: "Read only",
      risk: "low",
      canWrite: false,
      fromAgent: false,
    })
  })

  it("is unknown when the step uses the agent's tools but has no agent", () => {
    expect(stepAbility({ ownTools: true, tools: ["fs_read"], agentTools: null })).toBeNull()
  })
})

describe("stepFacts", () => {
  const readOnly = { label: "Read only", risk: "low" as const, canWrite: false, fromAgent: true }
  const writer = { label: "Read and write", risk: "medium" as const, canWrite: true, fromAgent: false }

  it("lists the kind, ability, checks and files", () => {
    expect(stepFacts({ kind: "review", ability: readOnly, gate: true, allowWrites: false, files: 2 })).toEqual([
      "Review",
      "Read only",
      "Jev checks",
      "2 files",
    ])
  })

  it("shows writes without asking only when the step can write", () => {
    expect(stepFacts({ kind: "work", ability: readOnly, gate: false, allowWrites: true, files: 0 })).toEqual(["Read only"])
    expect(stepFacts({ kind: "work", ability: writer, gate: false, allowWrites: true, files: 1 })).toEqual([
      "Read and write",
      "Writes without asking",
      "1 file",
    ])
  })

  it("is empty for a plain step with no agent", () => {
    expect(stepFacts({ kind: "work", ability: null, gate: false, allowWrites: false, files: 0 })).toEqual([])
    expect(stepFacts({ kind: "login", ability: null, gate: false, allowWrites: false, files: 0 })).toEqual(["Signs in"])
  })
})

describe("stepIndexOfIssue", () => {
  it("finds the step an issue points at", () => {
    expect(stepIndexOfIssue(["steps", 2, "id"])).toBe(2)
    expect(stepIndexOfIssue(["steps", 0])).toBe(0)
  })

  it("is null for other paths", () => {
    expect(stepIndexOfIssue(["name"])).toBeNull()
    expect(stepIndexOfIssue(["steps"])).toBeNull()
    expect(stepIndexOfIssue([])).toBeNull()
  })
})
