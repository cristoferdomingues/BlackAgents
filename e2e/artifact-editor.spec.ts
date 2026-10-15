import { expect, test, type Page } from "@playwright/test"

import { artifact, fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

/** Capture create calls and answer like the real API. */
async function captureCreate(page: Page): Promise<Array<Record<string, unknown>>> {
  const saved: Array<Record<string, unknown>> = []
  await page.route("**/api/artifacts", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    const body = route.request().postDataJSON() as Record<string, unknown>
    saved.push(body)
    await route.fulfill({
      status: 201,
      json: {
        success: true,
        data: artifact({
          name: String(body.name),
          type: body.type as "agent",
          description: String(body.description),
        }),
      },
    })
  })
  return saved
}

test.describe("artifact editor", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
    await stubVerifiedProvider(page)
  })

  test("starts an agent from a template, changes its abilities and saves the previewed file", async ({ page }) => {
    const saved = await captureCreate(page)
    await page.goto("/agents/new")
    await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible()
    await page.getByRole("button", { name: /Code reviewer/ }).click()

    await expect(page.getByLabel("Name")).toHaveValue("code-reviewer")
    await expect(page.getByRole("radio", { name: /Read only/ })).toHaveAttribute("aria-checked", "true")
    const tools = page.getByRole("list", { name: "Tools it gets" })
    await expect(tools).toContainText("Search in files")
    await expect(tools).not.toContainText("Run commands")

    await page.getByRole("radio", { name: /Full/ }).click()
    await expect(tools).toContainText("Run commands")
    await expect(page.getByText("Runs commands: every command asks you first.")).toBeVisible()

    await page.getByRole("tab", { name: "File" }).click()
    await expect(page.getByText(".cursor/agents/code-reviewer.md")).toBeVisible()
    await expect(page.getByLabel("File content")).toContainText("- shell_run")

    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText('Agent "code-reviewer" saved')).toBeVisible()
    expect(saved[0]).toMatchObject({
      type: "agent",
      name: "code-reviewer",
      extra: { tools: ["fs_list", "fs_read", "fs_write", "shell_run"], mcpServers: [], parallel: true },
    })
  })

  test("describes a skill and lets the assistant draft it", async ({ page }) => {
    const drafts: Array<Record<string, unknown>> = []
    await page.route("**/api/artifacts/draft-body", async (route) => {
      drafts.push(route.request().postDataJSON() as Record<string, unknown>)
      await route.fulfill({
        json: {
          success: true,
          data: {
            description: "",
            body: "# Migrations\n\n## When to Apply\n\n- Writing a migration.\n",
            extra: { parallel: false, alwaysApply: false, globs: [] },
            links: [],
          },
        },
      })
    })
    await page.goto("/skills/new")
    await page.getByLabel("What should this skill do?").fill("Use when writing database migrations")
    await page.getByRole("button", { name: "Draft it" }).click()

    await expect(page.getByLabel("Name")).toHaveValue("writing-database-migrations")
    await expect(page.getByLabel("Description")).toHaveValue("Use when writing database migrations")
    expect(drafts[0]).toMatchObject({ type: "skill", name: "writing-database-migrations" })
    await expect(page.getByRole("tab", { name: /Checks/ })).toContainText("6/6")
    await expect(page.getByText("Unsaved changes")).toBeVisible()
  })

  test("shows live checks and fixes the name while typing", async ({ page }) => {
    await page.goto("/commands/new")
    await page.getByRole("button", { name: "Start blank" }).click()
    await page.getByLabel("Name").fill("Ship It")
    await expect(page.getByLabel("Name")).toHaveValue("ship-it")
    const checks = page.getByRole("list", { name: "Checks" })
    await expect(checks.getByRole("listitem").filter({ hasText: "Has a description" })).toContainText(
      "Has a description"
    )
    await expect(page.getByRole("button", { name: "Try in chat" })).toBeDisabled()
    await page.getByLabel("Description").fill("Ships a release.")
    await expect(page.getByRole("button", { name: "Try in chat" })).toBeEnabled()
  })

  test("sets when a rule applies", async ({ page }) => {
    const saved = await captureCreate(page)
    await page.goto("/rules/new")
    await page.getByRole("button", { name: "Start blank" }).click()
    await page.getByLabel("Name").fill("ts-style")
    await page.getByLabel("Description").fill("TypeScript style.")
    await page.getByRole("radio", { name: /For some files/ }).click()
    await page.getByLabel("File patterns").fill("**/*.ts")
    await page.getByLabel("File patterns").press("Enter")
    await page.getByRole("button", { name: "Save" }).click()
    await expect.poll(() => saved.length).toBe(1)
    expect(saved[0]).toMatchObject({ extra: { alwaysApply: false, globs: ["**/*.ts"] } })
  })

  test("tries an unsaved agent in chat", async ({ page }) => {
    const requests: Array<Record<string, unknown>> = []
    await page.route("**/api/chat", async (route) => {
      requests.push(route.request().postDataJSON() as Record<string, unknown>)
      await fulfillSse(route, [
        ["context", { artifacts: [], jev: "off" }],
        ["token", { content: "I would run the tests." }],
        ["done", { content: "I would run the tests." }],
      ])
    })
    await page.goto("/agents/new")
    await page.getByRole("button", { name: /Developer/ }).click()
    await page.getByRole("button", { name: "Try in chat" }).click()
    const panel = page.getByRole("region", { name: "Try in chat" })
    await expect(panel).toContainText("Uses your unsaved changes. Nothing is saved.")
    await panel.getByLabel("Message").fill("What would you do first?")
    await panel.getByRole("button", { name: "Send" }).click()
    await expect(panel.getByText("I would run the tests.")).toBeVisible()
    expect(requests[0]).toMatchObject({
      provider: "openai",
      messages: [{ role: "user", content: "What would you do first?" }],
      draft: { type: "agent", name: "developer", extra: { tools: ["fs_list", "fs_read", "fs_write", "shell_run"] } },
    })
    await panel.getByRole("button", { name: "Close try chat" }).click()
    await expect(page.getByRole("button", { name: "Try in chat" })).toBeVisible()
  })

  test("limits an existing agent to one MCP server", async ({ page }) => {
    await page.route("**/api/mcp", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            servers: [
              { name: "github", config: {}, status: "connected", tools: [] },
              { name: "linear", config: {}, status: "connected", tools: [] },
            ],
            totalTools: 0,
          },
        },
      })
    )
    const saved: unknown[] = []
    await page.route("**/api/artifacts/agent/reviewer", async (route) => {
      if (route.request().method() === "PUT") saved.push(route.request().postDataJSON())
      await route.fulfill({
        json: {
          success: true,
          data: artifact({
            name: "reviewer",
            type: "agent",
            description: "Reviews code.",
            frontmatter: { tools: ["fs_read"] },
          }),
        },
      })
    })
    await page.goto("/agents/reviewer")
    await expect(page.getByLabel("Name")).toHaveValue("reviewer")
    await expect(page.getByRole("radio", { name: /Custom/ })).toHaveAttribute("aria-checked", "true")
    const servers = page.getByRole("group", { name: "MCP servers" })
    await expect(servers.getByRole("button", { name: "All servers" })).toHaveAttribute("aria-pressed", "true")
    await servers.getByRole("button", { name: "github" }).click()
    await expect(page.getByText("Unsaved changes")).toBeVisible()
    await page.getByRole("button", { name: "Save" }).click()
    await expect.poll(() => saved.length).toBe(1)
    expect(saved[0]).toMatchObject({ extra: { tools: ["fs_read"], mcpServers: ["github"] } })
  })

  test("keeps validate and delete in the More menu", async ({ page }) => {
    await page.route("**/api/artifacts/agent/reviewer", (route) =>
      route.fulfill({
        json: { success: true, data: artifact({ name: "reviewer", type: "agent", description: "Reviews code." }) },
      })
    )
    await page.goto("/agents/reviewer")
    await page.getByRole("button", { name: "More actions" }).click()
    await expect(page.getByRole("menuitem", { name: "Validate with assistant" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Chat with this agent" })).toBeVisible()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await expect(page.getByRole("dialog", { name: "Delete agent?" })).toBeVisible()
  })
})
