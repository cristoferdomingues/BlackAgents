import { expect, test, type Page, type Route } from "@playwright/test"

import { stubWorkspace } from "./support/stubs"

const HTTP_PLACEHOLDER = "${secret:mcp.blacklionfi.header.Authorization}"
const STDIO_PLACEHOLDER = "${secret:mcp.github.env.GITHUB_TOKEN}"

interface ListedServer {
  name: string
  status: "connected" | "error" | "disabled"
  tools: []
  trust: "ask"
  config: {
    command?: string
    args: string[]
    env: Record<string, string>
    url?: string
    headers: Record<string, string>
    transport: "http" | "stdio" | "sse"
    disabled: boolean
  }
  secretStatuses: Record<string, { configured: boolean; last4: string }>
}

interface SaveBody {
  name: string
  config: {
    url?: string
    command?: string
    args?: string[]
    headers?: Record<string, string>
    env?: Record<string, string>
    transport?: string
  }
  secretHeaders?: string[]
  secretEnv?: string[]
}

function httpServer(): ListedServer {
  return {
    name: "blacklionfi",
    status: "connected",
    tools: [],
    trust: "ask",
    config: {
      url: "https://app.example/api/mcp",
      headers: { Authorization: HTTP_PLACEHOLDER },
      args: [],
      env: {},
      transport: "http",
      disabled: false,
    },
    secretStatuses: {
      "mcp.blacklionfi.header.Authorization": { configured: true, last4: "cret" },
    },
  }
}

function stdioServer(): ListedServer {
  return {
    name: "github",
    status: "connected",
    tools: [],
    trust: "ask",
    config: {
      command: "npx",
      args: ["-y", "server"],
      env: { GITHUB_TOKEN: STDIO_PLACEHOLDER },
      headers: {},
      transport: "stdio",
      disabled: false,
    },
    secretStatuses: {
      "mcp.github.env.GITHUB_TOKEN": { configured: true, last4: "4242" },
    },
  }
}

function isSaveBody(value: unknown): value is SaveBody {
  return typeof value === "object" && value !== null && "name" in value && "config" in value
}

async function readBody(route: Route): Promise<unknown> {
  return route.request().postDataJSON() as unknown
}

async function installMcp(page: Page, initial: ListedServer[]): Promise<{
  servers: ListedServer[]
  tested: unknown[]
  saved: unknown[]
}> {
  const servers = initial.map((server) => structuredClone(server))
  const tested: unknown[] = []
  const saved: unknown[] = []

  await page.route("**/api/mcp**", async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    const method = route.request().method()

    if (pathname === "/api/mcp/test" && method === "POST") {
      const body = await readBody(route)
      tested.push(body)
      const name = isSaveBody(body) ? body.name : ""
      const server = servers.find((item) => item.name === name)
      await route.fulfill({
        json: {
          success: true,
          data: {
            name,
            status: "connected",
            tools: [],
            config: server?.config ?? {},
          },
        },
      })
      return
    }

    if (pathname === "/api/mcp/policy") {
      await route.fulfill({ json: { success: true, data: { ok: true } } })
      return
    }

    if (pathname === "/api/mcp" && method === "POST") {
      const body = await readBody(route)
      saved.push(body)
      if (isSaveBody(body)) {
        const index = servers.findIndex((item) => item.name === body.name)
        const current = servers[index]
        if (current) {
          servers[index] = {
            ...current,
            status: "connected",
            config: {
              ...current.config,
              url: body.config.url ?? current.config.url,
              command: body.config.command ?? current.config.command,
              args: body.config.args ?? current.config.args,
              transport:
                body.config.transport === "http" ||
                body.config.transport === "stdio" ||
                body.config.transport === "sse"
                  ? body.config.transport
                  : current.config.transport,
            },
          }
        }
      }
      const name = isSaveBody(body) ? body.name : ""
      await route.fulfill({
        json: {
          success: true,
          data: {
            saved: true,
            server: servers.find((item) => item.name === name) ?? null,
          },
        },
      })
      return
    }

    if (pathname === "/api/mcp" && method === "DELETE") {
      const name = url.searchParams.get("name")
      const next = servers.filter((item) => item.name !== name)
      servers.splice(0, servers.length, ...next)
      await route.fulfill({
        json: { success: true, data: { success: true, deleted: name } },
      })
      return
    }

    await route.fulfill({
      json: { success: true, data: { servers, totalTools: 0 } },
    })
  })

  return { servers, tested, saved }
}

