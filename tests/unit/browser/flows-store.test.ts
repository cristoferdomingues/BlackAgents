import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  deleteBrowserFlow,
  listBrowserFlows,
  loadAutoAcceptedFlows,
  saveBrowserFlow,
  setBrowserFlowAutoAccept,
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
    expect(flow.version).toBe(2)
    expect(flow.steps[0]?.intent).toBeUndefined()

    const listed = await listBrowserFlows(root)
    expect(listed.map((f) => f.name)).toEqual(["time-registration"])

    expect(flow.autoAccept).toBe(false)
    expect(await deleteBrowserFlow(root, "time-registration")).toBe(true)
    expect(await listBrowserFlows(root)).toEqual([])
  })

  it("keeps auto-accept when a later save omits it", async () => {
    await saveBrowserFlow(root, {
      name: "clock-in",
      steps: [{ id: "step_1", tool: "browser_click", args: { element: "Clock in" } }],
    })
    const turnedOn = await setBrowserFlowAutoAccept(root, "clock-in", true)
    expect(turnedOn?.autoAccept).toBe(true)

    const savedAgain = await saveBrowserFlow(root, {
      name: "clock-in",
      steps: [{ id: "step_1", tool: "browser_click", args: { element: "Clock in" } }],
    })
    expect(savedAgain.autoAccept).toBe(true)

    const grants = await loadAutoAcceptedFlows(root)
    expect(grants.flowNames).toEqual(["clock-in"])
    expect(grants.calls).toEqual([{ tool: "browser_click", args: { element: "Clock in" } }])

    expect(await setBrowserFlowAutoAccept(root, "missing", true)).toBeNull()
  })
})
