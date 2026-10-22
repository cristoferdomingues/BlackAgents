import { expect, test, type Page } from "@playwright/test"

import { fulfillSse } from "./support/stubs"

const tester = {
  name: "tester",
  type: "agent",
  platform: "cursor",
  description: "Ensures changes are covered by reliable tests.",
  frontmatter: {
    description: "Ensures changes are covered by reliable tests.",
  },
  body: "Test observable behavior and important failure paths.",
  relativePath: ".cursor/agents/tester.md",
}

const providers = [
  {
    id: "openai",
    label: "OpenAI",
    models: ["gpt-4o-mini"],
    requiresBaseUrl: false,
  },
]

type VerificationStatus = "valid" | "invalid" | "unverified"

function providerState(status: VerificationStatus) {
  return {
    providers,
    status: [
      {
        id: "openai",
        configured: true,
        verificationStatus: status,
        last4: "test",
        checkedAt:
          status === "unverified" ? undefined : "2026-08-21T10:00:00.000Z",
      },
    ],
    defaults: { provider: "openai", model: "gpt-4o-mini" },
  }
}

async function stubWorkspace(page: Page): Promise<void> {
  await page.route("**/api/workspace", async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: {
          active: { path: "/tmp/black-agents-e2e", name: "black-agents-e2e" },
          workspaces: [
            { path: "/tmp/black-agents-e2e", name: "black-agents-e2e" },
          ],
        },
      },
    })
  })
  await page.route("**/api/artifacts", async (route) => {
    await route.fulfill({ json: { success: true, data: [tester] } })
  })
}

async function stubProviders(
  page: Page,
  getStatus: () => VerificationStatus
): Promise<void> {
  await page.route("**/api/providers*", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/providers/models") {
      await route.fulfill({
        json: { success: true, data: { models: ["gpt-4o-mini"] } },
      })
      return
    }
    await route.fulfill({
      json: { success: true, data: providerState(getStatus()) },
    })
  })
}

