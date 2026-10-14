import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GET as getBrowser } from "@/app/api/browser/route"
import { PATCH } from "@/app/api/browser/flows/[name]/route"
import { saveBrowserFlow } from "@/lib/browser/flows/store"
import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
})

afterEach(async () => {
  await env.cleanup()
})

describe("PATCH /api/browser/flows/[name]", () => {
  it("turns auto-accept on for a saved flow", async () => {
    await saveBrowserFlow(env.workspace, {
      name: "clock-in",
      steps: [{ id: "step_1", tool: "browser_navigate", args: { url: "https://example.com" } }],
    })

    const res = await PATCH(
      jsonRequest("http://t/api/browser/flows/clock-in", "PATCH", { autoAccept: true }),
      { params: Promise.resolve({ name: "clock-in" }) }
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.flow.autoAccept).toBe(true)

    const listed = await getBrowser()
    const body = await listed.json()
    expect(body.data.flows[0]).toMatchObject({ name: "clock-in", autoAccept: true })
  })

  it("rejects a missing flow and a bad body", async () => {
    const missing = await PATCH(
      jsonRequest("http://t/api/browser/flows/nope", "PATCH", { autoAccept: true }),
      { params: Promise.resolve({ name: "nope" }) }
    )
    expect(missing.status).toBe(404)

    const bad = await PATCH(
      jsonRequest("http://t/api/browser/flows/clock-in", "PATCH", { autoAccept: "yes" }),
      { params: Promise.resolve({ name: "clock-in" }) }
    )
    expect(bad.status).toBe(400)
  })
})
