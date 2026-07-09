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
    })
  })

  it("reports a non-existent path", async () => {
    expect(await checkDirectory(path.join(env.workspace, "ghost"))).toEqual({
      exists: false,
      isDirectory: false,
    })
  })

  it("normalizes to an absolute path", () => {
    expect(path.isAbsolute(normalizeWorkspaceInput("  ./x  "))).toBe(true)
  })
})
