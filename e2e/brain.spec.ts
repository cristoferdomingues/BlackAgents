import { expect, test } from "@playwright/test"

import { stubWorkspace } from "./support/stubs"

const proposal = {
  id: "p1",
  kind: "memory_note",
  agent: "coder",
  title: "Use pnpm",
  rationale: "The user corrected npm to pnpm.",
  content: "The repo uses pnpm",
  source: { kind: "chat", signal: "feedback", rating: "down", comment: "We use pnpm" },
  decision: { by: "feedback" },
  status: "pending",
  createdAt: "2026-10-07T10:00:00.000Z",
}

test.describe("brain", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
  })

  test("shows the empty inbox", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({ json: { success: true, data: { proposals: [], workspaceNotes: [], agents: [] } } })
    )
    await page.goto("/brain")
    await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible()
    await expect(page.getByText("The inbox is empty.", { exact: false })).toBeVisible()
  })

  test("shows a load error", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({ status: 500, json: { success: false, error: "Brain unavailable" } })
    )
    await page.goto("/brain")
    await expect(page.getByText("Brain unavailable")).toBeVisible()
  })

  test("approves an edited proposal and shows the memory", async ({ page }) => {
    let approved = false
    await page.route("**/api/brain", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: approved
            ? {
                proposals: [{ ...proposal, status: "approved", content: "The repo uses pnpm 9" }],
                workspaceNotes: [],
                agents: [{ name: "coder", notes: [{ date: "2026-10-07", text: "The repo uses pnpm 9" }] }],
              }
            : { proposals: [proposal], workspaceNotes: [], agents: [] },
        },
      })
    )
    let decision: unknown
    await page.route("**/api/brain/proposals/p1", async (route) => {
      decision = route.request().postDataJSON()
      approved = true
      await route.fulfill({ json: { success: true, data: { proposal: { ...proposal, status: "approved" } } } })
    })

    await page.goto("/brain")
    await expect(page.getByText("Use pnpm", { exact: true })).toBeVisible()
    await page.getByLabel("Note").fill("The repo uses pnpm 9")
    await page.getByRole("button", { name: "Approve" }).click()

    await expect(page.getByText("The inbox is empty.", { exact: false })).toBeVisible()
    expect(decision).toEqual({ action: "approve", edits: { content: "The repo uses pnpm 9" } })
    await page.getByRole("tab", { name: "Memory" }).click()
    await expect(page.getByText("The repo uses pnpm 9")).toBeVisible()
  })
})
