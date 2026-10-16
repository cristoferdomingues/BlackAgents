import { expect, test } from "@playwright/test"

import { conversationsStorageKey } from "@/lib/chat/conversation-history"
import { stubVerifiedProvider } from "./support/stubs"

const ALPHA = { path: "/tmp/ws-alpha", name: "alpha" }
const BETA = { path: "/tmp/ws-beta", name: "beta" }

function storedChat(title: string) {
  return {
    activeId: "c1",
    conversations: [
      {
        id: "c1",
        title,
        updatedAt: "2026-10-01T12:00:00.000Z",
        messages: [
          { role: "user", content: title },
          { role: "assistant", content: `Saved reply for ${title}` },
        ],
      },
    ],
  }
}

test("keeps recent chats inside the open workspace", async ({ page }) => {
  let active = ALPHA
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { path?: string }
      active = body.path === BETA.path ? BETA : ALPHA
    }
    await route.fulfill({
      json: {
        success: true,
        data: { active, workspaces: [ALPHA, BETA] },
      },
    })
  })
  await page.route("**/api/artifacts", (route) =>
    route.fulfill({ json: { success: true, data: [] } })
  )
  await page.route("**/api/mcp", (route) =>
    route.fulfill({ json: { success: true, data: { servers: [], totalTools: 0 } } })
  )
  await page.route("**/api/workflows", (route) =>
    route.fulfill({ json: { success: true, data: { workflows: [] } } })
  )
  await page.route("**/api/files", (route) =>
    route.fulfill({ json: { success: true, data: { files: [] } } })
  )
  await page.route("**/api/settings/ai", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: { settings: { assistant: { autoApproveFileWrites: false } } },
      },
    })
  )
  await stubVerifiedProvider(page)
  await page.addInitScript(
    ({ alphaKey, betaKey, alphaStore, betaStore }) => {
      localStorage.setItem(alphaKey, JSON.stringify(alphaStore))
      localStorage.setItem(betaKey, JSON.stringify(betaStore))
    },
    {
      alphaKey: conversationsStorageKey(ALPHA.path),
      betaKey: conversationsStorageKey(BETA.path),
      alphaStore: storedChat("Alpha planning chat"),
      betaStore: storedChat("Beta planning chat"),
    }
  )

  await page.goto("/chat")
  await expect(page.getByText("Saved reply for Alpha planning chat")).toBeVisible()
  await page.getByRole("button", { name: "Recent chats" }).click()
  const recent = page.getByRole("menu")
  await expect(recent.getByText("Last 5 chats in this workspace")).toBeVisible()
  await expect(recent.getByRole("menuitem", { name: /Alpha planning chat/ })).toBeVisible()
  await expect(recent.getByRole("menuitem", { name: /Beta planning chat/ })).toHaveCount(0)
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "alpha", exact: true }).click()
  await page.getByRole("menuitem", { name: /beta/ }).click()

  await expect(page.getByText("Saved reply for Beta planning chat")).toBeVisible()
  await expect(page.getByText("Saved reply for Alpha planning chat")).toHaveCount(0)
  await page.getByRole("button", { name: "Recent chats" }).click()
  const betaRecent = page.getByRole("menu")
  await expect(betaRecent.getByRole("menuitem", { name: /Beta planning chat/ })).toBeVisible()
  await expect(betaRecent.getByRole("menuitem", { name: /Alpha planning chat/ })).toHaveCount(0)
})
