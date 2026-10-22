import { expect, test } from "@playwright/test"

import { stubVerifiedProvider, stubWorkspace } from "./support/stubs"

type Levels = Record<"artifactRouting" | "skillSuggest" | "stepGate" | "learning", string>

function settingsBody(cutoffs: Levels) {
  return {
    success: true,
    data: {
      settings: {
        assistant: { maxToolTurns: 8, autoApproveFileWrites: false },
        jev: { enabled: true, provider: "auto", openRouterKeySource: "reuse", cutoffs },
        models: {},
        browser: { updateFlowsOnHeal: false, headless: false },
      },
      jevKey: { configured: true, last4: "1234" },
      jevOpenRouterKey: { configured: false },
      aiOpenRouter: { available: false },
      openRouterAvailable: false,
      activeProvider: "direct",
    },
  }
}

const entries = [
  { at: "2026-10-21T10:02:00.000Z", kind: "stepGate", choice: "stop", score: 0.8, cutoff: 0.85, outcome: "below", provider: "direct" },
  { at: "2026-10-21T10:01:00.000Z", kind: "stepGate", choice: "continue", score: 0.92, cutoff: 0.85, outcome: "acted", provider: "direct" },
  { at: "2026-10-21T10:00:00.000Z", kind: "artifactRouting", choice: "error", score: null, cutoff: 0.85, outcome: "error", provider: "direct" },
]

test("shows Jev decisions, saves a level, and clears the list", async ({ page }) => {
  const cutoffs: Levels = { artifactRouting: "balanced", skillSuggest: "balanced", stepGate: "balanced", learning: "balanced" }
  const puts: unknown[] = []
  let log = [...entries]
  let failing = true
  await stubWorkspace(page)
  await stubVerifiedProvider(page)
  await page.route("**/api/settings/ai", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { jev?: { cutoffs?: Partial<Levels> } }
      puts.push(body)
      Object.assign(cutoffs, body.jev?.cutoffs)
    }
    await route.fulfill({ json: settingsBody(cutoffs) })
  })
  await page.route("**/api/settings/ai/jev-decisions", async (route) => {
    if (failing) {
      return route.fulfill({ status: 500, json: { success: false, error: "Could not read the decision list" } })
    }
    if (route.request().method() === "DELETE") log = []
    await route.fulfill({ json: { success: true, data: { entries: log, max: 200 } } })
  })

  await page.goto("/settings/jev")
  await expect(page.getByText("Could not read the decision list")).toBeVisible()
  failing = false
  await page.getByRole("button", { name: "Retry" }).click()

  const table = page.getByRole("table")
  await expect(table.getByRole("row")).toHaveCount(4)
  await expect(table).toContainText("Check a workflow step")
  await expect(table).toContainText("Below level")
  await expect(page.getByText("Last 2: 1 used, 1 below level, 0 no change.")).toBeVisible()
  await expect(page.getByText("3 of 200 kept. The oldest drop off first.")).toBeVisible()
  await expect(page.getByText("Fixed at 95%.", { exact: false })).toBeVisible()

  const stepGroup = page.getByRole("radiogroup", { name: "Check a workflow step" })
  await expect(stepGroup.getByRole("radio", { name: /Balanced/ })).toHaveAttribute("aria-checked", "true")
  await expect(stepGroup.getByRole("radio", { name: /Eager/ })).toContainText("Would use 2 of 2")
  await stepGroup.getByRole("radio", { name: /Eager/ }).click()
  await expect(stepGroup.getByRole("radio", { name: /Eager/ })).toHaveAttribute("aria-checked", "true")
  expect(puts).toContainEqual({ jev: { cutoffs: { stepGate: "eager" } } })
  await expect(page.getByRole("alert").filter({ hasText: "Eager is risky here" })).toBeVisible()

  const routingGroup = page.getByRole("radiogroup", { name: "Pick a file for the chat" })
  await routingGroup.getByRole("radio", { name: /Eager/ }).click()
  await expect(routingGroup.getByRole("radio", { name: /Eager/ })).toHaveAttribute("aria-checked", "true")
  await expect(page.getByRole("alert").filter({ hasText: "Eager is risky here" })).toHaveCount(1)

  await page.getByRole("button", { name: "Clear decisions" }).click()
  const dialog = page.getByRole("dialog", { name: "Clear the decision list?" })
  await expect(dialog).toContainText("Your levels stay")
  await dialog.getByRole("button", { name: "Clear list" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText("No Jev decisions yet")).toBeVisible()
  await expect(page.getByRole("button", { name: "Clear decisions" })).toBeDisabled()
})
