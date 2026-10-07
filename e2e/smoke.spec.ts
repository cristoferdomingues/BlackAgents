import { test, expect } from "@playwright/test"

/**
 * Smoke coverage that the app boots and the shell renders. Runs against the
 * isolated dev server configured in playwright.config.ts.
 *
 * Deeper flows (create → edit → save an artifact, graph render, export) can be
 * layered on top; they require seeding an isolated workspace first.
 */
test.describe("app shell", () => {
  test("loads the dashboard with the artifact navigation", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveTitle(/BlackAgents/)
    await expect(page.getByRole("link", { name: /Agents/ })).toBeVisible()
    await expect(page.getByRole("link", { name: /Rules/ })).toBeVisible()
    await expect(page.getByRole("link", { name: /Skills/ })).toBeVisible()
  })

  test("navigates to the standards page", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("link", { name: /Standards/ }).click()
    await expect(page).toHaveURL(/\/standards/)
  })

  test("hides and shows the sidebar from the header", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/")
    const dashboard = page.getByRole("link", { name: "Dashboard" })
    await expect(dashboard).toBeVisible()

    await page.getByRole("button", { name: "Hide sidebar" }).click()
    await expect(dashboard).toBeHidden()

    await page.getByRole("button", { name: "Show sidebar" }).click()
    await expect(dashboard).toBeVisible()
  })
})
