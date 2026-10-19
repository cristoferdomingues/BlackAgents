import { describe, expect, it } from "vitest"

import { checkWorkflowDraft, draftFixRequest } from "@/lib/workflows/draft-check"
import { workflowSchema, type Workflow } from "@/lib/workflows/schema"

function draft(steps: Array<Record<string, unknown>>): Workflow {
  return workflowSchema.parse({ name: "line", task: "Ship it", steps })
}

const agents = [
  { name: "dev", frontmatter: {} },
  { name: "writer", frontmatter: { tools: ["fs_list", "fs_read", "fs_write"], mcpServers: [] } },
]

describe("checkWorkflowDraft", () => {
  it("warns when a step must change files but the agent can only read", () => {
    const [check] = checkWorkflowDraft(draft([{ id: "build", agent: "dev", instructions: "Implement the API." }]), agents)
    expect(check.ability).toBe("Read only")
    expect(check.warnings).toEqual([
      "It can only read files, but its instructions ask it to change them. Give it Read and write.",
    ])
  })

  it("warns when a step must run tests but cannot run commands", () => {
    const [check] = checkWorkflowDraft(
      draft([{ id: "test", agent: "writer", instructions: "Run the tests with npm and add missing ones.", allowWrites: true }]),
      agents
    )
    expect(check.warnings).toEqual([
      "It cannot run commands, but its instructions ask it to run tests or commands. Give it Full.",
    ])
  })

  it("treats a repair step as a change and never flags a review", () => {
    const checks = checkWorkflowDraft(
      draft([
        { id: "fix", agent: "dev", instructions: "Close the defects.", repair: true },
        { id: "check", agent: "dev", instructions: "Review and fix nothing.", review: true, onReject: { step: "fix" } },
      ]),
      agents
    )
    expect(checks[0].warnings[0]).toMatch(/can only read/)
    expect(checks[1].warnings).toEqual([])
  })

  it("notes approvals and open MCP access for writing steps", () => {
    const [asks, open] = checkWorkflowDraft(
      draft([
        { id: "a", agent: "dev", instructions: "Write docs.", tools: ["fs_write"] },
        { id: "b", agent: "dev", instructions: "Write docs.", tools: ["fs_write"], allowWrites: true },
      ]),
      agents
    )
    expect(asks.warnings).toEqual(["Every file change will wait for your approval."])
    expect(open.warnings).toEqual([
      "It can use every MCP server, and their changes run without asking. Pick servers or None.",
    ])
  })

  it("is clean for a well set step and skips missing agents", () => {
    const checks = checkWorkflowDraft(
      draft([
        { id: "a", agent: "writer", instructions: "Implement it.", allowWrites: true },
        { id: "b", agent: "ghost", instructions: "Implement it." },
      ]),
      agents
    )
    expect(checks).toEqual([
      { stepId: "a", ability: "Read and write", warnings: [] },
      { stepId: "b", ability: null, warnings: [] },
    ])
  })
})

describe("draftFixRequest", () => {
  it("lists only flagged steps", () => {
    expect(
      draftFixRequest("line", [
        { stepId: "a", ability: "Read only", warnings: ["W1", "W2"] },
        { stepId: "b", ability: "Read only", warnings: [] },
      ])
    ).toBe(
      'Fix the tools in the "line" workflow draft. Set tools, mcpServers, and allowWrites on each step to match its job:\n- a: W1 W2'
    )
  })

  it("is null when nothing is flagged", () => {
    expect(draftFixRequest("line", [{ stepId: "a", ability: null, warnings: [] }])).toBeNull()
  })
})
