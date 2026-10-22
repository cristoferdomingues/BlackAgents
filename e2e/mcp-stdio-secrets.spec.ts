import { expect, test } from "@playwright/test"

import { stubWorkspace } from "./support/stubs"

test("saves a command MCP server with a secret", async ({ page }) => {
  let saved: unknown = null
  let tested: unknown = null

  await stubWorkspace(page)
  await page.route("**/api/mcp/test", async (route) => {
    tested = route.request().postDataJSON()
    await route.fulfill({
      json: {
        success: true,
        data: {
          name: "github",
          status: "connected",
          tools: [],
          config: {
            command: "npx",
            args: ["-y", "server"],
            env: { GITHUB_TOKEN: "${secret:mcp.github.env.GITHUB_TOKEN}" },
            transport: "stdio",
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
              name: "github",
              status: "disabled",
              tools: [],
              trust: "ask",
              config: {
                command: "npx",
                args: ["-y", "server"],
                env: {
                  GITHUB_TOKEN: "${secret:mcp.github.env.GITHUB_TOKEN}",
                },
                headers: {},
                disabled: false,
              },
              secretStatuses: {
                "mcp.github.env.GITHUB_TOKEN": {
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
                  name: "github",
                  status: "connected",
                  tools: [],
                  trust: "ask",
                  config: {
                    command: "npx",
                    args: ["-y", "server"],
                    env: {
                      GITHUB_TOKEN: "${secret:mcp.github.env.GITHUB_TOKEN}",
                    },
                    headers: {},
                    disabled: false,
                  },
                  secretStatuses: {
                    "mcp.github.env.GITHUB_TOKEN": {
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
  await expect(page.getByRole("textbox", { name: "Command" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Add secret" })).toBeVisible()

  await page.getByLabel("Server Name").fill("github")
  await page.getByRole("textbox", { name: "Command" }).fill("npx")
  await page.getByLabel("Arguments (space-separated)").fill("-y server")
  await page.getByLabel("Secret 1 name").fill("GITHUB_TOKEN")
  await page.getByLabel("Secret 1 value").fill("ghp_stdio_secret")
  await page.getByRole("button", { name: "Add secret" }).click()
  await page.getByLabel("Secret 2 name").fill("EXTRA_TOKEN")
  await page.getByLabel("Remove secret 2").click()
  await expect(page.getByLabel("Secret 2 name")).toHaveCount(0)

  await page.getByRole("button", { name: "Test & Save Server" }).click()

  await expect(page.getByText("npx -y server")).toBeVisible()
  await expect(page.getByText("Secrets: GITHUB_TOKEN (••••cret)")).toBeVisible()
  await expect(page.getByText("ghp_stdio_secret")).toHaveCount(0)

  expect(saved).toEqual({
    name: "github",
    config: {
      command: "npx",
      args: ["-y", "server"],
      env: { GITHUB_TOKEN: "ghp_stdio_secret" },
      transport: "stdio",
    },
    secretEnv: ["GITHUB_TOKEN"],
  })
  expect(tested).toEqual(saved)
})
