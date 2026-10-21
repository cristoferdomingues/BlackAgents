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
        data: {
          entries: [
            { name: "index.ts", path: "src/index.ts", kind: "file", secret: false },
            { name: "long.ts", path: "src/long.ts", kind: "file", secret: false },
          ],
        },
      },
    })
  )
  await page.route("**/api/k0ding/roots/server/file**", (route) => {
    const path = new URL(route.request().url()).searchParams.get("path")
    const content =
      path === "src/long.ts"
        ? Array.from({ length: 80 }, (_, index) => `scroll-line-${index + 1}`).join("\n")
        : file.content
    return route.fulfill({ json: { success: true, data: { ...file, path: path ?? file.path, content } } })
  })
  await page.route("**/api/k0ding/sessions**", (route) =>
    route.fulfill({ json: { success: true, data: { session: null } } })
  )
  await page.route("**/api/k0ding/roots/server/git**", (route) =>
    route.fulfill({ json: { success: true, data: { git: true, paths: ["src/index.ts"] } } })
  )
  await page.route("**/api/k0ding/roots/server/notes", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { content: route.request().method() === "PUT" ? "# Stack\nTypeScript" : "" },
      },
    })
  )
  await page.route("**/api/k0ding/roots/server/mcp", (route) =>
    route.fulfill({ json: { success: true, data: { detected: false, packageManager: "npm", scripts: [], existingServer: false } } })
  )

  await page.goto("/k0ding")
  await page.getByLabel("Path to a code folder").fill("/tmp/server")
  await page.getByRole("button", { name: "Open" }).click()
  await page.getByRole("button", { name: "index.ts", exact: true }).click()
  await expect(page.getByText("export const hi = 1")).toBeVisible()
  await page.getByRole("button", { name: "long.ts", exact: true }).click()
  const scroller = page.locator(".cm-scroller")
  await expect.poll(async () => scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 20)).toBe(true)
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(page.getByText("scroll-line-80")).toBeVisible()
  await page.getByRole("button", { name: "Close long.ts" }).click()
  await expect(page.getByRole("button", { name: "Close long.ts" })).toHaveCount(0)
  await expect(page.getByText("export const hi = 1")).toBeVisible()
  await page.getByRole("button", { name: "Close index.ts" }).click()
  await expect(page.getByText("Open a file from the tree")).toBeVisible()
  await page.getByRole("button", { name: "index.ts", exact: true }).click()
  await page.getByRole("button", { name: "Project tools" }).click()
  await page.getByLabel("Project notes").fill("# Stack\nTypeScript")
  await page.getByRole("button", { name: "Save notes" }).click()
  await expect(page.getByText("Project notes saved")).toBeVisible()
})
