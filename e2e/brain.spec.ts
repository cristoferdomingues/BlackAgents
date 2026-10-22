import { expect, test } from "@playwright/test"

import { stubWorkspace } from "./support/stubs"

const proposal = {
  id: "p1",
  kind: "memory_note",
  agent: "coder",
  title: "Use pnpm",
  rationale: "The user corrected npm to pnpm.",
  content: "The repo uses pnpm",
  source: { kind: "chat", signal: "feedback", rating: "down", comment: "We use pnpm" },
  decision: { by: "feedback" },
  status: "pending",
  createdAt: "2026-10-07T10:00:00.000Z",
}

test.describe("brain", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
  })

  test("shows the empty inbox", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({ json: { success: true, data: { proposals: [], workspaceNotes: [], agents: [] } } })
    )
    await page.goto("/brain")
    await expect(page.getByRole("heading", { name: "Brain", exact: true })).toBeVisible()
    await expect(page.getByText("The inbox is empty", { exact: true })).toBeVisible()
  })

  test("shows a load error", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({ status: 500, json: { success: false, error: "Brain unavailable" } })
    )
    await page.goto("/brain")
    await expect(page.getByText("Brain unavailable")).toBeVisible()
  })

  test("approves an edited proposal and shows the memory", async ({ page }) => {
    let approved = false
    await page.route("**/api/brain", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: approved
            ? {
                proposals: [{ ...proposal, status: "approved", content: "The repo uses pnpm 9" }],
                workspaceNotes: [],
                agents: [{ name: "coder", notes: [{ date: "2026-10-07", text: "The repo uses pnpm 9" }] }],
              }
            : { proposals: [proposal], workspaceNotes: [], agents: [] },
        },
      })
    )
    let decision: unknown
    await page.route("**/api/brain/proposals/p1", async (route) => {
      decision = route.request().postDataJSON()
      approved = true
      await route.fulfill({ json: { success: true, data: { proposal: { ...proposal, status: "approved" } } } })
    })

    await page.goto("/brain")
    await expect(page.getByText("Use pnpm", { exact: true })).toBeVisible()
    await page.getByLabel("Note").fill("The repo uses pnpm 9")
    await page.getByRole("button", { name: "Approve" }).click()

    await expect(page.getByText("The inbox is empty", { exact: true })).toBeVisible()
    expect(decision).toEqual({ action: "approve", edits: { content: "The repo uses pnpm 9" } })
    await page.getByRole("tab", { name: "Memory" }).click()
    await expect(page.getByText("The repo uses pnpm 9")).toBeVisible()
  })

  test("links a new concept only to the related notes you keep", async ({ page }) => {
    const concept = {
      id: "c1",
      kind: "new_concept",
      title: "Drawdown alerts",
      rationale: "The user asked the Assistant to save this as durable knowledge.",
      content: "Alert when portfolio drawdown passes 20 percent.",
      target: { type: "concept", name: "crypto/drawdown-alerts" },
      concept: { type: "Protocol", title: "Drawdown alerts", extra: {} },
      links: [
        { id: "crypto/portfolio-metrics", title: "Portfolio metrics", reason: "Same tag: crypto" },
        { id: "crypto/exchange-fees", title: "Exchange fees", reason: "Both talk about: portfolio" },
      ],
      source: { kind: "assistant", signal: "feedback" },
      decision: { by: "feedback" },
      status: "pending",
      createdAt: "2026-10-21T15:00:00.000Z",
    }
    let approved = false
    let decision: unknown
    await page.route("**/api/brain", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            proposals: approved ? [{ ...concept, status: "approved" }] : [concept],
            workspaceNotes: [],
            agents: [],
          },
        },
      })
    )
    await page.route("**/api/brain/proposals/c1", async (route) => {
      decision = route.request().postDataJSON()
      approved = true
      await route.fulfill({ json: { success: true, data: { proposal: { ...concept, status: "approved" } } } })
    })

    await page.goto("/brain")
    await expect(page.getByText("Link to related notes")).toBeVisible()
    await expect(page.getByText("2 other notes get a link back to this one.")).toBeVisible()
    await page.getByRole("checkbox", { name: /Exchange fees/ }).uncheck()
    await expect(page.getByText("1 other note gets a link back to this one.")).toBeVisible()
    await page.getByRole("button", { name: "Approve" }).click()

    await expect(page.getByText("The inbox is empty", { exact: true })).toBeVisible()
    expect(decision).toEqual({ action: "approve", edits: { links: ["crypto/portfolio-metrics"] } })
  })

  test("explains how it works once, then remembers it was closed", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({ json: { success: true, data: { proposals: [], workspaceNotes: [], agents: [] } } })
    )
    await page.goto("/brain")
    const intro = page.getByRole("region", { name: "How the Brain works" })
    await expect(intro).toContainText("1. You give feedback")
    await intro.getByRole("button", { name: "Got it" }).click()
    await expect(intro).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole("heading", { name: "Brain", exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "How the Brain works" })).toHaveCount(0)
    await page.getByRole("button", { name: "How it works" }).click()
    await expect(page.getByRole("region", { name: "How the Brain works" })).toBeVisible()
  })

  test("explains empty memory with examples and links the inbox to feedback", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({ json: { success: true, data: { proposals: [], workspaceNotes: [], agents: [] } } })
    )
    await page.goto("/brain")
    await expect(page.getByRole("link", { name: "Rate replies in the Assistant" })).toHaveAttribute("href", "/chat")
    await page.getByRole("tab", { name: "Memory" }).click()
    await expect(page.getByText("They are added to every chat and workflow run automatically.", { exact: false })).toBeVisible()
    await expect(page.getByText("This repo uses pnpm, not npm.")).toBeVisible()
  })

  test("says where a suggestion came from and what approve does", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            proposals: [proposal],
            workspaceNotes: [{ date: "2026-10-06", text: "Answer briefly." }],
            agents: [],
          },
        },
      })
    )
    await page.goto("/brain")
    await expect(page.getByRole("tab", { name: "Inbox (1)" })).toBeVisible()
    await expect(page.getByText("From your thumbs down in the Assistant.")).toBeVisible()
    await expect(page.getByText("Approve adds this note to the memory of the coder agent.")).toBeVisible()
    await expect(page.getByText("Only coder", { exact: true })).toBeVisible()
    await page.getByRole("tab", { name: "Memory (1)" }).click()
    await expect(page.getByText("All agents", { exact: true })).toBeVisible()
    await expect(page.getByRole("progressbar", { name: "Memory space used" })).toBeVisible()
    await expect(page.getByText("15 / 3,000 characters")).toBeVisible()
  })

  test("shows and approves a workflow re-verification request", async ({ page }) => {
    const reverify = {
      id: "rv1",
      kind: "reverify_concept",
      title: "Re-verify Workflows",
      rationale: "Generated after its latest human verification.",
      content: "Generated after its latest human verification.",
      target: { type: "concept", name: "architecture/workflows" },
      source: { kind: "run", signal: "self", runId: "run-1" },
      decision: { by: "feedback" },
      status: "pending",
      createdAt: "2026-10-19T13:00:00.000Z",
    }
    let approved = false
    let decision: unknown
    await page.route("**/api/brain", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            proposals: approved ? [{ ...reverify, status: "approved" }] : [reverify],
            workspaceNotes: [],
            agents: [],
          },
        },
      })
    )
    await page.route("**/api/brain/proposals/rv1", async (route) => {
      decision = route.request().postDataJSON()
      approved = true
      await route.fulfill({
        json: { success: true, data: { proposal: { ...reverify, status: "approved" } } },
      })
    })

    await page.goto("/brain")
    await expect(page.getByText("Re-verify concept")).toBeVisible()
    await expect(page.getByText("Why this needs review")).toBeVisible()
    await expect(page.getByText("Generated after its latest human verification.")).toBeVisible()
    await expect(
      page.getByText(
        "Approve keeps architecture/workflows unchanged and records that you reviewed it now."
      )
    ).toBeVisible()
    await expect(page.getByRole("textbox")).toHaveCount(0)
    await page.getByRole("button", { name: "Approve" }).click()
    await expect(page.getByText("The inbox is empty")).toBeVisible()
    expect(decision).toEqual({ action: "approve", edits: {} })
  })

  test("previews an OKF folder and sends a concept to the inbox", async ({ page }) => {
    let proposals: unknown[] = []
    await page.route("**/api/brain", (route) =>
      route.fulfill({
        json: { success: true, data: { proposals, workspaceNotes: [], agents: [] } },
      })
    )
    await page.route("**/api/knowledge/import", async (route) => {
      const body = route.request().postDataJSON() as { action: string; id?: string }
      if (body.action === "queue") {
        proposals = [
          {
            ...proposal,
            id: "c1",
            kind: "new_concept",
            agent: undefined,
            title: "Revenue",
            target: { type: "concept", name: "metrics/revenue" },
            source: { kind: "import", signal: "feedback" },
            content: "Revenue.",
          },
        ]
        await route.fulfill({ json: { success: true, data: { proposalId: "c1", title: "Revenue" } } })
        return
      }
      await route.fulfill({
        json: {
          success: true,
          data: {
            path: "/tmp/bundle",
            version: "0.2",
            levels: [
              {
                dir: "",
                sections: [
                  {
                    heading: "Metrics",
                    entries: [
                      { title: "Revenue", description: "Recognized revenue.", kind: "concept", target: "metrics/revenue" },
                    ],
                  },
                ],
              },
            ],
            orphans: [],
            missing: [],
          },
        },
      })
    })

    await page.goto("/brain")
    await page.getByRole("tab", { name: "Knowledge" }).click()
    await expect(page.getByText("A preview only reads the folder.")).toBeVisible()
    await page.getByLabel("Bundle folder").fill("/tmp/bundle")
    await page.getByRole("button", { name: "Preview" }).click()
    await expect(page.getByText("Nothing has been saved.")).toBeVisible()
    await expect(page.getByText("metrics/revenue")).toBeVisible()
    await page.getByRole("button", { name: "Add to inbox" }).click()
    await expect(page.getByText("is in the Inbox")).toBeVisible()
    await page.getByRole("tab", { name: /Inbox/ }).click()
    await expect(page.getByText("From an OKF bundle you previewed.")).toBeVisible()
    await expect(page.getByText("Approve saves metrics/revenue into .black-agents/knowledge/")).toBeVisible()
  })

  test("reads a saved concept in the knowledge library", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({ json: { success: true, data: { proposals: [], workspaceNotes: [], agents: [] } } })
    )
    await page.route(/\/api\/knowledge(?:\?|$)/, async (route) => {
      const url = new URL(route.request().url())
      const id = url.searchParams.get("id")
      if (id === "overview/overview") {
        await route.fulfill({
          json: {
            success: true,
            data: {
              id: "overview/overview",
              title: "Overview",
              description: "What BlackAgents is",
              type: "Reference",
              trust: "human-reviewed",
              folder: "overview",
              tags: [],
              stale: false,
              status: "stable",
              body: "# Overview\n\nBlackAgents is local-first.\n\nSee [the stack](./tech-stack.md).\n\n## Goals\n\nStay local.\n\n## Stack\n\nNext.js.",
              sources: [],
              generatedBy: "process:obsidian-import",
              file: ".black-agents/knowledge/overview/overview.md",
            },
          },
        })
        return
      }
      await route.fulfill({
        json: {
          success: true,
          data: {
            concepts: [
              {
                id: "overview/overview",
                title: "Overview",
                description: "What BlackAgents is",
                type: "Reference",
                trust: "human-reviewed",
                folder: "overview",
                tags: [],
                stale: false,
                status: "stable",
              },
              {
                id: "overview/tech-stack",
                title: "Tech Stack",
                description: "Tools used by BlackAgents",
                type: "Reference",
                trust: "human-reviewed",
                folder: "overview",
                tags: [],
                stale: false,
                status: "stable",
              },
            ],
            links: [{ source: "overview/overview", target: "overview/tech-stack" }],
          },
        },
      })
    })

    await page.goto("/brain")
    await page.getByRole("tab", { name: "Knowledge" }).click()
    await expect(page.getByText("No saved concepts yet")).toHaveCount(0)
    await expect(page.getByText("2 saved concepts")).toBeVisible()
    await expect(page.getByRole("button", { name: "Check files" })).toBeVisible()
    // The first concept opens without a click, and its repeated "# Overview" line is not shown twice.
    await expect(page.getByRole("heading", { name: "Overview" })).toHaveCount(1)
    await expect(page.getByText("BlackAgents is local-first.")).toBeVisible()
    await expect(page.getByText("Reviewed by you")).toBeVisible()
    await expect(page.getByText("Imported from Obsidian")).toBeVisible()

    await page.getByRole("button", { name: "Hide list" }).click()
    await expect(page.getByRole("textbox", { name: "Search concepts" })).toHaveCount(0)
    const outline = page.getByRole("navigation", { name: "On this page" })
    await expect(outline.getByRole("button", { name: "Goals" })).toBeVisible()
    await expect(outline.getByRole("button", { name: "Stack" })).toBeVisible()
    await page.getByRole("button", { name: "Show list" }).click()
    await page.getByRole("button", { name: /Overview/ }).click()
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()

    await page.getByRole("button", { name: "Graph" }).click()
    await expect(page.getByRole("region", { name: "Knowledge graph" })).toBeVisible()
    await expect(page.getByText("2 concepts · 1 links")).toBeVisible()
    await expect(page.getByRole("list", { name: "Concepts in graph" })).toContainText("Tech Stack")
    await page.getByRole("button", { name: "List" }).click()
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()
  })

  test("sends a memory note to the inbox as knowledge", async ({ page }) => {
    await page.route("**/api/brain", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            proposals: [],
            workspaceNotes: [{ date: "2026-10-01", text: "Repo uses pnpm" }],
            agents: [],
          },
        },
      })
    )
    await page.route("**/api/brain/promote", (route) =>
      route.fulfill({
        json: { success: true, data: { proposalId: "p2", title: "Repo uses pnpm", kind: "new_concept" } },
      })
    )
    await page.goto("/brain")
    await page.getByRole("tab", { name: "Memory" }).click()
    await page.getByRole("button", { name: "Save as knowledge" }).click()
    await page.getByLabel("Concept id").fill("tools/pnpm")
    await page.getByRole("button", { name: "Add to inbox" }).click()
    await expect(page.getByText("is in the Inbox")).toBeVisible()
    await expect(page.getByText("The note stays in Memory until you approve")).toBeHidden()
  })
})
