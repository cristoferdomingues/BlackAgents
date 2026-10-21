import { expect, test } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const PRICE = { inputPerMTok: 3, outputPerMTok: 15, source: "list" }

test("shows what this chat used and keeps it with the chat", async ({ page }) => {
  await stubWorkspace(page)
  await stubVerifiedProvider(page)
  let reply = 0
  await page.route("**/api/chat", async (route) => {
    reply += 1
    await fulfillSse(route, [
      ["context", { artifacts: [], jev: "off", tools: 0, price: reply === 1 ? PRICE : null }],
      ["llm_response", { type: "llm_response", turn: 1, durationMs: 5, toolCallCount: 0, usage: { inputTokens: 200_000, outputTokens: 10_000 } }],
      ["done", { content: `Answer ${reply}.`, model: "gpt-4o-mini" }],
    ])
  })

  await page.goto("/chat")
  const usage = page.getByLabel(/^This chat used/)
  await expect(usage).toHaveCount(0)
  const input = page.getByRole("textbox", { name: "Message assistant" })

  await input.fill("First question")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Answer 1.")).toBeVisible()
  await expect(usage).toHaveText("210k tokens · ~$0.75")

  await usage.focus()
  await expect(page.getByRole("tooltip")).toContainText("estimate from public list prices")
  await expect(page.getByRole("tooltip")).toContainText("Not counted: Jev")

  await input.fill("Second question")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Answer 2.")).toBeVisible()
  await expect(usage).toHaveText("420k tokens · at least $0.75")

  await page.reload()
  await expect(page.getByText("Answer 2.")).toBeVisible()
  await expect(usage).toHaveText("420k tokens · at least $0.75")

  await page.getByRole("button", { name: "New chat" }).click()
  await expect(usage).toHaveCount(0)
})
