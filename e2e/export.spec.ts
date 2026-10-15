import { expect, test } from "@playwright/test"

import { stubWorkspace } from "./support/stubs"

test.describe("export", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
  })

  test("previews an OKF bundle from the export screen", async ({ page }) => {
    await page.route("**/api/export", async (route) => {
      const body = route.request().postDataJSON() as { platform?: string } | null
      const okf = body?.platform === "okf"
      await route.fulfill({
        json: {
          success: true,
          data: {
            platform: body?.platform ?? "claude",
            mode: "dry-run",
            overwrite: true,
            summary: {
              total: okf ? 2 : 0,
              create: okf ? 2 : 0,
              overwrite: 0,
              unchanged: 0,
              written: 0,
            },
            files: okf
              ? [
                  { path: "okf/index.md", status: "create", applied: false },
                  { path: "okf/log.md", status: "create", applied: false },
                ]
              : [],
          },
        },
      })
    })

    await page.goto("/export")
    await expect(page.getByRole("heading", { name: "Export" })).toBeVisible()
    await page.getByRole("combobox").click()
    await page.getByRole("option", { name: "OKF Bundle" }).click()
    await expect(page.getByText("knowledge concepts from the Brain")).toBeVisible()
    await expect(page.getByText("okf/index.md")).toBeVisible()
    await expect(page.getByText("Nothing is changed until you export.")).toBeVisible()
  })
})
