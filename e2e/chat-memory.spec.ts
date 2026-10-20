import { expect, test } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const memory = {
  summary: "The user set up a CCA-F quiz with the study-coach agent.",
  facts: ["The quiz agent is study-coach", "Exam code: CCA-F"],
  covered: 22,
}

test("a long chat shows its memory, sends it back, and can propose a fact to Brain", async ({ page }) => {
  await stubWorkspace(page)
  await stubVerifiedProvider(page)
  const bodies: Array<{ memory?: unknown }> = []
  await page.route(/\/api\/chat(\?.*)?$/, async (route) => {
    bodies.push(route.request().postDataJSON() as { memory?: unknown })
    const first = bodies.length === 1
    await fulfillSse(route, [
      ...(first ? ([["memory_folding", {}]] as Array<[string, unknown]>) : []),
      ["done", { content: first ? "Next question." : "Second answer.", model: "gpt-4o-mini", ...(first ? { memory } : {}) }],
    ])
  })
  let proposed: unknown
  await page.route("**/api/brain/memory", async (route) => {
    proposed = route.request().postDataJSON()
    await route.fulfill({ json: { success: true, data: { proposalId: "p1", title: "x", agent: null } } })
  })

  await page.goto("/chat")
  const box = page.getByRole("textbox", { name: "Message assistant" })
  await box.fill("Quiz me")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Next question.")).toBeVisible()

  const notice = page.getByTestId("memory-notice")
  await expect(notice).toContainText("The first 22 messages are summarized")
  await expect(notice).toContainText("2 case facts")

  await notice.getByRole("button", { name: "View memory" }).click()
  const dialog = page.getByRole("dialog", { name: "Chat memory" })
  await expect(dialog.getByText("The quiz agent is study-coach")).toBeVisible()
  await expect(dialog.getByText(memory.summary)).toBeVisible()
  await dialog.getByRole("button", { name: "Send to Memory: Exam code: CCA-F" }).click()
  await expect(dialog.getByText("In the Inbox")).toBeVisible()
  expect(proposed).toEqual({ title: "Exam code: CCA-F", content: "Exam code: CCA-F" })
  await page.keyboard.press("Escape")

  await box.fill("And the next one?")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Second answer.")).toBeVisible()
  expect(bodies[0]?.memory).toBeUndefined()
  expect(bodies[1]?.memory).toEqual(memory)

  await page.reload()
  await expect(page.getByTestId("memory-notice")).toContainText("The first 22 messages are summarized")
})
