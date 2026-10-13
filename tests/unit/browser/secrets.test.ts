import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  promoteFlowSecrets,
  resolveStepArgsForReplay,
  suggestBrowserSecretId,
} from "@/lib/browser/secrets"
import type { BrowserFlowStep } from "@/lib/browser/flows/schema"

let configDir: string
const prev = process.env.BLACK_AGENTS_CONFIG_DIR

beforeEach(async () => {
  configDir = await mkdtemp(path.join(tmpdir(), "ba-sec-"))
  process.env.BLACK_AGENTS_CONFIG_DIR = configDir
})

afterEach(async () => {
  if (prev === undefined) delete process.env.BLACK_AGENTS_CONFIG_DIR
  else process.env.BLACK_AGENTS_CONFIG_DIR = prev
  await rm(configDir, { recursive: true, force: true })
})

describe("browser flow secrets", () => {
  it("suggests a stable browser.* id", () => {
    expect(
      suggestBrowserSecretId("time-registration", {
        id: "step_2",
        args: { element: "Password field" },
      })
    ).toBe("browser.time-registration.password-field")
  })

  it("promotes password fills and resolves on replay", async () => {
    const steps: BrowserFlowStep[] = [
      {
        id: "step_1",
        tool: "browser_type",
        args: { element: "Password", text: "s3cret!" },
        kind: "action",
        intent: "Fill Password",
      },
    ]
    const promoted = await promoteFlowSecrets("time-registration", steps)
    expect(promoted[0]?.args.secretId).toMatch(/^browser\.time-registration\./)
    expect(promoted[0]?.args.text).toBeUndefined()

    const resolved = await resolveStepArgsForReplay(promoted[0]!.args)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.args.text).toBe("s3cret!")
  })
})
