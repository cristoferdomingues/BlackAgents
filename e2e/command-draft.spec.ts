import { expect, test } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

// Long command bodies often come back with raw line breaks and nested code
// fences inside the JSON string; the chat must still open them.
const LOOSE_COMMAND_DRAFT = [
  "Here is the command.",
  "",
  "```artifact",
  "{",
  '  "type": "command",',
  '  "name": "integrate-okf",',
  '  "description": "Import an OKF bundle into the workspace.",',
  '  "body": "## Steps',
  "1. Run:",
  "```bash",
  "npm run okf:import",
  "```",
  '2. Check the result."',
  "}",
  "```",
].join("\n")

async function sendAndReply(page: import("@playwright/test").Page, content: string): Promise<void> {
  await page.route("**/api/chat", (route) =>
    fulfillSse(route, [["done", { content, model: "gpt-4o-mini" }]])
  )
  await page.goto("/chat")
  await page.getByRole("textbox", { name: "Message assistant" }).fill("Create a command")
  await page.getByRole("button", { name: "Send" }).click()
}

test.describe("command drafts in chat", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
    await stubVerifiedProvider(page)
  })

  test("opens a loosely formatted command draft in the editor", async ({ page }) => {
    await sendAndReply(page, LOOSE_COMMAND_DRAFT)
    await expect(page.getByText("Here is the command.")).toBeVisible()
    await expect(page.getByText("integrate-okf")).toBeVisible()
    await page.getByRole("button", { name: "Open in editor" }).click()
    await expect(page).toHaveURL(/\/commands\/new/)
    await expect(page.getByLabel("Name")).toHaveValue("integrate-okf")
  })

  test("explains a broken draft and asks the assistant to fix it", async ({ page }) => {
    const sent: unknown[] = []
    await sendAndReply(page, 'Here it is.\n\n```artifact\n{"type":"command","name":"Bad Name","description":"x","body":"y"}\n```')
    const alert = page.getByRole("alert").filter({ hasText: "could not be opened" })
    await expect(alert).toContainText("The command draft could not be opened")
    await expect(alert).toContainText('problem in "name"')
    const reply = await page.getByText("Here it is.").locator("xpath=..").boundingBox()
    expect(reply?.height ?? 0).toBeLessThan(120)

    await page.unroute("**/api/chat")
    await page.route("**/api/chat", async (route) => {
      sent.push(route.request().postDataJSON())
      await fulfillSse(route, [["done", { content: "Fixed.", model: "gpt-4o-mini" }]])
    })
    await alert.getByRole("button", { name: "Ask to fix" }).click()
    await expect(page.getByText("Fixed.")).toBeVisible()
    expect(JSON.stringify(sent[0])).toContain("Your command draft could not be read.")
  })
})
