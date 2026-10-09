import { expect, test } from "@playwright/test"

import { stubVerifiedProvider, stubWorkspace } from "./support/stubs"

function settingsBody(autoApproveFileWrites: boolean) {
  return {
    success: true,
    data: {
      settings: {
        assistant: { maxToolTurns: 8, autoApproveFileWrites },
        jev: { enabled: false, provider: "auto", openRouterKeySource: "reuse" },
      },
      jevKey: { configured: false },
      jevOpenRouterKey: { configured: false },
      aiOpenRouter: { available: false },
      openRouterAvailable: false,
      activeProvider: null,
    },
  }
}

test("warns before file writes can run without asking", async ({ page }) => {
  let autoApproveFileWrites = false
  await stubWorkspace(page)
  await stubVerifiedProvider(page)
  await page.route("**/api/settings/ai", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        assistant?: { autoApproveFileWrites?: boolean }
      }
      autoApproveFileWrites = Boolean(body.assistant?.autoApproveFileWrites)
    }
    await route.fulfill({ json: settingsBody(autoApproveFileWrites) })
  })

  await page.goto("/settings?tab=ai")
  const toggle = page.getByLabel("Allow file writes without asking")
  await expect(toggle).not.toBeChecked()
  await toggle.click()

  const dialog = page.getByRole("dialog", { name: "Allow file writes without asking?" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("overwrite a file")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()
  await expect(toggle).not.toBeChecked()
  expect(autoApproveFileWrites).toBe(false)

  await toggle.click()
  await dialog.getByRole("button", { name: "Allow writes" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "File writes run with no approval" })).toBeVisible()
  await expect(toggle).toBeChecked()
  expect(autoApproveFileWrites).toBe(true)

  await page.goto("/chat")
  const chatToggle = page.getByRole("switch", { name: "Auto-approve file writes" })
  await expect(chatToggle).toBeChecked()
  await expect(chatToggle).toBeDisabled()
})
