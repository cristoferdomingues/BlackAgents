import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"

import {
  WorkspaceError,
  checkDirectory,
  currentWorkspace,
  listDir,
  normalizeWorkspaceInput,
  pathExists,
  readText,
  removePath,
  resolveInWorkspace,
  scaffoldWorkspace,
  walkFiles,
  workspaceRoot,
  writeText,
} from "@/lib/fs-service"
import { makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("resolveInWorkspace", () => {
  it("resolves a relative path under the root", () => {
    const abs = resolveInWorkspace("/root", ".cursor/agents/a.md")
    expect(abs).toBe(path.resolve("/root/.cursor/agents/a.md"))
  })

  it("throws on parent-directory traversal", () => {
    expect(() => resolveInWorkspace("/root", "../escape")).toThrow(WorkspaceError)
    expect(() => resolveInWorkspace("/root", "a/../../escape")).toThrow(WorkspaceError)
  })

  it("throws on an absolute path outside the root", () => {
    expect(() => resolveInWorkspace("/root", "/etc/passwd")).toThrow(WorkspaceError)
  })
})

describe("workspaceRoot / currentWorkspace", () => {
  it("returns the active workspace from config", async () => {
    expect(await workspaceRoot()).toBe(env.workspace)
    expect(await currentWorkspace()).toEqual({
      path: env.workspace,
      name: path.basename(env.workspace),
    })
  })
})

describe("file I/O round-trip", () => {
  it("writes, reads, lists, walks, and removes", async () => {
    const abs = resolveInWorkspace(env.workspace, ".cursor/skills/s/SKILL.md")
    await writeText(abs, "hello")
    expect(await pathExists(abs)).toBe(true)
    expect(await readText(abs)).toBe("hello")

    await writeText(
      resolveInWorkspace(env.workspace, ".cursor/skills/s/refs/note.md"),
      "note"
    )
    const skillDir = resolveInWorkspace(env.workspace, ".cursor/skills/s")
    expect((await walkFiles(skillDir)).sort()).toEqual(["SKILL.md", "refs/note.md"])

    const entries = await listDir(resolveInWorkspace(env.workspace, ".cursor/skills"))
    expect(entries).toContainEqual({ name: "s", isDirectory: true })

    await removePath(skillDir)
    expect(await pathExists(skillDir)).toBe(false)
  })

  it("listDir returns [] for a missing directory", async () => {
    expect(await listDir(resolveInWorkspace(env.workspace, "nope"))).toEqual([])
  })
})

describe("checkDirectory / normalizeWorkspaceInput", () => {
  it("detects an existing directory", async () => {
    expect(await checkDirectory(env.workspace)).toEqual({
      exists: true,
      isDirectory: true,
      canCreate: false,
    })
  })

  it("reports a non-existent path and verifies parent exists", async () => {
    expect(await checkDirectory(path.join(env.workspace, "ghost"))).toEqual({
      exists: false,
      isDirectory: false,
      canCreate: true,
    })
  })

  it("normalizes to an absolute path", () => {
    expect(path.isAbsolute(normalizeWorkspaceInput("  ./x  "))).toBe(true)
  })
})

describe("scaffoldWorkspace", () => {
  it("creates standard directories and seeds crypto starter artifacts", async () => {
    const target = path.join(env.workspace, "new-crypto-ws")
    const created = await scaffoldWorkspace(target, "crypto")
    expect(created).toBe(path.resolve(target))

    expect(await pathExists(path.join(target, ".cursor", "agents", "portfolio-rebalancer.md"))).toBe(true)
    expect(await pathExists(path.join(target, ".cursor", "rules", "risk-management.mdc"))).toBe(true)
    expect(await pathExists(path.join(target, ".cursor", "skills", "defi-lending-protocols", "SKILL.md"))).toBe(true)
    expect(await pathExists(path.join(target, ".cursor", "commands", "weekly-portfolio-review.md"))).toBe(true)
  })

  it("creates standard directories and seeds software starter artifacts", async () => {
    const target = path.join(env.workspace, "new-software-ws")
    await scaffoldWorkspace(target, "software")

    expect(await pathExists(path.join(target, ".cursor", "agents", "feature-developer.md"))).toBe(true)
    expect(await pathExists(path.join(target, ".cursor", "rules", "typescript-strict.mdc"))).toBe(true)
  })

  it("creates blank workspace with readme", async () => {
    const target = path.join(env.workspace, "new-blank-ws")
    await scaffoldWorkspace(target, "blank")

    expect(await pathExists(path.join(target, "README.md"))).toBe(true)
    expect(await pathExists(path.join(target, ".cursor", "agents"))).toBe(true)
  })
})
