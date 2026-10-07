import { expect, test } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const SKILL_BODY = "# Release notes\n\n## When to Apply\n\nWhen preparing a release.\n\n## Steps\n\n1. List merged PRs.\n"

test.describe("assistant tools and bundles", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page, [{ name: "style", type: "rule", description: "House style." }])
    await stubVerifiedProvider(page)
  })

  test("streams tool calls, loaded context and the limit note", async ({ page }) => {
    let body: unknown
    await page.route("**/api/chat", async (route) => {
      body = route.request().postDataJSON()
      await fulfillSse(route, [
        ["context", { artifacts: [{ type: "rule", name: "style", source: "mention" }], jev: "off", tools: 2 }],
        ["tool_result", { type: "tool_result", trace: { id: "t1", server: "builtin", tool: "fs_list", args: { path: "." }, result: { entries: [] } } }],
        [
          "done",
          {
            content: "I looked at the workspace.",
            model: "gpt-4o-mini",
            toolExecutions: [{ id: "t1", server: "builtin", tool: "fs_list", args: { path: "." }, result: { entries: [] } }],
            stoppedAtLimit: true,
          },
        ],
      ])
    })

    await page.goto("/chat")
    await page.getByLabel("Allow file writes").click()
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Check @rule:style")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(page.getByText("I looked at the workspace.")).toBeVisible()
    await expect(page.getByText("rule/style")).toBeVisible()
    await expect(page.getByText("Stopped at the tool-call limit", { exact: false })).toBeVisible()
    expect(body).toMatchObject({ allowWrites: true, messages: [{ role: "user", content: "Check @rule:style" }] })
  })

  test("shows a stream error and keeps the message", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [["error", { message: "Upstream failed", status: 502 }]])
    )
    await page.goto("/chat")
    const input = page.getByRole("textbox", { name: "Message assistant" })
    await input.fill("Hello")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("Upstream failed")).toBeVisible()
    await expect(input).toHaveValue("Hello")
  })

  test("creates every artifact of a drafted bundle", async ({ page }) => {
    const bundle = { summary: "Release kit", skills: [{ name: "release-notes", description: "Write release notes.", body: SKILL_BODY }] }
    const reply = `Here is your kit.\n\n\`\`\`bundle\n${JSON.stringify(bundle)}\n\`\`\``
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [["done", { content: reply, model: "gpt-4o-mini", toolExecutions: [] }]])
    )
    const created: unknown[] = []
    await page.route("**/api/artifacts", async (route) => {
      if (route.request().method() === "POST") {
        created.push(route.request().postDataJSON())
        await route.fulfill({ status: 201, json: { success: true, data: { name: "release-notes" } } })
        return
      }
      await route.fallback()
    })

    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Make a release kit")
    await page.getByRole("button", { name: "Send" }).click()

    const card = page.getByLabel("Artifact bundle")
    await expect(card).toBeVisible()
    await card.getByRole("button", { name: "Create all" }).click()
    await expect(card.getByRole("button", { name: "All created" })).toBeVisible()
    expect(created).toEqual([expect.objectContaining({ type: "skill", name: "release-notes" })])
  })

  test("sends thumbs-down feedback with a comment to the brain", async ({ page }) => {
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [["done", { content: "Use npm.", model: "gpt-4o-mini", toolExecutions: [] }]])
    )
    let feedback: unknown
    await page.route("**/api/brain/feedback", async (route) => {
      feedback = route.request().postDataJSON()
      await route.fulfill({ json: { success: true, data: { kind: "proposed", proposalId: "p1" } } })
    })

    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("How to install?")
    await page.getByRole("button", { name: "Send" }).click()
    await page.getByRole("button", { name: "Bad answer" }).click()
    await page.getByLabel("Feedback comment").fill("We use pnpm")
    await page.getByRole("button", { name: "Send feedback" }).click()

    await expect(page.getByText("Feedback saved.")).toBeVisible()
    expect(feedback).toMatchObject({ source: "chat", rating: "down", comment: "We use pnpm", reply: "Use npm." })
  })
})
