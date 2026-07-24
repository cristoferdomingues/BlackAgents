import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { GET, PUT } from "@/app/api/providers/route"
import { makeTempEnv, jsonRequest, type TempEnv } from "../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
})

afterEach(async () => {
  await env.cleanup()
})

describe("PUT /api/providers defaults", () => {
  it("persists the Assistant provider/model selection for the next launch", async () => {
    const put = await PUT(
      jsonRequest("http://t/api/providers", "PUT", {
        provider: "custom",
        model: "openai/gpt-4o-mini",
      })
    )
    expect(put.status).toBe(200)
    const putJson = await put.json()
    expect(putJson.success).toBe(true)
    expect(putJson.data.defaults).toEqual({
      provider: "custom",
      model: "openai/gpt-4o-mini",
    })

    const get = await GET()
    const getJson = await get.json()
    expect(getJson.data.defaults).toEqual({
      provider: "custom",
      model: "openai/gpt-4o-mini",
    })
  })

  it("rejects an unknown provider id", async () => {
    const res = await PUT(
      jsonRequest("http://t/api/providers", "PUT", {
        provider: "gemini",
        model: "x",
      })
    )
    expect(res.status).toBe(400)
  })
})
