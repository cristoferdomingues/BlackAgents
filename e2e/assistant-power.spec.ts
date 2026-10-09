import { expect, test } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

declare global {
  interface Window {
    __chatStream?: ReadableStreamDefaultController<Uint8Array>
  }
}

const SKILL_BODY = "# Release notes\n\n## When to Apply\n\nWhen preparing a release.\n\n## Steps\n\n1. List merged PRs.\n"

test.describe("assistant tools and bundles", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page, [{ name: "style", type: "rule", description: "House style." }])
    await stubVerifiedProvider(page)
  })

  test("streams tool calls, loaded context and the limit note", async ({ page }) => {
    let body: unknown
    await page.route("**/api/chat", async (route) => {
      body = route.request().postDataJSON()
      await fulfillSse(route, [
        ["context", { artifacts: [{ type: "rule", name: "style", source: "mention" }], jev: "off", tools: 2 }],
        ["tool_result", { type: "tool_result", trace: { id: "t1", server: "builtin", tool: "fs_list", args: { path: "." }, result: { entries: [] } } }],
        [
          "done",
          {
            content: "I looked at the workspace.",
            model: "gpt-4o-mini",
            toolExecutions: [{ id: "t1", server: "builtin", tool: "fs_list", args: { path: "." }, result: { entries: [] } }],
            stoppedAtLimit: true,
          },
        ],
      ])
    })

    await page.goto("/chat")
    const allowWrites = page.getByLabel("Auto-approve file writes")
    await allowWrites.hover()
    await expect(page.getByRole("tooltip")).toContainText("A new chat asks again")
    await allowWrites.click()
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Check @rule:style")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(page.getByText("I looked at the workspace.")).toBeVisible()
    await expect(page.getByText("rule/style")).toBeVisible()
    await expect(page.getByText("Stopped at the tool-call limit", { exact: false })).toBeVisible()
    expect(body).toMatchObject({ allowFileWrites: true, messages: [{ role: "user", content: "Check @rule:style" }] })
  })

  test("inserts an artifact when @ is picked", async ({ page }) => {
    await page.goto("/chat")
    const input = page.getByRole("textbox", { name: "Message assistant" })
    await expect(input).toBeEnabled()
    await input.pressSequentially("@sty")
    await expect(page.getByRole("option", { name: /style/ })).toBeVisible()
    await input.press("Enter")
    await expect(input).toHaveValue("@rule:style ")
  })

  test("shows a stream error and keeps the message", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [["error", { message: "Upstream failed", status: 502 }]])
    )
    await page.goto("/chat")
    const input = page.getByRole("textbox", { name: "Message assistant" })
    await input.fill("Hello")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("Upstream failed")).toBeVisible()
    await expect(input).toHaveValue("Hello")
  })

  test("creates every artifact of a drafted bundle", async ({ page }) => {
    const bundle = { summary: "Release kit", skills: [{ name: "release-notes", description: "Write release notes.", body: SKILL_BODY }] }
    const reply = `Here is your kit.\n\n\`\`\`bundle\n${JSON.stringify(bundle)}\n\`\`\``
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [["done", { content: reply, model: "gpt-4o-mini", toolExecutions: [] }]])
    )
    const created: unknown[] = []
    await page.route("**/api/artifacts", async (route) => {
      if (route.request().method() === "POST") {
        created.push(route.request().postDataJSON())
        await route.fulfill({ status: 201, json: { success: true, data: { name: "release-notes" } } })
        return
      }
      await route.fallback()
    })

    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Make a release kit")
    await page.getByRole("button", { name: "Send" }).click()

    const card = page.getByLabel("Artifact bundle")
    await expect(card).toBeVisible()
    await card.getByRole("button", { name: "Create all" }).click()
    await expect(card.getByRole("button", { name: "All created" })).toBeVisible()
    expect(created).toEqual([expect.objectContaining({ type: "skill", name: "release-notes" })])
  })

  test("asks the assistant to repair an invalid artifact bundle", async ({ page }) => {
    const invalid = {
      summary: "Release kit",
      skills: [
        {
          name: "release-notes",
          description: "Write release notes.",
          body: "No required section.",
        },
      ],
    }
    const fixed = {
      ...invalid,
      skills: [{ ...invalid.skills[0], body: SKILL_BODY }],
    }
    const requests: Array<{ messages?: Array<{ content?: string }> }> = []
    await page.route("**/api/chat", async (route) => {
      requests.push(route.request().postDataJSON())
      const bundle = requests.length === 1 ? invalid : fixed
      const content = `Here is the bundle.\n\n\`\`\`bundle\n${JSON.stringify(bundle)}\n\`\`\``
      await fulfillSse(route, [
        ["done", { content, model: "gpt-4o-mini", toolExecutions: [] }],
      ])
    })

    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Make a release kit")
    await page.getByRole("button", { name: "Send" }).click()

    const invalidCard = page.getByLabel("Artifact bundle").first()
    await invalidCard.getByRole("button", { name: "Fix issues" }).click()

    await expect(page.getByLabel("Artifact bundle")).toHaveCount(2)
    await expect(page.getByLabel("Artifact bundle").last().getByText("Valid")).toBeVisible()
    const fixRequest = requests[1]?.messages?.at(-1)?.content
    expect(fixRequest).toContain('Missing "## When to Apply" section')
    expect(fixRequest).toContain("```bundle")
    expect(fixRequest).toContain('"name": "release-notes"')
  })

  test("sends thumbs-down feedback with a comment to the brain", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [["done", { content: "Use npm.", model: "gpt-4o-mini", toolExecutions: [] }]])
    )
    let feedback: unknown
    await page.route("**/api/brain/feedback", async (route) => {
      feedback = route.request().postDataJSON()
      await route.fulfill({ json: { success: true, data: { kind: "proposed", proposalId: "p1" } } })
    })

    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("How to install?")
    await page.getByRole("button", { name: "Send" }).click()
    await page.getByRole("button", { name: "Bad answer" }).click()
    await page.getByLabel("Feedback comment").fill("We use pnpm")
    await page.getByRole("button", { name: "Send feedback" }).click()

    await expect(page.getByText("Feedback saved.")).toBeVisible()
    expect(feedback).toMatchObject({ source: "chat", rating: "down", comment: "We use pnpm", reply: "Use npm." })
  })

  test("asks before a file write and can allow the rest of the chat", async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (url.includes("/api/chat") && (init?.method ?? "GET") === "POST") {
          const encoder = new TextEncoder()
          const stream = new ReadableStream({
            start(controller) {
              window.__chatStream = controller
              const approval = {
                id: "write-1",
                tool: "fs_write",
                server: "builtin",
                risk: "write",
                summary: "Write hello.txt (5 chars)",
                args: { path: "hello.txt", content: "hello" },
                scope: { kind: "chat" },
                createdAt: "2026-10-09T20:00:00.000Z",
              }
              controller.enqueue(
                encoder.encode(`event: approval_required\ndata: ${JSON.stringify({ approval })}\n\n`)
              )
            },
          })
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          })
        }
        return original(input, init)
      }
    })

    let decision: unknown
    await page.route("**/api/approvals/write-1", async (route) => {
      decision = route.request().postDataJSON()
      await route.fulfill({
        json: {
          success: true,
          data: { id: "write-1", approved: true, remember: false, fileWritePermission: "session" },
        },
      })
    })

    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Create hello.txt")
    await page.getByRole("button", { name: "Send" }).click()

    const card = page.getByRole("alert", { name: "Approval needed for fs_write" })
    await expect(card.getByRole("button", { name: "Allow for this message" })).toBeVisible()
    await expect(card.getByRole("button", { name: "Allow for this session" })).toBeVisible()
    await expect(card.getByRole("button", { name: "Deny" })).toBeVisible()
    await card.getByRole("button", { name: "Allow for this session" }).click()

    await expect.poll(() => decision).toMatchObject({ approved: true, fileWritePermission: "session" })
    await expect(page.getByRole("switch", { name: "Auto-approve file writes" })).toBeChecked()

    await page.evaluate(() => {
      const encoder = new TextEncoder()
      const controller = window.__chatStream
      controller?.enqueue(
        encoder.encode(
          'event: done\ndata: {"content":"Wrote hello.txt.","model":"gpt-4o-mini","toolExecutions":[]}\n\n'
        )
      )
      controller?.close()
    })
    await expect(page.getByText("Wrote hello.txt.")).toBeVisible()
  })
})
