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

test("saves a vision model for a provider and lists who uses it", async ({ page }) => {
  let saved: { provider: string; model: string } | null = null
  const puts: unknown[] = []
  await stubWorkspace(page, [
    {
      name: "reviewer",
      type: "agent",
      description: "Reviews pull requests.",
      frontmatter: { model: "task:vision" },
    },
  ])
  await stubVerifiedProvider(page)
  await page.route("**/api/workflows", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          workflows: [
            {
              workflow: {
                name: "nightly-report",
                description: "",
                task: "",
                trigger: { type: "manual" },
                steps: [{ id: "summarize", agent: "reviewer", model: "task:vision" }],
                limits: { stepTimeoutMinutes: 10, runTimeoutMinutes: 60, maxRetries: 1 },
                selfAssess: false,
              },
              lastRun: null,
              active: false,
            },
          ],
        },
      },
    })
  )
  await page.route("**/api/settings/ai", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        models?: { vision?: { provider: string; model: string } | null }
      }
      puts.push(body)
      if (body.models && "vision" in body.models) saved = body.models.vision ?? null
    }
    await route.fulfill({ json: settingsBody(false) })
  })
  await page.route("**/api/settings/ai/models*", (route) => {
    const url = new URL(route.request().url())
    const task = url.searchParams.get("task")
    if (task === "voice") {
      return route.fulfill({
        json: {
          success: true,
          data: {
            task: "voice",
            saved: null,
            defaultModel: null,
            effective: null,
            custom: { configured: false, isOpenRouter: false },
            models: [],
            filtered: false,
          },
        },
      })
    }
    const provider = url.searchParams.get("provider") ?? saved?.provider ?? "openai"
    const models =
      provider === "anthropic"
        ? [{ id: "claude-sonnet-4-20250514" }]
        : [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }]
    return route.fulfill({
      json: {
        success: true,
        data: {
          task,
          provider,
          saved,
          defaultModel: null,
          effective: saved && saved.provider === provider ? saved.model : null,
          custom: { configured: true, isOpenRouter: false },
          providers: [
            { id: "openai", label: "OpenAI", verified: true },
            { id: "anthropic", label: "Anthropic", verified: true },
            { id: "custom", label: "Custom (OpenAI-compatible)", verified: false },
          ],
          models,
          filtered: false,
        },
      },
    })
  })

  await page.goto("/settings?tab=ai")
  await page.getByRole("tab", { name: "Vision" }).click()
  await expect(page.getByRole("tab", { name: "Vision" })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByText("Used by: reviewer (agent), nightly-report → summarize (step)")).toBeVisible()
  const provider = page.getByRole("combobox", { name: "Vision provider" })
  await provider.click()
  await expect(page.getByRole("option", { name: /Verify under AI Providers/ })).toBeDisabled()
  const listed = page.waitForResponse(
    (res) => res.url().includes("/api/settings/ai/models") && res.url().includes("provider=anthropic")
  )
  await page.getByRole("option", { name: "Anthropic", exact: true }).click()
  await listed
  await page.getByRole("button", { name: "Choose model" }).click()
  await page.getByRole("menuitem", { name: "claude-sonnet-4-20250514" }).click()
  await page.getByRole("tabpanel", { name: "Vision" }).getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText("Vision model saved")).toBeVisible()
  expect(puts).toContainEqual({
    models: { vision: { provider: "anthropic", model: "claude-sonnet-4-20250514" } },
  })

  await page.reload()
  await page.getByRole("tab", { name: "Vision" }).click()
  await expect(page.getByRole("textbox", { name: "Vision model" })).toHaveValue("claude-sonnet-4-20250514")
  await expect(page.getByRole("combobox", { name: "Vision provider" })).toContainText("Anthropic")

  await page.getByRole("tab", { name: "Fast" }).click()
  await expect(page.getByText("Not used yet")).toBeVisible()

  await page.getByRole("tab", { name: "Vision" }).click()
  await page.getByRole("button", { name: "Clear", exact: true }).click()
  await expect(page.getByText("Cleared the Vision model")).toBeVisible()
  expect(puts).toContainEqual({ models: { vision: null } })
})
