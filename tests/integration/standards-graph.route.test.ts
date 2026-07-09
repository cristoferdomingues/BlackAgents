import { describe, it, expect, beforeEach, afterEach } from "vitest"

import {
  GET as standardsGET,
  PUT as standardsPUT,
  DELETE as standardsDELETE,
} from "@/app/api/standards/route"
import { GET as graphGET } from "@/app/api/graph/route"
import { POST as createArtifact } from "@/app/api/artifacts/route"
import { makeTempEnv, jsonRequest, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("standards route", () => {
  it("GET returns the default (non-custom) standards", async () => {
    const json = await (await standardsGET()).json()
    expect(json.data.custom).toBe(false)
    expect(typeof json.data.content).toBe("string")
  })

  it("PUT saves an override, then DELETE resets", async () => {
    const put = await standardsPUT(jsonRequest("http://t", "PUT", { content: "# Custom\n" }))
    expect((await put.json()).data.custom).toBe(true)
    expect((await (await standardsGET()).json()).data.custom).toBe(true)

    await standardsDELETE()
    expect((await (await standardsGET()).json()).data.custom).toBe(false)
  })

  it("PUT rejects empty content", async () => {
    const res = await standardsPUT(jsonRequest("http://t", "PUT", { content: "" }))
    expect(res.status).toBe(400)
  })
})

describe("graph route", () => {
  it("returns empty graph for a fresh workspace", async () => {
    const json = await (await graphGET()).json()
    expect(json.data).toEqual({ nodes: [], links: [] })
  })

  it("builds nodes and a link from the authoring conventions", async () => {
    await createArtifact(
      jsonRequest("http://t", "POST", {
        type: "command",
        platform: "cursor",
        name: "ship",
        description: "Ship it.",
        body: "Invoke the **tester** agent.",
        extra: {},
      })
    )
    await createArtifact(
      jsonRequest("http://t", "POST", {
        type: "agent",
        platform: "cursor",
        name: "tester",
        description: "Tests.",
        body: "## Input\n",
        extra: {},
      })
    )

    const json = await (await graphGET()).json()
    expect(json.data.nodes).toHaveLength(2)
    expect(json.data.links).toContainEqual(
      expect.objectContaining({
        source: "command:ship",
        target: "agent:tester",
        kind: "command-agent",
      })
    )
  })
})
