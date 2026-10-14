import { afterEach, describe, expect, it, vi } from "vitest"

import {
  commandEnv,
  commonToolDirs,
  mergePathLists,
  parseMarkedPath,
  resetCommandEnv,
} from "@/lib/runtime/shell-env"

afterEach(() => {
  vi.unstubAllEnvs()
  resetCommandEnv()
})

describe("mergePathLists", () => {
  it("keeps order and drops duplicates and blanks", () => {
    expect(mergePathLists(":", "/a:/b", undefined, "/b::/c", " /a ")).toBe("/a:/b:/c")
  })
})

describe("parseMarkedPath", () => {
  it("reads the PATH between markers and ignores profile noise", () => {
    expect(parseMarkedPath("Welcome!\n__BLACK_AGENTS_PATH__/opt/x:/usr/bin__BLACK_AGENTS_PATH__")).toBe(
      "/opt/x:/usr/bin"
    )
  })

  it("returns null without both markers or with an empty value", () => {
    expect(parseMarkedPath("no markers")).toBeNull()
    expect(parseMarkedPath("__BLACK_AGENTS_PATH__/a")).toBeNull()
    expect(parseMarkedPath("__BLACK_AGENTS_PATH____BLACK_AGENTS_PATH__")).toBeNull()
  })
})

describe("commonToolDirs", () => {
  it("lists Homebrew and per-user tool folders on macOS/Linux", () => {
    const dirs = commonToolDirs("/Users/me", "darwin")
    expect(dirs).toContain("/opt/homebrew/bin")
    expect(dirs).toContain("/usr/local/bin")
    expect(dirs).toContain("/Users/me/Library/pnpm")
  })

  it("adds nothing on Windows", () => {
    expect(commonToolDirs("C:\\Users\\me", "win32")).toEqual([])
  })
})

describe("commandEnv", () => {
  it("keeps the current PATH and adds the common tool folders", async () => {
    vi.stubEnv("SHELL", "/definitely/missing/shell")
    vi.stubEnv("PATH", "/usr/bin:/bin")
    const env = await commandEnv()
    const dirs = String(env.PATH).split(":")
    expect(dirs.slice(0, 2)).toEqual(["/usr/bin", "/bin"])
    expect(dirs).toContain("/opt/homebrew/bin")
  })

  it("puts the login shell PATH first", async () => {
    vi.stubEnv("SHELL", "/bin/sh")
    vi.stubEnv("PATH", "/usr/bin:/bin")
    const env = await commandEnv()
    expect(String(env.PATH).split(":")).toContain("/usr/bin")
    expect(await commandEnv()).toBe(env)
  })
})
