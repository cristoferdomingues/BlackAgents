import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  addWorkspace,
  readConfig,
  removeWorkspace,
  setActiveProject,
  setActiveWorkspace,
  writeConfig,
} from "@/lib/config"

let configDir: string
let prev: string | undefined

beforeEach(async () => {
  prev = process.env.BLACK_AGENTS_CONFIG_DIR
  configDir = await mkdtemp(path.join(tmpdir(), "ba-config-"))
  process.env.BLACK_AGENTS_CONFIG_DIR = configDir
})
afterEach(async () => {
  if (prev === undefined) delete process.env.BLACK_AGENTS_CONFIG_DIR
  else process.env.BLACK_AGENTS_CONFIG_DIR = prev
  await rm(configDir, { recursive: true, force: true })
})

describe("activeProject persistence", () => {
  it("is absent in a fresh config", async () => {
    expect((await readConfig()).activeProject).toBeUndefined()
  })

  it("setActiveProject persists and clears the id", async () => {
    const ws = path.join(configDir, "ws")
    await setActiveWorkspace(ws)

    const set = await setActiveProject("crypto-bot")
    expect(set.activeProject).toBe("crypto-bot")
    expect((await readConfig()).activeProject).toBe("crypto-bot")

    const cleared = await setActiveProject(undefined)
    expect(cleared.activeProject).toBeUndefined()
    expect((await readConfig()).activeProject).toBeUndefined()
  })

  it("switching the active workspace clears the project", async () => {
    await setActiveWorkspace(path.join(configDir, "ws-a"))
    await setActiveProject("crypto-bot")

    const switched = await setActiveWorkspace(path.join(configDir, "ws-b"))
    expect(switched.currentPath).toBe(path.join(configDir, "ws-b"))
    expect(switched.activeProject).toBeUndefined()
  })

  it("re-selecting the same workspace keeps the project", async () => {
    const ws = path.join(configDir, "ws")
    await setActiveWorkspace(ws)
    await setActiveProject("crypto-bot")
    const again = await setActiveWorkspace(ws)
    expect(again.activeProject).toBe("crypto-bot")
  })

  it("addWorkspace only appends — it never clears the project", async () => {
    const wsA = path.join(configDir, "ws-a")
    await setActiveWorkspace(wsA)
    await setActiveProject("crypto-bot")

    // Adding another workspace does not switch: the project survives,
    // and only a real switch (setActiveWorkspace) resets it.
    const appended = await addWorkspace(path.join(configDir, "ws-b"))
    expect(appended.currentPath).toBe(wsA)
    expect(appended.activeProject).toBe("crypto-bot")
    expect(appended.workspaces).toHaveLength(2)
  })

  it("removing the active workspace drops its project; other workspaces keep theirs", async () => {
    const wsA = path.join(configDir, "ws-a")
    const wsB = path.join(configDir, "ws-b")
    await writeConfig({ currentPath: wsA, activeProject: "crypto-bot", workspaces: [wsA, wsB] })

    // Removing a non-active workspace keeps the active project.
    const afterOther = await removeWorkspace(wsB)
    expect(afterOther.activeProject).toBe("crypto-bot")
    expect(afterOther.workspaces).toEqual([wsA])

    // Removing the active workspace never keeps a homeless project id.
    const afterActive = await removeWorkspace(wsA)
    expect(afterActive.activeProject).toBeUndefined()
    expect(afterActive.currentPath).toBeUndefined()
  })

  it("a project id survives a config round-trip through readConfig", async () => {
    await writeConfig({ currentPath: "/tmp/ws", activeProject: "web", workspaces: ["/tmp/ws"] })
    expect((await readConfig()).activeProject).toBe("web")
  })
})
