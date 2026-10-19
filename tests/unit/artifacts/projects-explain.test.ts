import { describe, expect, it } from "vitest"

import {
  artifactOrigin,
  inheritsSummary,
  SCOPE_TOKENS,
  suggestProjectId,
  withScope,
} from "@/lib/artifacts/projects-explain"
import { scopeTokenSchema } from "@/lib/artifacts/schemas"

describe("projects explain helpers", () => {
  it("documents every inheritable token exactly once", () => {
    expect(SCOPE_TOKENS.map((t) => t.token).sort()).toEqual([...scopeTokenSchema.options].sort())
  })

  it("labels artifact origin from the active project", () => {
    expect(artifactOrigin({}, null)).toBe("workspace")
    expect(artifactOrigin({ scope: { project: "web" } }, "web")).toBe("project")
    expect(artifactOrigin({}, "web")).toBe("inherited")
    expect(artifactOrigin({ scope: { project: "other" } }, "web")).toBe("inherited")
  })

  it("adds the scope query only when a project is active", () => {
    expect(withScope("/api/artifacts", null)).toBe("/api/artifacts")
    expect(withScope("/api/artifacts", "web")).toBe("/api/artifacts?scope=web")
    expect(withScope("/api/artifacts/rule/a?x=1", "web")).toBe("/api/artifacts/rule/a?x=1&scope=web")
  })

  it("summarizes the whitelist in plain words", () => {
    expect(inheritsSummary([])).toBe("Sees nothing from the workspace")
    expect(inheritsSummary(["skills", "rules"])).toBe("Sees workspace rules, skills")
  })

  it("suggests a kebab-case folder id from a name", () => {
    expect(suggestProjectId("MyHealthCare")).toBe("myhealthcare")
    expect(suggestProjectId("  My Health / Care! ")).toBe("my-health-care")
    expect(suggestProjectId("../..")).toBe("")
  })
})
