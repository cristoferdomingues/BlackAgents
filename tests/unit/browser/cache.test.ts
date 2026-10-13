import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  argsForCache,
  cacheKey,
  pageSignatureFromSnapshot,
  readActionCache,
  writeActionCache,
} from "@/lib/browser/cache"

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ba-cache-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("browser action cache", () => {
  it("strips plaintext when secretId is present", () => {
    expect(
      argsForCache({ secretId: "browser.x.password", text: "nope", ref: "e1" })
    ).toEqual({ secretId: "browser.x.password", ref: "e1" })
  })

  it("round-trips an entry by intent + page signature", async () => {
    const sig = pageSignatureFromSnapshot('heading "Timesheet"\nbutton Submit', "https://ex")
    const intent = "Click Submit"
    await writeActionCache(root, "time-registration", {
      intent,
      pageSignature: sig,
      tool: "browser_click",
      args: { element: "Submit", ref: "e3" },
    })
    const hit = await readActionCache(root, "time-registration", intent, sig)
    expect(hit?.tool).toBe("browser_click")
    expect(hit?.args.ref).toBe("e3")
    expect(cacheKey(intent, sig)).toHaveLength(32)
  })
})
