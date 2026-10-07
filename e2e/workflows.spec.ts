import { expect, test } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace, WORKSPACE } from "./support/stubs"

const workflow = {
  name: "review-line",
  description: "Plan then build",
  task: "Ship it",
  trigger: { type: "manual" },
  steps: [
    { id: "plan", agent: "planner", instructions: "", input: "previous", allowWrites: false, maxTurns: 6, gate: false },
  ],
  limits: { stepTimeoutMinutes: 10, runTimeoutMinutes: 60, maxRetries: 1 },
  selfAssess: false,
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    workflow: "review-line",
    workspaceRoot: WORKSPACE.path,
    status: "succeeded",
    trigger: "manual",
    task: "Ship it",
    createdAt: "2026-10-07T10:00:00.000Z",
    startedAt: "2026-10-07T10:00:01.000Z",
    finishedAt: "2026-10-07T10:01:00.000Z",
    report: "All planned",
    pendingApproval: null,
    steps: [
      {
        id: "plan",
        agent: "planner",
        status: "succeeded",
        attempts: 1,
        output: "All planned",
        toolExecutions: [],
        filesChanged: ["docs/plan.md"],
      },
    ],
    ...overrides,
  }
}

test.describe("workflows", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page, [{ name: "planner", type: "agent", description: "Plans work." }])
    await stubVerifiedProvider(page)
    await page.route("**/api/approvals", (route) => route.fulfill({ json: { success: true, data: { approvals: [] } } }))
  })

  test("shows the empty state", async ({ page }) => {
    await page.route("**/api/workflows", (route) => route.fulfill({ json: { success: true, data: { workflows: [] } } }))
    await page.goto("/workflows")
    await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible()
    await expect(page.getByText("No workflows yet.", { exact: false })).toBeVisible()
  })

  test("shows a load error with retry", async ({ page }) => {
    let failing = true
    await page.route("**/api/workflows", (route) => {
      return failing
        ? route.fulfill({ status: 500, json: { success: false, error: "Disk unavailable" } })
        : route.fulfill({ json: { success: true, data: { workflows: [] } } })
    })
    await page.goto("/workflows")
    await expect(page.getByText("Disk unavailable")).toBeVisible()
    failing = false
    await page.getByRole("button", { name: "Retry" }).click()
    await expect(page.getByText("No workflows yet.", { exact: false })).toBeVisible()
  })

  test("builds a workflow", async ({ page }) => {
    let saved: unknown
    await page.route("**/api/workflows", async (route) => {
      saved = route.request().postDataJSON()
      await route.fulfill({ status: 201, json: { success: true, data: { workflow } } })
    })
    await page.route("**/api/workflows/review-line", (route) =>
      route.fulfill({ json: { success: true, data: { workflow, active: false } } })
    )
    await page.route("**/api/workflows/review-line/runs", (route) =>
      route.fulfill({ json: { success: true, data: { runs: [] } } })
    )

    await page.goto("/workflows/new")
    await page.getByLabel("Name").fill("review-line")
    await page.getByLabel("Default task").fill("Ship it")
    await page.getByRole("combobox", { name: "Agent" }).click()
    await page.getByRole("option", { name: "planner" }).click()
    await page.getByLabel("Jev checks the result").click()
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page).toHaveURL(/\/workflows\/review-line$/)
    expect(saved).toMatchObject({ name: "review-line", task: "Ship it", steps: [{ id: "step-1", agent: "planner", gate: true }] })
  })

  test("blocks saving an invalid workflow", async ({ page }) => {
    await page.goto("/workflows/new")
    await page.getByLabel("Name").fill("Bad Name")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("name: Use kebab-case", { exact: false })).toBeVisible()
  })

  test("runs a workflow from the list and shows the result", async ({ page }) => {
    await page.route("**/api/workflows", (route) =>
      route.fulfill({ json: { success: true, data: { workflows: [{ workflow, lastRun: null, active: false }] } } })
    )
    await page.route("**/api/workflows/review-line/runs", (route) =>
      route.fulfill({ status: 201, json: { success: true, data: { run: run({ status: "queued" }) } } })
    )
    await page.route("**/api/runs/run-1/events", (route) => fulfillSse(route, [["run", run()]]))

    await page.goto("/workflows")
    await page.getByRole("button", { name: "Run review-line" }).click()

    await expect(page).toHaveURL(/\/workflows\/runs\/run-1$/)
    await expect(page.getByText("All planned").first()).toBeVisible()
    await expect(page.getByText("docs/plan.md")).toBeVisible()
    await expect(page.getByRole("button", { name: "Good answer" })).toBeVisible()
  })

  test("approves a tool call from the run view", async ({ page }) => {
    const approval = {
      id: "ap-1",
      tool: "shell_run",
      server: "builtin",
      risk: "exec",
      summary: "npm test",
      args: { command: "npm", args: ["test"] },
      scope: { kind: "run", runId: "run-1", stepId: "plan", workflow: "review-line" },
      createdAt: "2026-10-07T10:00:05.000Z",
    }
    const waiting = run({
      status: "waiting_approval",
      finishedAt: undefined,
      report: undefined,
      pendingApproval: approval,
      steps: [{ id: "plan", agent: "planner", status: "waiting_approval", attempts: 1, toolExecutions: [], filesChanged: [] }],
    })
    await page.route("**/api/runs/run-1/events", (route) => fulfillSse(route, [["run", waiting]]))
    let decision: unknown
    await page.route("**/api/approvals/ap-1", async (route) => {
      decision = route.request().postDataJSON()
      await route.fulfill({ json: { success: true, data: { id: "ap-1", approved: true, remember: false } } })
    })

    await page.goto("/workflows/runs/run-1")
    const card = page.getByRole("alert", { name: "Approval needed for shell_run" })
    await expect(card).toBeVisible()
    await expect(page.getByRole("button", { name: "Cancel run" })).toBeVisible()
    await card.getByRole("button", { name: "Approve", exact: true }).click()
    await expect.poll(() => decision).toMatchObject({ approved: true })
  })
})
