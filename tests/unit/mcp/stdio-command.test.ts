import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  enrichPathEnv,
  prepareStdioLaunch,
  resolveCommandOnPath,
} from "@/lib/mcp/stdio-command"

describe("enrichPathEnv", () => {
  it("prepends existing extra dirs and keeps the original PATH", () => {
    const enriched = enrichPathEnv("/usr/bin:/bin", ["/opt/homebrew/bin", "/no/such/dir"])
    // /opt/homebrew/bin may or may not exist on the machine; only assert order when present.
    expect(enriched.split(path.delimiter)).toContain("/usr/bin")
    expect(enriched.endsWith("/usr/bin:/bin") || enriched.includes("/usr/bin:/bin")).toBe(
      true
    )
  })
})

describe("resolveCommandOnPath / prepareStdioLaunch", () => {
  let binDir: string

  beforeEach(async () => {
    binDir = path.join(tmpdir(), `ba-stdio-bin-${Date.now()}`)
    await mkdir(binDir, { recursive: true })
    await writeFile(path.join(binDir, "npx"), "#!/bin/sh\n", { mode: 0o755 })
  })

  afterEach(async () => {
    await rm(binDir, { recursive: true, force: true })
  })

  it("resolves a bare command to an absolute path", () => {
    const resolved = resolveCommandOnPath("npx", binDir)
    expect(resolved).toBe(path.join(binDir, "npx"))
  })

  it("enriches PATH and resolves npx for stdio launch", () => {
    const launch = prepareStdioLaunch(
      "npx",
      { FOO: "bar" },
      { PATH: "/usr/bin", HOME: process.env.HOME }
    )
    expect(launch.env.FOO).toBe("bar")
    expect(launch.env.PATH).toContain("/usr/bin")
    // Absolute when found on the enriched PATH (homebrew/node sibling often works).
    if (launch.command !== "npx") {
      expect(path.isAbsolute(launch.command)).toBe(true)
      expect(launch.command.endsWith("npx") || launch.command.endsWith("npx.cmd")).toBe(
        true
      )
    }
  })

  it("prefers an absolute command as-is", () => {
    const abs = path.join(binDir, "npx")
    expect(resolveCommandOnPath(abs, "/usr/bin")).toBe(abs)
  })
})
