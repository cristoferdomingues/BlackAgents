import { expect, test } from "@playwright/test"

import { stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const meeting = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Standup",
  startedAt: "2026-10-21T15:00:00.000Z",
  status: "processing",
  source: "import",
  segments: [{ at: 0, speaker: "others", text: "We ship on Friday." }],
}

const noted = {
  ...meeting,
  status: "ready",
  notes: {
    language: "English",
    summary: "We ship on Friday.",
    decisions: ["Ship on Friday"],
    actionItems: [{ owner: "Ana", task: "Write the note" }],
    openQuestions: [],
    people: ["Ana"],
    suggestions: [{ kind: "skill", name: "ship-note", reason: "The team repeats this" }],
  },
}

test("imports a meeting, shows notes, and sends them to Brain", async ({ page }) => {
  let meetings: object[] = []
  await stubWorkspace(page)
  await stubVerifiedProvider(page)
  await page.route("**/api/meetings", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ json: { success: true, data: meeting } })
    }
    return route.fulfill({ json: { success: true, data: { meetings } } })
  })
  await page.route("**/api/meetings/*/notes", async (route) => {
    meetings = [noted]
    return route.fulfill({ json: { success: true, data: noted } })
  })
  await page.route("**/api/meetings/*/knowledge", async (route) => {
    meetings = [{ ...noted, knowledgeProposalId: "22222222-2222-4222-8222-222222222222" }]
    return route.fulfill({
      json: {
        success: true,
        data: {
          proposalId: "22222222-2222-4222-8222-222222222222",
          file: ".black-agents/knowledge/meeting/2026-10-21-standup-1111.md",
        },
      },
    })
  })

  await page.goto("/meetings")
  await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible()
  await expect(page.getByText("No meetings yet")).toBeVisible()
  await page.getByRole("button", { name: "Import a meeting" }).click()
  await page.getByLabel("Transcript").fill("We ship on Friday.")
  await page.getByRole("button", { name: "Read this meeting" }).click()

  await expect(page.getByRole("heading", { name: "Standup" })).toBeVisible()
  await expect(page.getByText("Notes are in English")).toBeVisible()
  await page.getByRole("button", { name: "Send to Brain" }).click()
  await expect(page.getByRole("link", { name: "Review in Brain" })).toBeVisible()
})

test("asks everyone to agree before it listens", async ({ page }) => {
  await stubWorkspace(page)
  await stubVerifiedProvider(page)
  await page.route("**/api/meetings", async (route) => {
    return route.fulfill({ json: { success: true, data: { meetings: [] } } })
  })

  await page.goto("/meetings")
  await page.getByRole("button", { name: "Start listening" }).first().click()
  const dialog = page.getByRole("dialog")
  const start = dialog.getByRole("button", { name: "Start listening" })
  await expect(start).toBeDisabled()
  await dialog.getByRole("checkbox").check()
  await expect(start).toBeEnabled()
})
