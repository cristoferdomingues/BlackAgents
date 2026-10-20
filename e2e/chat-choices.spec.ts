import { expect, test } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const QUIZ = `The loop never continues.

Which step of the agent loop is missing?

- **A)** Inspecting \`stop_reason\` before deciding what to do next
- **B)** Appending the tool result to the conversation history
- **C)** Forcing the tool choice via \`tool_choice\`
- **D)** Retrying the call with exponential backoff`

const MULTI = `Which colors do you like?

\`\`\`choices
{ "question": "Colors", "multiple": true, "options": ["Red", "Green", "Blue"] }
\`\`\``

function lastUserMessage(body: unknown): string {
  const messages = (body as { messages?: Array<{ role: string; content: string }> }).messages ?? []
  return [...messages].reverse().find((m) => m.role === "user")?.content ?? ""
}

test.describe("clickable choices in chat", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
    await stubVerifiedProvider(page)
  })

  test("picks one lettered option and sends it as the answer", async ({ page }) => {
    const replies = [QUIZ, "Correct: the tool result must be appended."]
    const sent: string[] = []
    await page.route("**/api/chat", async (route) => {
      sent.push(lastUserMessage(route.request().postDataJSON()))
      const content = replies[sent.length - 1] ?? "ok"
      await fulfillSse(route, [["done", { content, model: "gpt-4o-mini" }]])
    })

    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Quiz me")
    await page.getByRole("button", { name: "Send" }).click()

    const card = page.getByTestId("choice-card")
    await expect(card.getByRole("radio")).toHaveCount(5)
    await expect(page.getByText("Which step of the agent loop is missing?")).toBeVisible()
    const send = card.getByRole("button", { name: "Send answer" })
    await expect(send).toBeDisabled()

    await card.getByRole("radio", { name: /Inspecting/ }).click()
    await card.getByRole("radio", { name: /Appending the tool result/ }).click()
    await expect(card.getByRole("radio", { name: /Inspecting/ })).toHaveAttribute("aria-checked", "false")
    await send.click()

    await expect(page.getByText("Correct: the tool result must be appended.")).toBeVisible()
    expect(sent[1]).toBe("B) Appending the tool result to the conversation history")
    await expect(card.getByRole("button", { name: "Send answer" })).toBeDisabled()
    await expect(card.getByRole("radio").first()).toBeDisabled()
  })

  test("picks several options plus a written Other answer", async ({ page }) => {
    const sent: string[] = []
    await page.route("**/api/chat", async (route) => {
      sent.push(lastUserMessage(route.request().postDataJSON()))
      const content = sent.length === 1 ? MULTI : "Nice picks."
      await fulfillSse(route, [["done", { content, model: "gpt-4o-mini" }]])
    })

    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Ask me about colors")
    await page.getByRole("button", { name: "Send" }).click()

    const card = page.getByTestId("choice-card")
    await expect(card).toContainText("Pick one or more")
    await expect(page.getByText("```choices")).toHaveCount(0)
    await card.getByRole("checkbox", { name: /Red/ }).click()
    await card.getByRole("checkbox", { name: /Blue/ }).click()
    await card.getByRole("checkbox", { name: /Other/ }).click()
    const other = card.getByRole("textbox", { name: "Your own answer" })
    await expect(other).toBeFocused()
    await other.fill("Teal")
    await other.press("Enter")

    await expect(page.getByText("Nice picks.")).toBeVisible()
    expect(sent[1]).toBe("A) Red\nC) Blue\nOther: Teal")
  })
})
