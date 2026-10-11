import { describe, expect, it } from "vitest"

import { parseWorkflowInvocation, workflowMentionToken } from "@/lib/workflows/invocation"

const names = ["release-line", "triage"]

describe("parseWorkflowInvocation", () => {
  it("parses /name with input", () => {
    expect(parseWorkflowInvocation("/release-line ship v2 today", names)).toEqual({
      workflow: "release-line",
      task: "ship v2 today",
    })
  })

  it("parses /name without input and keeps multi-line input", () => {
    expect(parseWorkflowInvocation("  /triage  ", names)).toEqual({ workflow: "triage", task: "" })
    expect(parseWorkflowInvocation("/triage line one\nline two", names)?.task).toBe(
      "line one\nline two"
    )
  })

  it("parses start @name, start @workflow:name and @workflow:name", () => {
    expect(parseWorkflowInvocation("start @triage bug 12", names)).toEqual({
      workflow: "triage",
      task: "bug 12",
    })
    expect(parseWorkflowInvocation("Start @workflow:release-line", names)).toEqual({
      workflow: "release-line",
      task: "",
    })
    expect(parseWorkflowInvocation("@workflow:triage check logs", names)?.task).toBe("check logs")
  })

  it("ignores unknown names, mid-message mentions and partial names", () => {
    expect(parseWorkflowInvocation("/tester run", names)).toBeNull()
    expect(parseWorkflowInvocation("please /triage this", names)).toBeNull()
    expect(parseWorkflowInvocation("/triage-extra x", names)).toBeNull()
    expect(parseWorkflowInvocation("start triage", names)).toBeNull()
    expect(parseWorkflowInvocation("/triage", [])).toBeNull()
  })

  it("builds the mention token", () => {
    expect(workflowMentionToken("triage")).toBe("@workflow:triage")
  })
})
