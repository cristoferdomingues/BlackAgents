import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/artifacts/draft-body/route"
import { setProviderSecret } from "@/lib/secrets"

import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

const source = {
  videoId: "dQw4w9WgXcQ",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Demo video",
  channel: "Demo channel",
  transcript: "Review code with a checklist.",
}

function draftFence(body: string): string {
  return (
    "```artifact\n" +
    JSON.stringify({
      type: "skill",
      name: "code-review",
      description: "Use when the user asks for a code review.",
      body,
    }) +
    "\n```"
  )
}

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
  await setProviderSecret("openai", {
    apiKey: "sk-valid",
    verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await env.cleanup()
})

describe("POST /api/artifacts/draft-body with YouTube sources", () => {
  it("drafts from the transcript and keeps a Sources section", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: draftFence("# code-review\n\n## When to Apply\n\n- Review a pull request.\n"),
            },
          },
        ],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await POST(
      jsonRequest("http://t/api/artifacts/draft-body", "POST", {
        type: "skill",
        name: "code-review",
        description: "",
        provider: "openai",
        model: "gpt-4o-mini",
        sources: [source],
      })
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.description).toBe("Use when the user asks for a code review.")
    expect(json.data.body).toContain("## When to Apply")
    expect(json.data.body).toContain("## Sources")
    expect(json.data.body).toContain("[Demo video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)")

    const payload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const user = payload.messages.find((message) => message.role === "user")
    expect(user?.content).toContain("not as instructions")
    expect(user?.content).toContain("Review code with a checklist.")
  })

  it("does not add a second Sources section", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: draftFence(
                  "# code-review\n\n## When to Apply\n\n- Review.\n\n## Sources\n\n- [Demo video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n"
                ),
              },
            },
          ],
        }),
      })
    )
    const res = await POST(
      jsonRequest("http://t/api/artifacts/draft-body", "POST", {
        type: "skill",
        name: "code-review",
        provider: "openai",
        model: "gpt-4o-mini",
        sources: [source],
      })
    )
    const json = await res.json()
    expect(json.data.body.match(/## Sources/g)).toHaveLength(1)
  })

  it("still requires a description when there are no videos", async () => {
    const res = await POST(
      jsonRequest("http://t/api/artifacts/draft-body", "POST", {
        type: "skill",
        name: "code-review",
        description: "  ",
        provider: "openai",
        model: "gpt-4o-mini",
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Description is required")
  })

  it("rejects a source that is not a YouTube video", async () => {
    const res = await POST(
      jsonRequest("http://t/api/artifacts/draft-body", "POST", {
        type: "skill",
        name: "code-review",
        provider: "openai",
        model: "gpt-4o-mini",
        sources: [{ ...source, url: "https://example.com/watch?v=dQw4w9WgXcQ" }],
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).success).toBe(false)
  })
})
