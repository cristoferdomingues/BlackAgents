import { expect, test } from "@playwright/test"

import { stubWorkspace, WORKSPACE } from "./support/stubs"

test("creates and opens workspaces from the header switcher", async ({ page }) => {
  const posts: unknown[] = []
  await stubWorkspace(page)
  await page.route("**/api/workspace/check*", (route) => {
    const path = new URL(route.request().url()).searchParams.get("path")
    const exists = path === "/tmp/existing"
    return route.fulfill({
      json: {
        success: true,
        data: { exists, isDirectory: exists, path, platforms: exists ? [{ id: "cursor", label: "Cursor" }] : [] },
      },
    })
  })
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON())
      return route.fulfill({ json: { success: true, data: { active: WORKSPACE, workspaces: [WORKSPACE] } } })
    }
    return route.fulfill({ json: { success: true, data: { active: WORKSPACE, workspaces: [WORKSPACE] } } })
  })

  await page.goto("/settings/workspaces")
  await expect(page.getByRole("heading", { name: "Workspaces", exact: true })).toBeVisible()
  await expect(page.getByText(WORKSPACE.path).first()).toBeVisible()

  await page.getByRole("button", { name: new RegExp(WORKSPACE.name) }).first().click()
  await page.getByRole("menuitem", { name: "Open folder…" }).click()
  const open = page.getByRole("dialog", { name: "Open a folder" })
  const openButton = open.getByRole("button", { name: "Open", exact: true })
  await open.getByLabel("Folder path").fill("/tmp/missing")
  await expect(open.getByText("No folder at this path")).toBeVisible()
  await expect(openButton).toBeDisabled()
  await open.getByLabel("Folder path").fill("/tmp/existing")
  await expect(open.getByText("Folder found")).toBeVisible()
  await openButton.click()
  await expect(open).toBeHidden()
  expect(posts).toContainEqual(expect.objectContaining({ path: "/tmp/existing" }))

  await page.getByRole("button", { name: "New workspace" }).click()
  const create = page.getByRole("dialog", { name: "Create a workspace" })
  await create.getByRole("radio", { name: /Blank/ }).click()
  await expect(create.getByRole("radio", { name: /Blank/ })).toHaveAttribute("aria-checked", "true")
  await create.getByLabel("Workspace location").fill("/tmp/new-hub")
  await expect(create.getByText("A new folder is made at this location.")).toBeVisible()
  await create.getByRole("button", { name: "Create", exact: true }).click()
  await expect(create).toBeHidden()
  expect(posts).toContainEqual({ path: "/tmp/new-hub", create: true, template: "blank" })
})
