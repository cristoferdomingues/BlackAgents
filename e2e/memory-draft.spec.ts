import { expect, test } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const DRAFT = {
  title: "How to address the user",
  content: "Call the user Mr. Bombastic.",
}

test.describe("memory drafts in chat", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
    await stubVerifiedProvider(page)
  })

  test("sends a memory note to the Brain Inbox", async ({ page }) => {
    const reply = `I can remember that.\n\n\`\`\`memory\n${JSON.stringify(DRAFT)}\n\`\`\``
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [["done", { content: reply, model: "gpt-4o-mini" }]])
    )
    let proposed: unknown
    await page.route("**/api/brain/memory", async (route) => {
      proposed = route.request().postDataJSON()
      await route.fulfill({
        status: 201,
        json: {
          success: true,
          data: { proposalId: "p1", title: DRAFT.title, agent: null },
        },
      })
    })

    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("From now on, call me Mr. Bombastic")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(page.getByText("I can remember that.")).toBeVisible()
    const card = page.getByTestId("memory-draft-card")
    await expect(card).toContainText("How to address the user")
    await expect(card).toContainText("Call the user Mr. Bombastic.")
    await expect(card).toContainText("All agents")
    await card.getByRole("button", { name: "Send to Inbox" }).click()
    await expect(card.getByText("In the Inbox. Nothing is saved yet.")).toBeVisible()
    await expect(card.getByRole("link", { name: "Review in Brain" })).toHaveAttribute("href", "/brain")
    expect(proposed).toEqual(DRAFT)
  })
})