test.describe("agent persona chat", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
  })

  test("launches tester from the agent list with an accessible identity", async ({
    page,
  }) => {
    await stubProviders(page, () => "valid")

    await page.goto("/agents")
    await page.getByRole("link", { name: "Chat with tester" }).click()

    await expect(page).toHaveURL(/\/chat\?agent=tester$/)
    await expect(
      page.getByRole("heading", { name: "Chat with tester" })
    ).toBeVisible()
    await expect(page.getByLabel("tester avatar")).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Message tester" })).toBeEnabled()
    await expect(page.getByRole("button", { name: "Start voice input" })).toBeEnabled()
    await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0)
  })

  test("gates persona chat and sends unverified users to recovery", async ({
    page,
  }) => {
    await stubProviders(page, () => "unverified")

    await page.goto("/agents")
    const recoveryLink = page.getByRole("link", {
      name: "Verify a provider to chat with tester",
    })
    await expect(recoveryLink).toBeVisible()
    await recoveryLink.click()

    await expect(page).toHaveURL(/\/settings\/providers$/)
    await expect(page.getByRole("heading", { name: "AI providers" })).toBeVisible()

    await page.goto("/chat?agent=tester")
    await expect(
      page.getByText("Verify a provider to start chatting", { exact: true })
    ).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Message tester" })).toBeDisabled()
    await expect(page.getByRole("link", { name: "Open providers" })).toBeVisible()
  })

  test("announces agent thinking and renders the agent reply", async ({ page }) => {
    await stubProviders(page, () => "valid")
    let chatBody: unknown
    await page.route("**/api/chat", async (route) => {
      chatBody = route.request().postDataJSON()
      await new Promise((resolve) => setTimeout(resolve, 300))
      await fulfillSse(route, [
        ["context", { artifacts: [], jev: "off", tools: 2 }],
        ["token", { type: "token", content: "I will test the observable behavior first." }],
        ["done", { content: "I will test the observable behavior first.", model: "gpt-4o-mini", toolExecutions: [] }],
      ])
    })

    await page.goto("/chat?agent=tester")
    await expect(page.getByRole("textbox", { name: "Model" })).toBeEnabled()
    await expect(page.getByText("from agent")).toHaveCount(0)
    const message = page.getByRole("textbox", { name: "Message tester" })
    await message.fill("How will you approach this?")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(page.getByRole("status")).toHaveText("tester is thinking")
    await expect(page.getByText("How will you approach this?")).toBeVisible()
    await expect(
      page.getByText("I will test the observable behavior first.")
    ).toBeVisible()
    await expect(page.getByRole("status")).toHaveText("tester responded")
    expect(chatBody).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      agent: "tester",
      messages: [
        { role: "user", content: "How will you approach this?" },
      ],
    })
  })

  test("recovers to the unverified state after an authentication failure", async ({
    page,
  }) => {
    let status: VerificationStatus = "valid"
    await stubProviders(page, () => status)
    await page.route("**/api/chat", async (route) => {
      status = "invalid"
      await route.fulfill({
        status: 401,
        json: { success: false, error: "OpenAI rejected the API key" },
      })
    })

    await page.goto("/chat?agent=tester")
    const message = page.getByRole("textbox", { name: "Message tester" })
    await message.fill("Run the tests.")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(
      page.getByText("Verify a provider to start chatting", { exact: true })
    ).toBeVisible()
    await expect(message).toBeDisabled()
    await expect(message).toHaveValue("Run the tests.")
    await expect(
      page.getByText("OpenAI rejected the API key", { exact: true })
    ).toBeVisible()
  })

  test("uses the agent model in the header and keeps the saved picker", async ({ page }) => {
    const puts: unknown[] = []
    await page.route("**/api/artifacts", async (route) => {
      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              ...tester,
              frontmatter: {
                ...tester.frontmatter,
                model: "claude-sonnet-4-20250514",
                provider: "anthropic",
              },
            },
          ],
        },
      })
    })
    await stubProviders(page, () => "valid")
    await page.route("**/api/providers", async (route) => {
      if (route.request().method() === "PUT") puts.push(route.request().postDataJSON())
      await route.fallback()
    })
    let chatBody: { model?: string } | undefined
    await page.route("**/api/chat", async (route) => {
      chatBody = route.request().postDataJSON() as { model?: string }
      await fulfillSse(route, [
        [
          "context",
          {
            artifacts: [],
            model: {
              provider: "anthropic",
              model: "claude-sonnet-4-20250514",
              source: "agent",
            },
          },
        ],
        ["token", { content: "Reviewing." }],
        ["done", { content: "Reviewing.", model: "claude-sonnet-4-20250514" }],
      ])
    })

    await page.goto("/chat?agent=tester")
    const model = page.getByRole("textbox", { name: "Model" })
    await expect(model).toBeDisabled()
    await expect(model).toHaveValue("claude-sonnet-4-20250514")
    await expect(page.getByText("claude-sonnet-4-20250514 · from agent")).toBeVisible()
    await model.hover()
    await expect(page.getByRole("tooltip")).toHaveText(
      "This agent picks its own model. Edit the agent to change it."
    )

    await page.getByRole("textbox", { name: "Message tester" }).fill("Look at this")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(
      page.getByText("claude-sonnet-4-20250514 · anthropic · from agent")
    ).toBeVisible()
    expect(chatBody?.model).toBe("gpt-4o-mini")
    expect(JSON.stringify(puts)).not.toContain("claude-sonnet-4-20250514")
  })

  test("shows a task kind from the agent, then the resolved model", async ({ page }) => {
    await page.route("**/api/artifacts", async (route) => {
      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              ...tester,
              frontmatter: { ...tester.frontmatter, model: "task:vision" },
            },
          ],
        },
      })
    })
    await stubProviders(page, () => "valid")
    await page.route("**/api/chat", async (route) => {
      await fulfillSse(route, [
        [
          "context",
          {
            artifacts: [],
            model: { provider: "openai", model: "gpt-4o", source: "agent", task: "vision" },
          },
        ],
        ["done", { content: "I can see it.", model: "gpt-4o" }],
      ])
    })

    await page.goto("/chat?agent=tester")
    await expect(page.getByRole("textbox", { name: "Model" })).toBeDisabled()
    await expect(page.getByText("task:vision · from agent")).toBeVisible()
    await page.getByRole("textbox", { name: "Message tester" }).fill("What is in the image?")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("task:vision → gpt-4o · openai · from agent")).toBeVisible()
  })
})

