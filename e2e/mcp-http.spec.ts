import { expect, test } from "@playwright/test"

import { stubWorkspace } from "./support/stubs"

test("saves an HTTP MCP server with a header", async ({ page }) => {
  let saved: unknown = null
  let tested: unknown = null

  await stubWorkspace(page)
  await page.route("**/api/mcp/test", async (route) => {
    tested = route.request().postDataJSON()
    await route.fulfill({
      json: {
        success: true,
        data: {
          name: "blacklionfi",
          status: "connected",
          tools: [],
          config: {
            url: "https://app.example/api/mcp",
            headers: {
              Authorization: "${secret:mcp.blacklionfi.header.Authorization}",
            },
            transport: "http",
          },
        },
      },
    })
  })
  await page.route("**/api/mcp", async (route) => {
    if (route.request().method() === "POST") {
      saved = route.request().postDataJSON()
      await route.fulfill({
        json: {
          success: true,
          data: {
            saved: true,
            server: {
              name: "blacklionfi",
              status: "disabled",
              tools: [],
              trust: "ask",
              config: {
                url: "https://app.example/api/mcp",
                headers: {
                  Authorization: "${secret:mcp.blacklionfi.header.Authorization}",
                },
                args: [],
                env: {},
                disabled: false,
              },
              secretStatuses: {
                "mcp.blacklionfi.header.Authorization": {
                  configured: true,
                  last4: "cret",
                },
              },
            },
          },
        },
      })
      return
    }

    await route.fulfill({
      json: {
        success: true,
        data: saved
          ? {
              servers: [
                {
                  name: "blacklionfi",
                  status: "connected",
                  tools: [],
                  trust: "ask",
                  config: {
                    url: "https://app.example/api/mcp",
                    headers: {
                      Authorization:
                        "${secret:mcp.blacklionfi.header.Authorization}",
                    },
                    args: [],
                    env: {},
                    disabled: false,
                  },
                  secretStatuses: {
                    "mcp.blacklionfi.header.Authorization": {
                      configured: true,
                      last4: "cret",
                    },
                  },
                },
              ],
              totalTools: 0,
            }
          : { servers: [], totalTools: 0 },
      },
    })
  })

  await page.goto("/settings/mcp")
  await page.getByRole("button", { name: "HTTP", exact: true }).click()
  await expect(page.getByText("Uses HTTP POST.")).toBeVisible()

  await page.getByLabel("Server Name").fill("blacklionfi")
  await page.getByLabel("Server URL").fill("https://app.example/api/mcp")
  await page.getByLabel("Header 1 name").fill("Authorization")
  await page.getByLabel("Header 1 value").fill("Bearer blf_mcp_secret")
  await page.getByRole("button", { name: "Add header" }).click()
  await page.getByLabel("Header 2 name").fill("X-Extra")
  await page.getByLabel("Remove header 2").click()
  await expect(page.getByLabel("Header 2 name")).toHaveCount(0)

  await page.getByRole("button", { name: "Test & Save Server" }).click()

  await expect(page.getByText("HTTP https://app.example/api/mcp")).toBeVisible()
  await expect(page.getByText("Headers: Authorization (••••cret)")).toBeVisible()
  await expect(page.getByText("blf_mcp_secret")).toHaveCount(0)

  expect(saved).toEqual({
    name: "blacklionfi",
    config: {
      url: "https://app.example/api/mcp",
      headers: { Authorization: "Bearer blf_mcp_secret" },
      transport: "http",
    },
    secretHeaders: ["Authorization"],
  })
  expect(tested).toEqual(saved)
})
