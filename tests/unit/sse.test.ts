import { describe, expect, it } from "vitest"

import { encodeSse, sseResponse } from "@/lib/sse"
import { parseSseFrames } from "@/lib/sse-client"

describe("SSE helpers", () => {
  it("round-trips events and keeps partial frames", () => {
    const text = encodeSse("token", { a: 1 }) + encodeSse("done", "x") + "event: half\ndata: {"
    const { events, rest } = parseSseFrames(text)
    expect(events).toEqual([
      { event: "token", data: { a: 1 } },
      { event: "done", data: "x" },
    ])
    expect(rest).toBe("event: half\ndata: {")
  })

  it("streams sent events and turns errors into an error event", async () => {
    const res = sseResponse(async (send) => {
      send("token", { content: "hi" })
      throw new Error("boom")
    })
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const { events } = parseSseFrames(await res.text())
    expect(events).toEqual([
      { event: "token", data: { content: "hi" } },
      { event: "error", data: { message: "boom", status: 500 } },
    ])
  })
})
