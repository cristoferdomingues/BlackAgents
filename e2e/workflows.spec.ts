import { expect, test } from "@playwright/test"

import { fulfillSse, sse, stubVerifiedProvider, stubWorkspace, WORKSPACE } from "./support/stubs"

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

  test("saves the MCP servers a step may use", async ({ page }) => {
    let saved: { steps?: Array<{ mcpServers?: string[] }> } | undefined
    await page.route("**/api/mcp", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: { servers: [{ name: "github", status: "ready", toolCount: 1 }], totalTools: 1 },
        },
      })
    )
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
    await page.getByRole("combobox", { name: "Agent" }).click()
    await page.getByRole("option", { name: "planner" }).click()
    await page.getByRole("radio", { name: "None", exact: true }).click()
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page).toHaveURL(/\/workflows\/review-line$/)
    expect(saved?.steps?.[0]?.mcpServers).toEqual([])

    await page.goto("/workflows/new")
    await page.getByLabel("Name").fill("review-line")
    await page.getByRole("combobox", { name: "Agent" }).click()
    await page.getByRole("option", { name: "planner" }).click()
    await page.getByRole("radio", { name: "Choose", exact: true }).click()
    await page.getByRole("button", { name: "github", exact: true }).click()
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page).toHaveURL(/\/workflows\/review-line$/)
    expect(saved?.steps?.[0]?.mcpServers).toEqual(["github"])
  })

  test("saves a review step", async ({ page }) => {
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
    await page.getByRole("combobox", { name: "Agent" }).click()
    await page.getByRole("option", { name: "planner" }).click()
    await page.getByRole("radio", { name: /Review earlier work/ }).click()
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page).toHaveURL(/\/workflows\/review-line$/)
    expect(saved).toMatchObject({ steps: [{ id: "step-1", agent: "planner", review: true, gate: false }] })
  })

  test("shows a review step's verdict", async ({ page }) => {
    await page.route("**/api/runs/run-1/events", (route) =>
      fulfillSse(route, [
        [
          "run",
          run({
            steps: [
              { id: "plan", agent: "planner", status: "succeeded", attempts: 1, output: "Built", toolExecutions: [], filesChanged: [] },
              {
                id: "review",
                agent: "planner",
                status: "succeeded",
                attempts: 1,
                output: "No tests.\n\nVERDICT: reject",
                verdict: "reject",
                toolExecutions: [],
                filesChanged: [],
              },
            ],
          }),
        ],
      ])
    )

    await page.goto("/workflows/runs/run-1")
    await expect(page.getByText("Review: rejected")).toBeVisible()
    await expect(page.getByText("Review: approved")).toHaveCount(0)
  })

  test("saves a login step without putting the password in the workflow", async ({ page }) => {
    let savedWorkflow: { steps?: Array<{ login?: boolean }> } | undefined
    let savedSecrets: { secrets?: Record<string, string> } | undefined
    await page.route("**/api/browser/secrets", async (route) => {
      savedSecrets = route.request().postDataJSON() as { secrets?: Record<string, string> }
      await route.fulfill({ json: { success: true, data: { saved: true, secretStatuses: {}, ids: [] } } })
    })
    await page.route("**/api/workflows", async (route) => {
      savedWorkflow = route.request().postDataJSON() as { steps?: Array<{ login?: boolean }> }
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
    await page.getByRole("combobox", { name: "Agent" }).click()
    await page.getByRole("option", { name: "planner" }).click()
    await page.getByRole("radio", { name: /Sign in to a website/ }).click()
    await page.getByLabel("Username").fill("ada")
    await page.getByLabel("Password").fill("secret-pass")
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page).toHaveURL(/\/workflows\/review-line$/)
    expect(savedWorkflow?.steps?.[0]?.login).toBe(true)
    expect(JSON.stringify(savedWorkflow)).not.toContain("secret-pass")
    expect(savedSecrets?.secrets).toMatchObject({
      "browser.review-line.step-1.username": "ada",
      "browser.review-line.step-1.password": "secret-pass",
    })
  })

  test("asks for a username and password when a run needs login", async ({ page }) => {
    let posted: unknown
    await page.route("**/api/runs/run-1/events", (route) =>
      fulfillSse(route, [[
        "run",
        run({
          status: "waiting_login",
          pendingLogin: {
            id: "login-1",
            stepId: "plan",
            usernameSecret: "browser.review-line.plan.username",
            passwordSecret: "browser.review-line.plan.password",
            reason: "This step needs a username and password before it can sign in.",
          },
          steps: [
            {
              id: "plan",
              agent: "planner",
              status: "waiting_login",
              attempts: 1,
              toolExecutions: [],
              filesChanged: [],
            },
          ],
        }),
      ]])
    )
    await page.route("**/api/runs/run-1/login", async (route) => {
      posted = route.request().postDataJSON()
      await route.fulfill({ json: { success: true, data: { continued: true } } })
    })

    await page.goto("/workflows/runs/run-1")
    await expect(page.getByTestId("login-card")).toBeVisible()
    await page.getByLabel("Username").fill("ada")
    await page.getByLabel("Password").fill("secret-pass")
    await page.getByRole("button", { name: "Save and continue" }).click()
    expect(posted).toEqual({ username: "ada", password: "secret-pass" })
  })

  test("shows closed steps as a flow and adds a step between two", async ({ page }) => {
    let saved: { steps?: Array<{ id: string; input: string; tools?: string[] }> } | undefined
    await page.route("**/api/workflows", async (route) => {
      saved = route.request().postDataJSON() as typeof saved
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
    const first = page.getByRole("button", { name: "Step 1: step-1" })
    await expect(first).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByText("The first step gets the task.")).toBeVisible()
    await page.getByRole("combobox", { name: "Agent" }).click()
    await page.getByRole("option", { name: "planner" }).click()
    await page.getByRole("radio", { name: /Read and write/ }).click()
    await expect(page.getByLabel("Allow file writes without asking")).toBeVisible()

    await page.getByRole("button", { name: "Add a step at the end" }).click()
    await expect(first).toHaveAttribute("aria-expanded", "false")
    await expect(first).toContainText("Read and write")
    await page.getByRole("radio", { name: /Review earlier work/ }).click()
    await expect(page.getByText("Gets every earlier result")).toBeVisible()

    await page.getByRole("button", { name: "Add step here" }).click()
    await expect(page.getByRole("button", { name: "Step 2: step-3" })).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByRole("button", { name: "Step 3: step-2" })).toContainText("Review")

    await page.getByRole("button", { name: "Save" }).click()
    await expect(page).toHaveURL(/\/workflows\/review-line$/)
    expect(saved?.steps?.map((s) => s.id)).toEqual(["step-1", "step-3", "step-2"])
    expect(saved?.steps?.[0]?.tools).toEqual(["fs_list", "fs_read", "fs_write"])
    expect(saved?.steps?.[2]?.input).toBe("all")
  })

  test("opens the step a save error points at", async ({ page }) => {
    await page.goto("/workflows/new")
    await page.getByLabel("Name").fill("review-line")
    await page.getByRole("combobox", { name: "Agent" }).click()
    await page.getByRole("option", { name: "planner" }).click()
    await page.getByRole("button", { name: "Add a step at the end" }).click()
    await page.getByLabel("Step id").fill("Bad Id!")
    await page.getByRole("button", { name: "Step 1: step-1" }).click()
    await page.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Step 2 (id): Step ids use kebab-case")).toBeVisible()
    await expect(page.getByRole("button", { name: /^Step 2:/ })).toHaveAttribute("aria-expanded", "true")
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

  test("renders a step result as markdown", async ({ page }) => {
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
                output: "## Fees\n\n**APR** is 12%.\n\n- Pool is in range",
                toolExecutions: [],
                filesChanged: [],
              },
            ],
          }),
        ],
      ])
    )

    await page.goto("/workflows/runs/run-1")
    await expect(page.getByRole("heading", { name: "Fees" })).toBeVisible()
    await expect(page.locator("strong", { hasText: "APR" })).toBeVisible()
    await expect(page.getByRole("list", { name: "Steps" }).getByRole("list").getByText("Pool is in range")).toBeVisible()
    await expect(page.getByText("**APR**")).toHaveCount(0)
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

  test("shows live step activity, stuck warning, and the timeline tab", async ({ page }) => {
    const staleAt = new Date(Date.now() - 120_000).toISOString()
    const live = run({
      status: "running",
      finishedAt: undefined,
      report: undefined,
      limits: { stepTimeoutMinutes: 30, runTimeoutMinutes: 180, maxRetries: 1 },
      steps: [
        {
          id: "plan",
          agent: "planner",
          status: "running",
          attempts: 1,
          toolExecutions: [],
          filesChanged: [],
          startedAt: staleAt,
          turn: 4,
          maxTurns: 25,
          lastActivityAt: staleAt,
          activity: { kind: "waiting_model", label: "Waiting for model…", since: staleAt },
          recent: [
            { at: staleAt, text: "Turn 4 / 25" },
            { at: staleAt, text: "Tool safety limit: accepted 20 of 2994 calls" },
          ],
        },
      ],
    })
    await page.route("**/api/runs/run-1/events", async (route) => {
      // Keep the stream open so the UI stays "Live" (a closed stream reconnects).
      const body =
        sse([
          ["run", live],
          ["ping", { serverTime: new Date().toISOString() }],
        ]) + ": keep-alive\n\n"
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
        },
        body,
      })
    })
    await page.route("**/api/runs/run-1/audit**", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            runId: "run-1",
            events: [
              {
                type: "run_started",
                ts: "2026-10-19T12:00:00.000Z",
                workflow: "review-line",
                task: "Ship it",
              },
              {
                type: "llm_response",
                ts: "2026-10-19T12:00:10.000Z",
                stepId: "plan",
                attempt: 1,
                turn: 3,
                model: "gpt-4o-mini",
                provider: "openai",
                content: "Working…",
                durationMs: 1200,
              },
              {
                type: "tool_limit",
                ts: "2026-10-19T12:00:11.000Z",
                stepId: "plan",
                attempt: 1,
                turn: 3,
                requested: 2994,
                accepted: 20,
                duplicates: 2924,
                reason: "per_turn",
              },
            ],
          },
        },
      })
    )

    await page.goto("/workflows/runs/run-1")
    await expect(page.getByTestId("run-connection")).toContainText("Live")
    await expect(page.getByTestId("step-turn")).toContainText("Turn 4 / 25")
    await expect(page.getByTestId("step-action")).toContainText("Waiting for model")
    await expect(page.getByTestId("step-stale")).toContainText("No activity for")
    await expect(page.getByText("Tool safety limit: accepted 20 of 2994 calls")).toBeVisible()

    await page.getByRole("tab", { name: "Timeline" }).click()
    await expect(page.getByTestId("run-timeline")).toBeVisible()
    await expect(page.getByText("Run started · review-line")).toBeVisible()
    await expect(page.getByText("Model reply", { exact: false })).toBeVisible()
    await expect(page.getByText("Tool safety limit · accepted 20 of 2994")).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Audit log pages" })).toHaveCount(0)
  })

  test("pages a long audit log", async ({ page }) => {
    await page.route("**/api/runs/run-1/events", (route) => fulfillSse(route, [["run", run()]]))
    await page.route("**/api/runs/run-1/audit**", (route) => {
      const url = new URL(route.request().url())
      const offset = Number(url.searchParams.get("offset") ?? 0)
      const limit = Number(url.searchParams.get("limit") ?? 50)
      const total = 51
      const count = Math.max(0, Math.min(limit, total - offset))
      const events = Array.from({ length: count }, (_, index) => ({
        type: "tool_call",
        ts: "2026-10-19T12:00:00.000Z",
        stepId: "plan",
        id: `call-${offset + index}`,
        tool: `tool-${offset + index}`,
        server: "builtin",
        risk: "read",
        args: {},
      }))
      return route.fulfill({
        json: { success: true, data: { runId: "run-1", events, total, offset, limit } },
      })
    })

    await page.goto("/workflows/runs/run-1")
    await page.getByRole("tab", { name: "Timeline" }).click()
    const timeline = page.getByTestId("run-timeline")
    await expect(timeline.getByText("Showing 1–50 of 51")).toBeVisible()
    await expect(timeline.getByText("Tool call · tool-0")).toBeVisible()
    await expect(timeline.getByText("Tool call · tool-50")).toHaveCount(0)

    await timeline.getByRole("button", { name: "Next", exact: true }).click()
    await expect(timeline.getByText("Showing 51–51 of 51")).toBeVisible()
    await expect(timeline.getByText("Tool call · tool-50")).toBeVisible()
    await expect(timeline.getByText("Tool call · tool-0")).toHaveCount(0)
    await expect(timeline.getByRole("button", { name: "Next", exact: true })).toBeDisabled()

    await timeline.getByRole("button", { name: "Previous", exact: true }).click()
    await expect(timeline.getByText("Showing 1–50 of 51")).toBeVisible()
  })
})
