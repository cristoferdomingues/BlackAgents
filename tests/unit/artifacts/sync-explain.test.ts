import { describe, expect, it } from "vitest"

import {
  ideOnlySummary,
  platformFolder,
  PLATFORM_ORDER,
  SOURCE_HELP,
  STATUS_HELP,
  STATUS_LABEL,
  targetsSummary,
} from "@/lib/artifacts/sync-explain"

describe("sync-explain", () => {
  it("names the source folder", () => {
    expect(SOURCE_HELP).toContain(".black-agents/artifacts/")
  })

  it("lists every platform with its folder", () => {
    expect(PLATFORM_ORDER).toEqual(["cursor", "claude", "windsurf", "antigravity", "opencode"])
    expect(platformFolder("claude")).toBe(".claude/")
    expect(platformFolder("opencode")).toBe(".opencode/")
  })

  it("explains every status", () => {
    for (const status of ["in-sync", "drifted", "missing"] as const) {
      expect(STATUS_LABEL[status]).toBeTruthy()
      expect(STATUS_HELP[status]).toBeTruthy()
    }
  })

  it("summarizes the targets", () => {
    expect(targetsSummary([], true)).toContain("only in BlackAgents")
    expect(targetsSummary(["cursor", "claude"], true)).toBe("Each save updates Cursor, Claude.")
    expect(targetsSummary(["cursor"], false)).toContain("found in this workspace")
  })

  it("summarizes IDE-only artifacts", () => {
    expect(ideOnlySummary(0)).toBe("Every artifact is in BlackAgents.")
    expect(ideOnlySummary(1)).toMatch(/^1 artifact is only/)
    expect(ideOnlySummary(3)).toMatch(/^3 artifacts are only/)
  })
})