test("shows the settings explainer once, then the empty MCP teaching state", async ({ page }) => {
  await stubWorkspace(page)
  await page.goto("/settings?tab=mcp")

  const how = page.getByRole("button", { name: "How it works" })
  await expect(how).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByRole("heading", { name: "How Settings works" })).toBeVisible()
  await expect(page.getByText("1. Choose a folder")).toBeVisible()
  await expect(page.getByText("2. Connect tools")).toBeVisible()
  await expect(page.getByText("3. You choose what to save")).toBeVisible()
  await expect(page.getByText("Pick a workspace folder, then connect tools and AI options for that folder.")).toBeVisible()

  await page.getByRole("button", { name: "Got it" }).click()
  await expect(how).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("heading", { name: "How Settings works" })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole("heading", { name: "How Settings works" })).toHaveCount(0)
  await expect(page.getByText("No MCP servers yet")).toBeVisible()
  await expect(
    page.getByText(
      "Add one in the form below. After it connects, agents can call its tools in chat. The list is stored in .black-agents/mcp.json."
    )
  ).toBeVisible()
  await expect(page.getByText("MCP (Model Context Protocol) lets an agent call tools on another program. Servers here belong to the active folder.")).toBeVisible()

  await page.getByRole("button", { name: "Add a server" }).click()
  await expect(page.getByLabel("Server Name")).toBeFocused()
})

test("edits an HTTP server, keeps a blank secret, and replaces a changed secret", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("black-agents:settings-intro-dismissed", "1")
  })
  await stubWorkspace(page)
  const mcp = await installMcp(page, [httpServer(), stdioServer()])

  await page.goto("/settings?tab=mcp")
  await expect(page.getByRole("button", { name: "Edit blacklionfi" })).toBeVisible()
  await page.getByRole("button", { name: "Edit blacklionfi" }).click()

  await expect(page.getByText("Edit blacklionfi")).toBeVisible()
  await expect(page.getByLabel("Server Name")).toBeDisabled()
  await expect(page.getByLabel("Server Name")).toHaveValue("blacklionfi")
  await expect(page.getByText("The name stays the same.")).toBeVisible()
  await expect(page.getByText("Leave a secret blank to keep the stored value.")).toBeVisible()
  await expect(page.getByLabel("Header 1 value")).toHaveValue("")
  await expect(page.getByLabel("Header 1 value")).toHaveAttribute(
    "placeholder",
    "Saved ••••cret. Blank keeps it."
  )
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled()

  await page.getByLabel("Server URL").fill("https://app.example/api/mcp/v2")
  await expect(page.getByText("Unsaved changes")).toBeVisible()
  await page.getByRole("button", { name: "Save changes" }).click()

  await expect(page.getByText("HTTP https://app.example/api/mcp/v2")).toBeVisible()
  await expect(page.getByText("Add an MCP Server")).toBeVisible()
  expect(mcp.tested).toHaveLength(1)
  expect(mcp.saved).toEqual(mcp.tested)
  expect(mcp.saved[0]).toEqual({
    name: "blacklionfi",
    config: {
      url: "https://app.example/api/mcp/v2",
      headers: { Authorization: HTTP_PLACEHOLDER },
      transport: "http",
    },
    secretHeaders: ["Authorization"],
  })

  await page.getByRole("button", { name: "Edit blacklionfi" }).click()
  await page.getByLabel("Header 1 value").fill("Bearer ghp_replaced_token")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Add an MCP Server")).toBeVisible()
  await expect(page.getByText("ghp_replaced_token")).toHaveCount(0)
  await expect(page.getByText("Headers: Authorization (••••cret)")).toBeVisible()

  expect(mcp.saved[1]).toEqual({
    name: "blacklionfi",
    config: {
      url: "https://app.example/api/mcp/v2",
      headers: { Authorization: "Bearer ghp_replaced_token" },
      transport: "http",
    },
    secretHeaders: ["Authorization"],
  })
  expect(mcp.tested[1]).toEqual(mcp.saved[1])
})

