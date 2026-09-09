import { describe, it, expect } from "vitest"

import {
  ACTIVE_PLATFORMS,
  DEFAULT_PLATFORM,
  artifactDeletePath,
  artifactRelPath,
  typeLayout,
} from "@/lib/artifacts/layout"

describe("typeLayout", () => {
  it("maps cursor rules to .mdc", () => {
    expect(typeLayout("cursor", "rule")).toMatchObject({
      dir: ".cursor/rules",
      ext: ".mdc",
      nested: false,
    })
  })

  it("marks skills as nested with a SKILL.md entry", () => {
    expect(typeLayout("cursor", "skill")).toMatchObject({
      nested: true,
      entryFile: "SKILL.md",
    })
  })

  it("maps claude rules to .md (not .mdc)", () => {
    expect(typeLayout("claude", "rule").ext).toBe(".md")
  })

  it("maps windsurf commands to the workflows dir", () => {
    expect(typeLayout("windsurf", "command").dir).toBe(".windsurf/workflows")
  })

  it("maps antigravity artifacts to .agents layout", () => {
    expect(typeLayout("antigravity", "skill")).toMatchObject({
      dir: ".agents/skills",
      nested: true,
      entryFile: "SKILL.md",
    })
    expect(typeLayout("antigravity", "rule")).toMatchObject({
      dir: ".agents/rules",
      ext: ".md",
      nested: false,
    })
    expect(typeLayout("antigravity", "command")).toMatchObject({
      dir: ".agents/workflows",
      ext: ".md",
      nested: false,
    })
    expect(typeLayout("antigravity", "agent")).toMatchObject({
      dir: ".agents/agents",
      ext: ".md",
      nested: false,
    })
  })
})

describe("artifactRelPath", () => {
  it("builds flat paths for agents/commands/rules", () => {
    expect(artifactRelPath("cursor", "agent", "tester")).toBe(
      ".cursor/agents/tester.md"
    )
    expect(artifactRelPath("cursor", "command", "ship")).toBe(
      ".cursor/commands/ship.md"
    )
    expect(artifactRelPath("cursor", "rule", "no-secrets")).toBe(
      ".cursor/rules/no-secrets.mdc"
    )
  })

  it("nests skills under their own directory", () => {
    expect(artifactRelPath("cursor", "skill", "code-review")).toBe(
      ".cursor/skills/code-review/SKILL.md"
    )
  })
})

describe("artifactDeletePath", () => {
  it("returns the file for flat artifacts", () => {
    expect(artifactDeletePath("cursor", "agent", "tester")).toBe(
      ".cursor/agents/tester.md"
    )
  })

  it("returns the directory for skills", () => {
    expect(artifactDeletePath("cursor", "skill", "code-review")).toBe(
      ".cursor/skills/code-review"
    )
  })
})

describe("platform constants", () => {
  it("scans cursor and claude, defaults to cursor", () => {
    expect(ACTIVE_PLATFORMS).toEqual(["cursor", "claude"])
    expect(DEFAULT_PLATFORM).toBe("cursor")
  })
})
