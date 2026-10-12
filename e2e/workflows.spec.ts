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
    await expect(page.getByText("from step")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Good answer" })).toBeVisible()
  })

  test("sets a step model, shows where it comes from, and keeps it", async ({ page }) => {
    let current = workflow
    const saves: unknown[] = []
    await page.route("**/api/workflows/review-line", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as typeof workflow
        saves.push(body)
        current = body
        await route.fulfill({ json: { success: true, data: { workflow: current } } })
        return
      }
      await route.fulfill({ json: { success: true, data: { workflow: current, active: false } } })
    })
    await page.route("**/api/workflows/review-line/runs", (route) =>
      route.fulfill({ json: { success: true, data: { runs: [] } } })
    )

    await page.goto("/workflows/review-line")
    const summary = page.getByRole("button", { name: /Model:/ })
    await expect(summary).toContainText("Assistant default")
    await summary.click()
    await page.getByRole("combobox", { name: "Model provider" }).click()
    const modelsReady = page.waitForResponse((res) => res.url().includes("/api/providers/models"))
    await page.getByRole("option", { name: "OpenAI" }).click()
    await modelsReady
    await page.getByRole("button", { name: "Choose model" }).click()
    await page.getByRole("menuitem", { name: "gpt-4o-mini" }).click()
    await expect(summary).toContainText("gpt-4o-mini · from step")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Workflow saved")).toBeVisible()
    expect(saves[0]).toMatchObject({
      steps: [{ id: "plan", agent: "planner", model: "gpt-4o-mini", provider: "openai" }],
    })

    await page.reload()
    await expect(page.getByRole("button", { name: /Model:/ })).toContainText("gpt-4o-mini · from step")
  })

  test("shows the model a step used", async ({ page }) => {
    await page.route("**/api/runs/run-1/events", (route) =>
      fulfillSse(route, [
        [
          "run",
          run({
            steps: [
              {
                id: "plan",
                agent: "planner",
                status: "succeeded",
                attempts: 1,
                output: "Planned with a fast model",
                toolExecutions: [],
                filesChanged: [],
                provider: "openai",
                model: "gpt-4o-mini",
                modelSource: "step",
                task: "fast",
              },
              {
                id: "review",
                agent: "planner",
                status: "succeeded",
                attempts: 1,
                output: "Reviewed on the agent model",
                toolExecutions: [],
                filesChanged: [],
                provider: "anthropic",
                model: "claude-sonnet-4-20250514",
                modelSource: "agent",
              },
            ],
          }),
        ],
      ])
    )

    await page.goto("/workflows/runs/run-1")
    await expect(page.getByText("OpenAI · gpt-4o-mini · from step · task:fast")).toBeVisible()
    await expect(page.getByText("Anthropic · claude-sonnet-4-20250514 · from agent")).toBeVisible()
  })

  test("shows the agent model when the step inherits, and keeps a task kind", async ({ page }) => {
    await page.route("**/api/artifacts", (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      return route.fulfill({
        json: {
          success: true,
          data: [
            {
              name: "planner",
              type: "agent",
              platform: "cursor",
              description: "Plans work.",
              frontmatter: { name: "planner", description: "Plans work.", model: "gpt-4o", provider: "openai" },
              body: "Plan.",
              relativePath: ".cursor/agents/planner.md",
            },
          ],
        },
      })
    })
    await page.route("**/api/settings/ai", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            settings: {
              assistant: { maxToolTurns: 8, autoApproveFileWrites: false },
              jev: { enabled: false, provider: "auto", openRouterKeySource: "reuse" },
              models: { fast: { provider: "openai", model: "gpt-4o-mini" } },
            },
          },
        },
      })
    )
    let current = workflow
    const saves: unknown[] = []
    await page.route("**/api/workflows/review-line", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as typeof workflow
        saves.push(body)
        current = body
        await route.fulfill({ json: { success: true, data: { workflow: current } } })
        return
      }
      await route.fulfill({ json: { success: true, data: { workflow: current, active: false } } })
    })
    await page.route("**/api/workflows/review-line/runs", (route) =>
      route.fulfill({ json: { success: true, data: { runs: [] } } })
    )

    await page.goto("/workflows/review-line")
    const summary = page.getByRole("button", { name: /Model:/ })
    await expect(summary).toContainText("gpt-4o · from agent")
    await summary.click()
    const settingsReady = page.waitForResponse((res) => res.url().includes("/api/settings/ai"))
    await page.getByRole("combobox", { name: "Model provider" }).click()
    await page.getByRole("option", { name: "Fast" }).click()
    await settingsReady
    await expect(summary).toContainText("task:fast → gpt-4o-mini (OpenAI) · from step")
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Workflow saved")).toBeVisible()
    expect(saves[0]).toMatchObject({ steps: [{ id: "plan", agent: "planner", model: "task:fast" }] })
    expect((saves[0] as { steps: Array<{ provider?: string }> }).steps[0]?.provider).toBeUndefined()

    const reloaded = page.waitForResponse(
      (res) => res.url().includes("/api/settings/ai") && !res.url().includes("/models")
    )
    await page.reload()
    await reloaded
    await expect(page.getByRole("button", { name: /Model:/ })).toContainText(
      "task:fast → gpt-4o-mini (OpenAI) · from step"
    )
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
