import { expect, test } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const DRAFT = {
  id: "architecture/agent-loop",
  type: "Design Decision",
  title: "Agent loop",
  description: "How the bounded loop works.",
  body: "The loop stops after a fixed number of turns.",
  tags: ["runtime"],
}

test.describe("knowledge drafts in chat", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
    await stubVerifiedProvider(page)
  })

  test("sends a valid knowledge draft to the Brain Inbox", async ({ page }) => {
    const reply = `I prepared a knowledge note.\n\n\`\`\`knowledge\n${JSON.stringify(DRAFT)}\n\`\`\``
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [["done", { content: reply, model: "gpt-4o-mini" }]])
    )
    await page.route("**/api/knowledge", (route) =>
      route.fulfill({ json: { success: true, data: { concepts: [] } } })
    )
    let proposed: unknown
    await page.route("**/api/knowledge/propose", async (route) => {
      proposed = route.request().postDataJSON()
      await route.fulfill({
        status: 201,
        json: {
          success: true,
          data: { proposalId: "p1", title: "Agent loop", kind: "new_concept" },
        },
      })
    })

    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Save this as knowledge")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(page.getByText("I prepared a knowledge note.")).toBeVisible()
    const card = page.getByTestId("knowledge-draft-card")
    await expect(card).toContainText("Agent loop")
    await expect(card).toContainText("New")
    await card.getByRole("button", { name: "Send to Inbox" }).click()
    await expect(card.getByText("In the Inbox. Nothing is saved yet.")).toBeVisible()
    await expect(card.getByRole("link", { name: "Review in Brain" })).toHaveAttribute("href", "/brain")
    expect(proposed).toEqual(DRAFT)
  })
})
