import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"

import {
  loadStandards,
  resetStandards,
  saveStandards,
} from "@/lib/standards"
import { DEFAULT_STANDARDS_MD } from "@/lib/standards/default-standards"
import { makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("standards", () => {
  it("returns the baked default when no override exists", async () => {
    const doc = await loadStandards()
    expect(doc.custom).toBe(false)
    expect(doc.content).toBe(DEFAULT_STANDARDS_MD)
  })

  it("saves a workspace override and reads it back as custom", async () => {
    await saveStandards("# My standards\n\n- rule one")
    const doc = await loadStandards()
    expect(doc.custom).toBe(true)
    expect(doc.content).toContain("My standards")

    const onDisk = await readFile(
      path.join(env.workspace, ".black-agents/standards.md"),
      "utf8"
    )
    expect(onDisk.endsWith("\n")).toBe(true)
  })

  it("reset removes the override and falls back to default", async () => {
    await saveStandards("# temp")
    expect((await loadStandards()).custom).toBe(true)

    const reset = await resetStandards()
    expect(reset.custom).toBe(false)
    expect((await loadStandards()).custom).toBe(false)
  })
})
