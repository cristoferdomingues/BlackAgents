import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { readWorkspaceTrust, setShellCommandsTrust, TRUST_PATH } from "@/lib/runtime/trust"

import { makeTempEnv, type TempEnv } from "../../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("workspace trust", () => {
  it("starts empty when the file is missing", async () => {
    await expect(readWorkspaceTrust(env.workspace)).resolves.toEqual({ shellCommands: [] })
  })

  it("adds normalized programs and persists them sorted", async () => {
    await setShellCommandsTrust(env.workspace, ["MKDIR", "./cp"], true)
    await setShellCommandsTrust(env.workspace, ["mkdir"], true)
    await expect(readWorkspaceTrust(env.workspace)).resolves.toEqual({
      shellCommands: ["cp", "mkdir"],
    })
    const raw = JSON.parse(await readFile(path.join(env.workspace, TRUST_PATH), "utf8")) as unknown
    expect(raw).toEqual({ shellCommands: ["cp", "mkdir"] })
  })

  it("removes a program and ignores unusable names", async () => {
    await setShellCommandsTrust(env.workspace, ["mkdir", "cp"], true)
    await setShellCommandsTrust(env.workspace, ["mkdir"], false)
    await setShellCommandsTrust(env.workspace, ["bad name", ""], true)
    await expect(readWorkspaceTrust(env.workspace)).resolves.toEqual({ shellCommands: ["cp"] })
  })

  it("treats a corrupt file as empty", async () => {
    await mkdir(path.join(env.workspace, ".black-agents"), { recursive: true })
    await writeFile(path.join(env.workspace, TRUST_PATH), "{not json", "utf8")
    await expect(readWorkspaceTrust(env.workspace)).resolves.toEqual({ shellCommands: [] })
  })
})
