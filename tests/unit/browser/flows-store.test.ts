import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  deleteBrowserFlow,
  listBrowserFlows,
  saveBrowserFlow,
} from "@/lib/browser/flows/store"

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ba-flow-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("browser flow store", () => {
  it("saves, lists, and deletes a flow", async () => {
    const flow = await saveBrowserFlow(root, {
      name: "time-registration",
      description: "Clock in",
      steps: [
        {
          id: "step_1",
          tool: "browser_navigate",
          args: { url: "https://example.com" },
        },
      ],
      startUrl: "https://example.com",
    })

    expect(flow.name).toBe("time-registration")
    expect(flow.version).toBe(1)

    const listed = await listBrowserFlows(root)
    expect(listed.map((f) => f.name)).toEqual(["time-registration"])

    expect(await deleteBrowserFlow(root, "time-registration")).toBe(true)
    expect(await listBrowserFlows(root)).toEqual([])
  })
})
