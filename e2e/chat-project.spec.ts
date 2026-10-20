import { expect, test } from "@playwright/test"

import { artifact, fulfillSse, stubVerifiedProvider, WORKSPACE } from "./support/stubs"

const study = {
  id: "study",
  name: "Study",
  inherits: [],
  manifestRelPath: ".black-agents/projects/study/project.json",
}

function workflowItem(name: string, agent: string) {
  return {
    workflow: { name, description: `${name} workflow`, task: "", steps: [{ id: "one", agent }] },
    lastRun: null,
    active: false,
  }
}

test("chat in a project mentions the project's workflows and sends the scope", async ({ page }) => {
  await stubVerifiedProvider(page)
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: { success: true, data: { active: WORKSPACE, workspaces: [WORKSPACE] } } })
  )
  await page.route("**/api/mcp", (route) =>
    route.fulfill({ json: { success: true, data: { servers: [], totalTools: 0 } } })
  )
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: { success: true, data: { projects: [study], invalid: [], activeProject: "study" } },
    })
  )
  await page.route(/\/api\/artifacts(\?.*)?$/, (route) => {
    const scoped = new URL(route.request().url()).searchParams.get("scope") === "study"
    const coach = {
      ...artifact({ name: "study-coach", type: "agent", description: "Quizzes the user." }),
      scope: { project: "study" },
    }
    return route.fulfill({ json: { success: true, data: scoped ? [coach] : [] } })
  })
  await page.route(/\/api\/workflows(\?.*)?$/, (route) => {
    const scoped = new URL(route.request().url()).searchParams.get("scope") === "study"
    const workflows = scoped ? [workflowItem("drill", "study-coach")] : [workflowItem("ship", "demo")]
    return route.fulfill({ json: { success: true, data: { workflows } } })
  })
  const chatUrls: string[] = []
  await page.route(/\/api\/chat(\?.*)?$/, async (route) => {
    chatUrls.push(route.request().url())
    await fulfillSse(route, [["done", { content: "Here is your quiz.", model: "gpt-4o-mini" }]])
  })

  await page.goto("/chat")
  const input = page.getByRole("textbox", { name: "Message assistant" })
  await input.fill("@")
  const menu = page.getByRole("listbox", { name: "Workspace artifacts and workflows" })
  await expect(menu.getByRole("option", { name: /drill/ })).toBeVisible()
  await expect(menu.getByRole("option", { name: /study-coach/ })).toBeVisible()
  await expect(menu.getByRole("option", { name: /ship/ })).toHaveCount(0)

  await input.fill("Quiz me with study-coach")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Here is your quiz.")).toBeVisible()
  expect(chatUrls.at(-1)).toContain("/api/chat?scope=study")
})
