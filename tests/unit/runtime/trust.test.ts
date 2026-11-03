import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  readWorkspaceTrust,
  setShellCommandsTrust,
  TRUST_FILENAME,
  trustFilePath,
} from "@/lib/runtime/trust"

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

  it("adds normalized programs and persists them per workspace", async () => {
    await setShellCommandsTrust(env.workspace, ["MKDIR", "./cp"], true)
    await setShellCommandsTrust(env.workspace, ["mkdir"], true)
    await expect(readWorkspaceTrust(env.workspace)).resolves.toEqual({
      shellCommands: ["cp", "mkdir"],
    })
    const raw = JSON.parse(await readFile(trustFilePath(), "utf8")) as unknown
    expect(raw).toEqual({
      workspaces: {
        [path.resolve(env.workspace)]: { shellCommands: ["cp", "mkdir"] },
      },
    })
    expect(trustFilePath()).toBe(path.join(env.configDir, TRUST_FILENAME))
  })

  it("removes a program and drops an empty workspace entry", async () => {
    await setShellCommandsTrust(env.workspace, ["mkdir", "cp"], true)
    await setShellCommandsTrust(env.workspace, ["mkdir"], false)
    await setShellCommandsTrust(env.workspace, ["bad name", ""], true)
    await expect(readWorkspaceTrust(env.workspace)).resolves.toEqual({ shellCommands: ["cp"] })

    await setShellCommandsTrust(env.workspace, ["cp"], false)
    const raw = JSON.parse(await readFile(trustFilePath(), "utf8")) as unknown
    expect(raw).toEqual({ workspaces: {} })
  })

  it("keeps workspaces isolated from each other", async () => {
    const other = path.join(env.workspace, "..", "other-workspace")
    await mkdir(other, { recursive: true })
    await setShellCommandsTrust(env.workspace, ["mkdir"], true)
    await expect(readWorkspaceTrust(other)).resolves.toEqual({ shellCommands: [] })
  })

  it("ignores a trust file shipped inside the workspace", async () => {
    await mkdir(path.join(env.workspace, ".black-agents"), { recursive: true })
    await writeFile(
      path.join(env.workspace, ".black-agents", TRUST_FILENAME),
      JSON.stringify({ shellCommands: ["rm"] }),
      "utf8"
    )
    await expect(readWorkspaceTrust(env.workspace)).resolves.toEqual({ shellCommands: [] })
  })

  it("treats a corrupt file as empty", async () => {
    await writeFile(trustFilePath(), "{not json", "utf8")
    await expect(readWorkspaceTrust(env.workspace)).resolves.toEqual({ shellCommands: [] })
  })
})