test.describe("agent model editor", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
    await stubProviders(page, () => "valid")
    await page.route("**/api/settings/ai", async (route) => {
      await route.fulfill({
        json: {
          success: true,
          data: {
            settings: {
              assistant: { maxToolTurns: 8, autoApproveFileWrites: false },
              jev: { enabled: false, provider: "auto", openRouterKeySource: "reuse" },
              models: {},
            },
            jevKey: { configured: false },
            jevOpenRouterKey: { configured: false },
            aiOpenRouter: { available: false },
            openRouterAvailable: false,
            activeProvider: null,
          },
        },
      })
    })
  })

  function reviewer(frontmatter: Record<string, unknown>) {
    return {
      name: "reviewer",
      type: "agent",
      platform: "cursor",
      description: "Reviews pull requests",
      frontmatter: {
        name: "reviewer",
        description: "Reviews pull requests",
        ...frontmatter,
      },
      body: "Review carefully.",
      relativePath: ".cursor/agents/reviewer.md",
    }
  }

  async function stubAgent(page: Page, frontmatter: Record<string, unknown>): Promise<unknown[]> {
    const saved: unknown[] = []
    const artifact = reviewer(frontmatter)
    await page.route("**/api/artifacts/agent/reviewer", async (route) => {
      if (route.request().method() === "PUT") {
        saved.push(route.request().postDataJSON())
        await route.fulfill({ json: { success: true, data: artifact } })
        return
      }
      await route.fulfill({ json: { success: true, data: artifact } })
    })
    return saved
  }

  test("saves a task kind and leaves the provider empty", async ({ page }) => {
    const saved = await stubAgent(page, {})
    await page.goto("/agents/reviewer")
    await expect(page.getByLabel("Name")).toHaveValue("reviewer")
    await page.getByRole("combobox", { name: "Model provider" }).click()
    await page.getByRole("option", { name: "Vision" }).click()
    await expect(page.getByRole("link", { name: "not set" })).toHaveAttribute("href", "/settings/models")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText('Agent "reviewer" saved')).toBeVisible()
    expect(saved[0]).toMatchObject({ extra: { model: "task:vision", provider: null } })
  })

  test("saves a model, keeps it after reload, then clears it", async ({ page }) => {
    let frontmatter: Record<string, unknown> = {}
    const saved: unknown[] = []
    await page.route("**/api/artifacts/agent/reviewer", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as {
          extra?: { model?: string | null; provider?: string | null }
        }
        saved.push(body)
        const extra = body.extra ?? {}
        frontmatter = {}
        if (typeof extra.model === "string") frontmatter.model = extra.model
        if (typeof extra.provider === "string") frontmatter.provider = extra.provider
      }
      await route.fulfill({ json: { success: true, data: reviewer(frontmatter) } })
    })

    await page.goto("/agents/reviewer")
    await page.getByRole("combobox", { name: "Model provider" }).click()
    const modelsReady = page.waitForResponse((res) => res.url().includes("/api/providers/models"))
    await page.getByRole("option", { name: "OpenAI" }).click()
    await modelsReady
    await page.getByRole("button", { name: "Choose model" }).click()
    await page.getByRole("menuitem", { name: "gpt-4o-mini" }).click()
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText('Agent "reviewer" saved')).toBeVisible()
    expect(saved[0]).toMatchObject({ extra: { model: "gpt-4o-mini", provider: "openai" } })

    await page.reload()
    await expect(page.getByRole("textbox", { name: "Agent model" })).toHaveValue("gpt-4o-mini")
    await expect(page.getByRole("combobox", { name: "Model provider" })).toContainText("OpenAI")

    await page.getByRole("combobox", { name: "Model provider" }).click()
    await page.getByRole("option", { name: "Inherit", exact: true }).click()
    await page.getByRole("button", { name: "Save" }).click()
    await expect.poll(() => saved.length).toBe(2)
    expect(saved[1]).toMatchObject({ extra: { model: null, provider: null } })
    await page.reload()
    await expect(page.getByRole("combobox", { name: "Model provider" })).toContainText("Inherit")
    await expect(page.getByRole("textbox", { name: "Agent model" })).toHaveCount(0)
  })

  test("keeps an alias and clears a real model with null", async ({ page }) => {
    const aliasSaves = await stubAgent(page, { model: "sonnet" })
    await page.goto("/agents/reviewer")
    await expect(page.getByLabel("Name")).toHaveValue("reviewer")
    await expect(page.getByRole("combobox", { name: "Model provider" })).toContainText("Inherit")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText('Agent "reviewer" saved')).toBeVisible()
    expect(aliasSaves[0]).toMatchObject({ extra: { model: "sonnet", provider: null } })

    const clearSaves = await stubAgent(page, { model: "gpt-4o", provider: "openai" })
    await page.goto("/agents/reviewer")
    await expect(page.getByRole("textbox", { name: "Agent model" })).toHaveValue("gpt-4o")
    await page.getByRole("combobox", { name: "Model provider" }).click()
    await page.getByRole("option", { name: "Inherit", exact: true }).click()
    await page.getByRole("button", { name: "Save" }).click()
    await expect.poll(() => clearSaves.length).toBe(1)
    expect(clearSaves[0]).toMatchObject({ extra: { model: null, provider: null } })
  })
})
