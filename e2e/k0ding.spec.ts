import { expect, test } from "@playwright/test"

import { stubWorkspace } from "./support/stubs"

const root = { id: "server", path: "/tmp/server", label: "server", hidden: [] }

const file = {
  path: "src/index.ts",
  content: "export const hi = 1\n",
  hash: "abc",
  bytes: 20,
  binary: false,
  secret: false,
  truncated: false,
}

test("opens a code folder and reads a file", async ({ page }) => {
  await stubWorkspace(page)
  await page.route("**/api/k0ding/roots", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ json: { success: true, data: root } })
    }
    return route.fulfill({ json: { success: true, data: { roots: [] } } })
  })
  await page.route("**/api/k0ding/roots/server/tree**", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { entries: [{ name: "index.ts", path: "src/index.ts", kind: "file", secret: false }] },
      },
    })
  )
  await page.route("**/api/k0ding/roots/server/file**", (route) =>
    route.fulfill({ json: { success: true, data: file } })
  )
  await page.route("**/api/k0ding/sessions**", (route) =>
    route.fulfill({ json: { success: true, data: { session: null } } })
  )

  await page.goto("/k0ding")
  await page.getByLabel("Path to a code folder").fill("/tmp/server")
  await page.getByRole("button", { name: "Open" }).click()
  await page.getByRole("button", { name: "index.ts" }).click()
  await expect(page.getByText("export const hi = 1")).toBeVisible()
})
