import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  addWorkspace,
  readConfig,
  removeWorkspace,
  setActiveWorkspace,
  writeConfig,
} from "@/lib/config"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ba-cfg-"))
  await mkdir(dir, { recursive: true })
  process.env.BLACK_AGENTS_CONFIG_DIR = dir
})
afterEach(async () => {
  delete process.env.BLACK_AGENTS_CONFIG_DIR
  await rm(dir, { recursive: true, force: true })
})

describe("readConfig", () => {
  it("returns the empty default when no file exists", async () => {
    expect(await readConfig()).toEqual({ workspaces: [] })
  })

  it("migrates legacy `recents` into workspaces", async () => {
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({ currentPath: "/a", recents: ["/a", "/b"] }),
      "utf8"
    )
    const config = await readConfig()
    expect(config.workspaces).toEqual(["/a", "/b"])
    expect(config.currentPath).toBe("/a")
  })

  it("defaults currentPath to the first workspace when none is set", async () => {
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({ workspaces: ["/a", "/b"] }),
      "utf8"
    )
    expect((await readConfig()).currentPath).toBe("/a")
  })
})

describe("addWorkspace", () => {
  it("adds and activates the first workspace, deduping", async () => {
    await addWorkspace("/a")
    let config = await addWorkspace("/b")
    config = await addWorkspace("/a")
    expect(config.workspaces).toEqual(["/a", "/b"])
    expect(config.currentPath).toBe("/a")
  })
})

describe("setActiveWorkspace", () => {
  it("switches active and adds the path if missing", async () => {
    await addWorkspace("/a")
    const config = await setActiveWorkspace("/b")
    expect(config.currentPath).toBe("/b")
    expect(config.workspaces).toContain("/b")
  })
})

describe("removeWorkspace", () => {
  it("removes and re-points active to the first remaining", async () => {
    await addWorkspace("/a")
    await addWorkspace("/b")
    await setActiveWorkspace("/a")
    const config = await removeWorkspace("/a")
    expect(config.workspaces).toEqual(["/b"])
    expect(config.currentPath).toBe("/b")
  })
})

describe("writeConfig", () => {
  it("persists and is read back", async () => {
    await writeConfig({ currentPath: "/x", workspaces: ["/x", "/y"] })
    expect(await readConfig()).toEqual({ currentPath: "/x", workspaces: ["/x", "/y"] })
  })
})
