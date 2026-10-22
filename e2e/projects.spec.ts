import { expect, test, type Page } from "@playwright/test"

import { artifact, WORKSPACE } from "./support/stubs"

const health = {
  id: "health",
  name: "MyHealthCare",
  inherits: ["rules"],
  manifestRelPath: ".black-agents/projects/health/project.json",
}

const workspaceRules = [artifact({ name: "shared-style", type: "rule", description: "Workspace rule." })]
const projectRules = [
  { ...artifact({ name: "diet-log", type: "rule", description: "Project rule." }), scope: { project: "health" } },
  ...workspaceRules,
]

interface ProjectStub {
  active: string | null
  activations: Array<string | null>
  created: unknown[]
  artifactUrls: string[]
}

async function stubProjects(page: Page): Promise<ProjectStub> {
  const state: ProjectStub = { active: null, activations: [], created: [], artifactUrls: [] }
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: { success: true, data: { active: WORKSPACE, workspaces: [WORKSPACE] } } })
  )
  await page.route("**/api/mcp", (route) =>
    route.fulfill({ json: { success: true, data: { servers: [], totalTools: 0 } } })
  )
  await page.route(/\/api\/artifacts(\?.*)?$/, (route) => {
    const url = route.request().url()
    state.artifactUrls.push(url)
    const scoped = new URL(url).searchParams.get("scope") === "health"
    return route.fulfill({ json: { success: true, data: scoped ? projectRules : workspaceRules } })
  })
  await page.route("**/api/projects/active", async (route) => {
    const body = route.request().postDataJSON() as { id: string | null }
    state.active = body.id
    state.activations.push(body.id)
    await route.fulfill({ json: { success: true, data: { activeProject: body.id } } })
  })
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "POST") {
      state.created.push(route.request().postDataJSON())
      await route.fulfill({ status: 201, json: { success: true, data: health } })
      return
    }
    await route.fulfill({
      json: {
        success: true,
        data: {
          projects: [health],
          invalid: [{ folder: "broken", error: "Missing .black-agents/projects/broken/project.json" }],
          activeProject: state.active,
        },
      },
    })
  })
  return state
}

test.describe("project scopes", () => {
  test("switching to a project scopes the lists and shows origin badges", async ({ page }) => {
    const state = await stubProjects(page)
    await page.goto("/rules")
    await expect(page.getByRole("cell", { name: "shared-style" })).toBeVisible()
    await expect(page.getByText("Inherited")).toHaveCount(0)

    await page.getByRole("button", { name: /Project: Whole workspace/ }).click()
    await page.getByRole("menuitem", { name: /MyHealthCare/ }).click()

    await expect(page.getByRole("cell", { name: "diet-log" })).toBeVisible()
    await expect(page.getByText("In project")).toBeVisible()
    await expect(page.getByRole("row", { name: /diet-log/ }).getByText("Project", { exact: true })).toBeVisible()
    await expect(page.getByRole("row", { name: /shared-style/ }).getByText("Inherited")).toBeVisible()
    expect(state.activations).toEqual(["health"])
    expect(state.artifactUrls.some((url) => url.endsWith("/api/artifacts?scope=health"))).toBe(true)

    await page.getByRole("button", { name: /Project: MyHealthCare/ }).click()
    await page.getByRole("menuitem", { name: /Whole workspace/ }).click()
    await expect(page.getByRole("cell", { name: "diet-log" })).toHaveCount(0)
    expect(state.activations).toEqual(["health", null])
  })

  test("creates a project with a whitelist and lists broken folders", async ({ page }) => {
    const state = await stubProjects(page)
    await page.goto("/settings/projects")
    const panel = page.locator("#projects")
    await expect(panel.getByText("MyHealthCare")).toBeVisible()
    await expect(panel.getByRole("alert")).toContainText("broken")

    await panel.getByLabel("Name").fill("Home Budget")
    await expect(panel.getByLabel("Folder id")).toHaveValue("home-budget")
    const newForm = panel.locator("form")
    await newForm.getByRole("button", { name: "Skills" }).click()
    await newForm.getByRole("button", { name: "MCP servers" }).click()
    await expect(newForm.getByRole("button", { name: "Skills" })).toHaveAttribute("aria-pressed", "true")
    await panel.getByRole("button", { name: "Create project" }).click()

    await expect.poll(() => state.created.length).toBe(1)
    expect(state.created[0]).toEqual({ id: "home-budget", name: "Home Budget", inherits: ["skills", "mcp"] })
  })

  test("blocks an invalid folder id before sending", async ({ page }) => {
    const state = await stubProjects(page)
    await page.goto("/settings/projects")
    const panel = page.locator("#projects")
    await panel.getByLabel("Name").fill("!!!")
    await panel.getByRole("button", { name: "Create project" }).click()
    await expect(panel.getByText("Project id must be a kebab-case folder name")).toBeVisible()
    expect(state.created).toEqual([])
  })
})
