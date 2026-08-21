import { expect, test, type Page } from "@playwright/test"

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
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled()
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

    await expect(page).toHaveURL(/\/providers$/)
    await expect(page.getByRole("heading", { name: "AI Providers" })).toBeVisible()

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
      await route.fulfill({
        json: {
          success: true,
          data: {
            content: "I will test the observable behavior first.",
            model: "gpt-4o-mini",
          },
        },
      })
    })

    await page.goto("/chat?agent=tester")
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
})
