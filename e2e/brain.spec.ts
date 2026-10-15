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
    await expect(page.getByRole("heading", { name: "Brain", exact: true })).toBeVisible()
    await expect(page.getByText("The inbox is empty", { exact: true })).toBeVisible()
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

    await expect(page.getByText("The inbox is empty", { exact: true })).toBeVisible()
    expect(decision).toEqual({ action: "approve", edits: { content: "The repo uses pnpm 9" } })
    await page.getByRole("tab", { name: "Memory" }).click()
    await expect(page.getByText("The repo uses pnpm 9")).toBeVisible()
  })

  test("explains how it works once, then remembers it was closed", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({ json: { success: true, data: { proposals: [], workspaceNotes: [], agents: [] } } })
    )
    await page.goto("/brain")
    const intro = page.getByRole("region", { name: "How the Brain works" })
    await expect(intro).toContainText("1. You give feedback")
    await intro.getByRole("button", { name: "Got it" }).click()
    await expect(intro).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole("heading", { name: "Brain", exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "How the Brain works" })).toHaveCount(0)
    await page.getByRole("button", { name: "How it works" }).click()
    await expect(page.getByRole("region", { name: "How the Brain works" })).toBeVisible()
  })

  test("explains empty memory with examples and links the inbox to feedback", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({ json: { success: true, data: { proposals: [], workspaceNotes: [], agents: [] } } })
    )
    await page.goto("/brain")
    await expect(page.getByRole("link", { name: "Rate replies in the Assistant" })).toHaveAttribute("href", "/chat")
    await page.getByRole("tab", { name: "Memory" }).click()
    await expect(page.getByText("They are added to every chat and workflow run automatically.", { exact: false })).toBeVisible()
    await expect(page.getByText("This repo uses pnpm, not npm.")).toBeVisible()
  })

  test("says where a suggestion came from and what approve does", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            proposals: [proposal],
            workspaceNotes: [{ date: "2026-10-06", text: "Answer briefly." }],
            agents: [],
          },
        },
      })
    )
    await page.goto("/brain")
    await expect(page.getByRole("tab", { name: "Inbox (1)" })).toBeVisible()
    await expect(page.getByText("From your thumbs down in the Assistant.")).toBeVisible()
    await expect(page.getByText("Approve adds this note to the memory of the coder agent.")).toBeVisible()
    await expect(page.getByText("Only coder", { exact: true })).toBeVisible()
    await page.getByRole("tab", { name: "Memory (1)" }).click()
    await expect(page.getByText("All agents", { exact: true })).toBeVisible()
    await expect(page.getByRole("progressbar", { name: "Memory space used" })).toBeVisible()
    await expect(page.getByText("15 / 3,000 characters")).toBeVisible()
  })
})
