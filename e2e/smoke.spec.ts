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
})