test("edits a command server and keeps a blank secret", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("black-agents:settings-intro-dismissed", "1")
  })
  await stubWorkspace(page)
  const mcp = await installMcp(page, [stdioServer()])

  await page.goto("/settings?tab=mcp")
  await page.getByRole("button", { name: "Edit github" }).click()
  await expect(page.getByLabel("Secret 1 value")).toHaveAttribute(
    "placeholder",
    "Saved ••••4242. Blank keeps it."
  )
  await page.getByLabel("Arguments (space-separated)").fill("-y server --verbose")
  await page.getByRole("button", { name: "Save changes" }).click()

  await expect(page.getByText("npx -y server --verbose")).toBeVisible()
  await expect(page.getByText("ghp_stdio")).toHaveCount(0)
  expect(mcp.saved[0]).toEqual({
    name: "github",
    config: {
      command: "npx",
      args: ["-y", "server", "--verbose"],
      env: { GITHUB_TOKEN: STDIO_PLACEHOLDER },
      transport: "stdio",
    },
    secretEnv: ["GITHUB_TOKEN"],
  })
})

test("cancel drops edits, and a dirty form blocks the next edit", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("black-agents:settings-intro-dismissed", "1")
  })
  await stubWorkspace(page)
  const mcp = await installMcp(page, [httpServer(), stdioServer()])

  await page.goto("/settings?tab=mcp")
  await page.getByRole("button", { name: "Edit blacklionfi" }).click()
  await page.getByLabel("Server URL").fill("https://app.example/api/mcp/draft")
  await expect(page.getByText("Unsaved changes")).toBeVisible()
  await expect(page.getByText("Cancel drops these edits.")).toBeVisible()

  await page.getByRole("button", { name: "Edit github" }).click()
  await expect(page.getByText("Save or cancel your changes first.")).toBeVisible()
  await expect(page.getByText("Edit blacklionfi")).toBeVisible()
  expect(mcp.saved).toHaveLength(0)

  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByText("Add an MCP Server")).toBeVisible()
  await expect(page.getByText("Unsaved changes")).toHaveCount(0)
  await expect(page.getByLabel("Server Name")).toHaveValue("")
  await expect(page.getByLabel("Server Name")).toBeEnabled()
  await expect(page.getByText("HTTP https://app.example/api/mcp")).toBeVisible()
  expect(mcp.tested).toHaveLength(0)
})

test("asks before deleting a server, using named edit and delete controls", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("black-agents:settings-intro-dismissed", "1")
  })
  await stubWorkspace(page)
  await installMcp(page, [httpServer(), stdioServer()])

  await page.goto("/settings?tab=mcp")
  await expect(page.getByRole("button", { name: "Edit github" })).toBeVisible()
  await page.getByRole("button", { name: "Delete blacklionfi" }).click()

  const dialog = page.getByRole("dialog", { name: "Delete blacklionfi?" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("Delete removes blacklionfi from this workspace and deletes its saved tokens.")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText("HTTP https://app.example/api/mcp")).toBeVisible()

  await page.getByRole("button", { name: "Delete blacklionfi" }).click()
  await dialog.getByRole("button", { name: "Delete blacklionfi" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText("HTTP https://app.example/api/mcp")).toHaveCount(0)
  await expect(page.getByText("npx -y server")).toBeVisible()
})
