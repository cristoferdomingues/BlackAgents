import { describe, it, expect } from "vitest"

import {
  ARTIFACT_TYPE_LIST,
  metaForType,
  typeFromRoute,
} from "@/lib/artifacts/constants"

describe("artifact type constants", () => {
  it("lists the four types in order", () => {
    expect(ARTIFACT_TYPE_LIST.map((t) => t.type)).toEqual([
      "agent",
      "command",
      "rule",
      "skill",
    ])
  })

  it("maps a route segment back to a type", () => {
    expect(typeFromRoute("agents")).toBe("agent")
    expect(typeFromRoute("skills")).toBe("skill")
    expect(typeFromRoute("nope")).toBeUndefined()
  })

  it("returns metadata for a type", () => {
    expect(metaForType("rule")).toMatchObject({ label: "Rule", route: "rules" })
  })
})
