import { expect, test } from "@playwright/test"

import { WORKSPACE } from "./support/stubs"

const study = {
  id: "study",
  name: "Study",
  inherits: [],
  manifestRelPath: ".black-agents/projects/study/project.json",
}

test("a project exports only into its own folder", async ({ page }) => {
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: { success: true, data: { active: WORKSPACE, workspaces: [WORKSPACE] } } })
  )
  await page.route("**/api/mcp", (route) =>
    route.fulfill({ json: { success: true, data: { servers: [], totalTools: 0 } } })
  )
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { success: true, data: { projects: [study], invalid: [], activeProject: "study" } } })
  )
  await page.route(/\/api\/artifacts(\?.*)?$/, (route) => route.fulfill({ json: { success: true, data: [] } }))
  await page.route(/\/api\/workspace\/check\?.*/, (route) => {
    const p = new URL(route.request().url()).searchParams.get("path") ?? ""
    return route.fulfill({ json: { success: true, data: { exists: true, isDirectory: true, path: p } } })
  })
  const exportCalls: Array<{ url: string; body: { mode?: string; targetPath?: string } }> = []
  await page.route(/\/api\/export(\?.*)?$/, async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { mode?: string; targetPath?: string }
    exportCalls.push({ url: route.request().url(), body })
    await route.fulfill({
      json: {
        success: true,
        data: {
          platform: "claude",
          mode: body.mode ?? "dry-run",
          overwrite: true,
          target: body.targetPath ?? null,
          summary: { total: 1, create: 1, overwrite: 0, unchanged: 0, written: body.mode === "write" ? 1 : 0 },
          files: [{ path: ".claude/agents/study-coach.md", status: "create", applied: body.mode === "write" }],
        },
      },
    })
  })

  await page.goto("/export")
  await expect(page.getByText(/Re-emit project\s+Study/)).toBeVisible()
  await expect(page.getByText(".claude/agents/study-coach.md")).toBeVisible()
  await expect(page.getByText("(required — a project goes into its own folder")).toBeVisible()
  const exportButton = page.getByRole("button", { name: /^Export/ })
  await expect(exportButton).toBeDisabled()
  expect(exportCalls.length).toBeGreaterThan(0)
  expect(exportCalls.every((call) => call.url.endsWith("/api/export?scope=study"))).toBe(true)

  const input = page.getByLabel(/Write into/)
  await input.fill(WORKSPACE.path)
  await expect(page.getByText("This is the workspace folder.")).toBeVisible()
  await expect(exportButton).toBeDisabled()

  await input.fill("/tmp/study-repo")
  await expect(page.getByText("Cross-repo export")).toBeVisible()
  await expect(exportButton).toBeEnabled()
  await exportButton.click()
  await page.getByRole("button", { name: "Write files" }).click()
  await expect.poll(() => exportCalls.find((call) => call.body.mode === "write")).toMatchObject({
    body: { mode: "write", targetPath: "/tmp/study-repo" },
  })
  expect(exportCalls.find((call) => call.body.mode === "write")?.url).toContain("scope=study")
})
