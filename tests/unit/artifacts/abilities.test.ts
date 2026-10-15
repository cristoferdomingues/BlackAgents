import { describe, expect, it } from "vitest"

import {
  ABILITY_LEVELS,
  abilityChoiceOf,
  includedTools,
  riskOfTools,
  toggleTool,
} from "@/lib/artifacts/abilities"

describe("abilityChoiceOf", () => {
  it("maps each level's tools back to that level", () => {
    expect(abilityChoiceOf(ABILITY_LEVELS.read.tools)).toBe("read")
    expect(abilityChoiceOf(ABILITY_LEVELS.write.tools)).toBe("write")
    expect(abilityChoiceOf(ABILITY_LEVELS.full.tools)).toBe("full")
  })

  it("treats included tools listed by hand as the same level", () => {
    expect(abilityChoiceOf(["fs_list", "fs_read", "fs_find", "fs_search"])).toBe("read")
    expect(abilityChoiceOf(["fs_read", "fs_list", "fs_write", "fs_edit"])).toBe("write")
  })

  it("returns custom for sets that match no level", () => {
    expect(abilityChoiceOf([])).toBe("custom")
    expect(abilityChoiceOf(["fs_read"])).toBe("custom")
    expect(abilityChoiceOf([...ABILITY_LEVELS.full.tools, "browser_run_flow"])).toBe("custom")
    expect(abilityChoiceOf(["shell_run"])).toBe("custom")
  })
})

describe("includedTools", () => {
  it("lists the tools that come with read and write access", () => {
    expect(includedTools(["fs_list", "fs_read"])).toEqual(["fs_find", "fs_search"])
    expect(includedTools(["fs_list", "fs_read", "fs_write"])).toEqual(["fs_find", "fs_search", "fs_edit"])
  })

  it("is empty when nothing is implied or all is listed", () => {
    expect(includedTools([])).toEqual([])
    expect(includedTools(["shell_run"])).toEqual([])
    expect(includedTools(["fs_read", "fs_find", "fs_search"])).toEqual([])
  })
})

describe("riskOfTools", () => {
  it("rates read tools low, writes medium and commands high", () => {
    expect(riskOfTools([])).toBe("low")
    expect(riskOfTools(["fs_list", "fs_read", "fs_search"])).toBe("low")
    expect(riskOfTools(["fs_read", "fs_edit"])).toBe("medium")
    expect(riskOfTools(["browser_run_flow"])).toBe("medium")
    expect(riskOfTools(["fs_write", "shell_run"])).toBe("high")
  })
})

describe("toggleTool", () => {
  it("adds and removes a tool in canonical order without duplicates", () => {
    expect(toggleTool(["fs_read"], "fs_list", true)).toEqual(["fs_list", "fs_read"])
    expect(toggleTool(["fs_list", "fs_read"], "fs_read", true)).toEqual(["fs_list", "fs_read"])
    expect(toggleTool(["fs_list", "fs_read"], "fs_list", false)).toEqual(["fs_read"])
    expect(toggleTool([], "shell_run", false)).toEqual([])
  })
})
