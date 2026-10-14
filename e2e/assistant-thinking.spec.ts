import { expect, test } from "@playwright/test"

import { sse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const started: Array<[string, unknown]> = [
  ["context", { artifacts: [], tools: 1 }],
  ["thinking", { type: "thinking", turn: 0, content: "The user wants a rule. I should check the existing rules first." }],
  ["token", { type: "token", turn: 0, content: "Let me look at your rules." }],
  [
    "tool_call",
    { type: "tool_call", id: "c1", tool: "fs_read", server: "builtin", args: { path: ".cursor/rules/commits.mdc" }, risk: "read" },
  ],
]

const finished: Array<[string, unknown]> = [
  [
    "tool_result",
    { type: "tool_result", trace: { id: "c1", tool: "fs_read", server: "builtin", args: {}, result: "ok", durationMs: 8 } },
  ],
  ["done", { content: "Here is your rule.", model: "gpt-4o-mini", toolExecutions: [] }],
]

test.describe("assistant thinking", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
    await stubVerifiedProvider(page)
    // A stream that stays open until the test calls window.__finishChat().
    await page.addInitScript(
      ({ start, end }) => {
        const original = window.fetch.bind(window)
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
          if (!url.endsWith("/api/chat")) return original(input, init)
          const encoder = new TextEncoder()
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(start))
              ;(window as unknown as { __finishChat: () => void }).__finishChat = () => {
                controller.enqueue(encoder.encode(end))
                controller.close()
              }
            },
          })
          return Promise.resolve(
            new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
          )
        }
      },
      { start: sse(started), end: sse(finished) }
    )
  })

  test("shows the reasoning and tool steps while thinking, then the reply", async ({ page }) => {
    await page.goto("/chat")
    await page.getByRole("textbox", { name: /message/i }).fill("Create a commit rule")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(page.getByText("Assistant is thinking…")).toBeVisible()
    const steps = page.getByRole("list", { name: "Thinking steps" })
    await expect(steps.getByText("I should check the existing rules first", { exact: false })).toBeVisible()
    await expect(steps.getByText("Let me look at your rules.")).toBeVisible()
    await expect(steps.getByText(".cursor/rules/commits.mdc")).toBeVisible()
    await expect(page.getByText("Using fs_read")).toBeVisible()
    await page.screenshot({ path: "test-results/assistant-thinking.png" })

    await page.getByRole("button", { name: /is thinking/ }).click()
    await expect(steps).toHaveCount(0)

    await page.evaluate(() => (window as unknown as { __finishChat: () => void }).__finishChat())
    await expect(page.getByText("Here is your rule.")).toBeVisible()
    await expect(page.getByText("Assistant is thinking…")).toHaveCount(0)
  })
})
