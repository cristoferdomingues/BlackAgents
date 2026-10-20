import { expect, test, type Page } from "@playwright/test"

import { stubWorkspace } from "./support/stubs"

const ok = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data }) })

function report(overrides: Record<string, unknown> = {}) {
  return {
    targets: ["cursor"],
    targetsSaved: false,
    sourceCount: 1,
    ideOnly: [{ id: "rule:style", name: "style", type: "rule", platform: "cursor", path: ".cursor/rules/style.mdc" }],
    platforms: [
      {
        platform: "cursor",
        label: "Cursor",
        target: true,
        summary: { total: 1, "in-sync": 0, drifted: 1, missing: 0 },
        files: [{ id: "agent:reviewer", name: "reviewer", type: "agent", path: ".cursor/agents/reviewer.md", status: "drifted" }],
      },
    ],
    ...overrides,
  }
}

async function stubDrift(page: Page, next: () => unknown): Promise<void> {
  await page.route("**/api/drift", (route) => route.fulfill(ok(next())))
}

test.describe("sync", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
  })

  test("explains the source folder and turns an IDE target on", async ({ page }) => {
    let current = report()
    await stubDrift(page, () => current)
    let sent: unknown
    await page.route("**/api/artifacts/targets", async (route) => {
      sent = route.request().postDataJSON()
      current = report({ targets: ["cursor", "claude"], targetsSaved: true })
      await route.fulfill(ok({ targets: ["cursor", "claude"], saved: true, written: [".claude/agents/reviewer.md"] }))
    })

    await page.goto("/sync")
    await expect(page.getByRole("region", { name: "How sync works" })).toContainText(".black-agents/artifacts/")
    await expect(page.getByText("These are the IDE folders found in this workspace", { exact: false })).toBeVisible()

    await page.getByRole("switch", { name: "Export to Claude" }).click()
    await expect(page.getByText("Claude turned on. Exported 1 file.")).toBeVisible()
    expect(sent).toEqual({ targets: ["cursor", "claude"] })
    await expect(page.getByText("Each save updates Cursor, Claude.")).toBeVisible()
  })

  test("moves IDE-only artifacts in and resolves a hand edit", async ({ page }) => {
    let current = report()
    await stubDrift(page, () => current)
    const calls: unknown[] = []
    await page.route("**/api/artifacts/sync", async (route) => {
      const body = route.request().postDataJSON() as { action: string }
      calls.push(body)
      if (body.action === "import") {
        current = report({ ideOnly: [] })
        await route.fulfill(ok({ imported: ["rule:style"], written: [] }))
      } else {
        await route.fulfill(ok({ written: [".cursor/agents/reviewer.md"] }))
      }
    })

    await page.goto("/sync")
    const list = page.getByRole("list", { name: "Only in IDE folders" })
    await expect(list).toContainText("style")
    await page.getByRole("button", { name: "Move into BlackAgents" }).click()
    await expect(page.getByText("Moved 1 into BlackAgents.")).toBeVisible()
    await expect(list).toHaveCount(0)

    await page.getByRole("button", { name: "Keep this change" }).click()
    const keptToast = page.getByText("Kept the Cursor version of reviewer.")
    await expect(keptToast).toBeVisible()
    // The toast stack sits bottom-right and can cover the row's own buttons;
    // let it clear so the click below lands on "Overwrite", not the toast.
    await expect(keptToast).toBeHidden({ timeout: 8_000 })
    await page.getByRole("button", { name: "Overwrite" }).click()
    await expect(page.getByText("Exported 1 file.")).toBeVisible()

    expect(calls).toEqual([
      { action: "import" },
      { action: "import", only: { platform: "cursor", type: "agent", name: "reviewer" } },
      { action: "export", ids: ["agent:reviewer"] },
    ])
  })
})
