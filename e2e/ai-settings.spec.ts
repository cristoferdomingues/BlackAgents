import { expect, test } from "@playwright/test"

import { stubVerifiedProvider, stubWorkspace } from "./support/stubs"

function settingsBody(autoApproveFileWrites: boolean) {
  return {
    success: true,
    data: {
      settings: {
        assistant: { maxToolTurns: 8, autoApproveFileWrites },
        jev: { enabled: false, provider: "auto", openRouterKeySource: "reuse" },
        models: {},
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

test("picks a voice model from models that take audio", async ({ page }) => {
  let saved: string | null = null
  const puts: unknown[] = []
  await stubWorkspace(page)
  await stubVerifiedProvider(page)
  await page.route("**/api/settings/ai", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { models?: { voice?: string | null } }
      puts.push(body)
      if (body.models?.voice !== undefined) saved = body.models.voice
    }
    await route.fulfill({ json: settingsBody(false) })
  })
  await page.route("**/api/settings/ai/models?task=voice", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          task: "voice",
          saved,
          defaultModel: "google/gemini-2.5-flash",
          effective: saved ?? "google/gemini-2.5-flash",
          custom: { configured: true, isOpenRouter: true },
          models: [{ id: "google/gemini-2.5-flash" }, { id: "openai/gpt-4o-audio-preview" }],
          filtered: true,
        },
      },
    })
  )

  await page.goto("/settings?tab=ai")
  await expect(page.getByText("Models by task")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Voice" })).toHaveAttribute("aria-selected", "true")
  const model = page.getByRole("textbox", { name: "Model" })
  await expect(model).toHaveValue("google/gemini-2.5-flash")
  await expect(page.getByText("2 models can take audio and give text.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Save", exact: true }).last()).toBeDisabled()

  await page.getByRole("button", { name: "Choose model" }).click()
  await page.getByRole("menuitem", { name: "openai/gpt-4o-audio-preview" }).click()
  await page.getByRole("button", { name: "Save", exact: true }).last().click()
  await expect(page.getByText("Voice model saved")).toBeVisible()
  expect(puts).toContainEqual({ models: { voice: "openai/gpt-4o-audio-preview" } })

  await page.getByRole("button", { name: "Use default" }).click()
  await expect(model).toHaveValue("google/gemini-2.5-flash")
  expect(puts).toContainEqual({ models: { voice: null } })
})
