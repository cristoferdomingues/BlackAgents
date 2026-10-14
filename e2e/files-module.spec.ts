import { expect, test } from "@playwright/test"

import type { WorkspaceFile } from "@/lib/files/schema"
import { stubVerifiedProvider, stubWorkspace, WORKSPACE } from "./support/stubs"

const SAMPLE_FILE: WorkspaceFile = {
  name: "october-invoice",
  originalName: "Invoice_Oct_2026.pdf",
  mimeType: "application/pdf",
  size: 4096,
  kind: "pdf",
  description: "Monthly invoice for expense form",
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
  relativePath: ".black-agents/files/october-invoice/Invoice_Oct_2026.pdf",
  absolutePath: `${WORKSPACE.path}/.black-agents/files/october-invoice/Invoice_Oct_2026.pdf`,
}

test.describe("Media & Files module, @file mentions, and Workflow step files", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page, [{ name: "planner", type: "agent", description: "Plans work." }])
    await stubVerifiedProvider(page)
  })

  test("uploads, edits note, and deletes a file on /files", async ({ page }) => {
    let currentFiles: WorkspaceFile[] = [SAMPLE_FILE]
    await page.route("**/api/files", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { originalName: string }
        const created = {
          ...SAMPLE_FILE,
          name: "company-logo",
          originalName: body.originalName,
          mimeType: "image/png",
          kind: "image" as const,
          description: "",
        }
        currentFiles = [created, ...currentFiles]
        await route.fulfill({ status: 201, json: { success: true, data: { file: created } } })
        return
      }
      await route.fulfill({ json: { success: true, data: { files: currentFiles } } })
    })

    await page.route("**/api/files/october-invoice", async (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON() as { description: string }
        const updated = { ...SAMPLE_FILE, description: body.description }
        currentFiles = currentFiles.map((f) => (f.name === "october-invoice" ? updated : f))
        await route.fulfill({ json: { success: true, data: { file: updated } } })
        return
      }
      if (route.request().method() === "DELETE") {
        currentFiles = currentFiles.filter((f) => f.name !== "october-invoice")
        await route.fulfill({ json: { success: true, data: { deleted: true } } })
        return
      }
      await route.fulfill({ json: { success: true, data: { file: SAMPLE_FILE } } })
    })

    await page.goto("/files")
    await expect(page.getByRole("heading", { name: "Media & Files" })).toBeVisible()
    const card = page.getByTestId("file-card-october-invoice")
    await expect(card).toContainText("@file:october-invoice")
    await expect(card).toContainText("Invoice_Oct_2026.pdf")

    // Edit note
    const noteInput = card.getByLabel("Agent note (optional)")
    await noteInput.fill("Updated receipt note")
    await card.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("File note saved")).toBeVisible()

    // Upload a new file
    await page.getByTestId("files-upload-input").setInputFiles({
      name: "Company_Logo.png",
      mimeType: "image/png",
      buffer: Buffer.from("png-bytes"),
    })
    await expect(page.getByTestId("file-card-company-logo")).toBeVisible()

    // Delete initial file
    await card.getByRole("button", { name: "Delete october-invoice" }).click()
    await expect(page.getByTestId("file-card-october-invoice")).toHaveCount(0)
  })

  test("mentions @file:<name> and picks workspace files in Assistant", async ({ page }) => {
    await page.route("**/api/workflows", (route) =>
      route.fulfill({ json: { success: true, data: { workflows: [] } } })
    )
    await page.route("**/api/files", (route) =>
      route.fulfill({ json: { success: true, data: { files: [SAMPLE_FILE] } } })
    )

    await page.goto("/chat")
    const input = page.getByRole("textbox", { name: "Message assistant" })
    await expect(input).toBeEnabled()

    // Type @oct to see the file in the mention menu
    await input.pressSequentially("Upload @oct")
    const option = page.getByRole("option", { name: /october-invoice/ })
    await expect(option).toBeVisible()
    await option.click()
    await expect(input).toHaveValue("Upload @file:october-invoice ")

    // Or pick from the Workspace files dialog button
    await input.fill("")
    await page.getByRole("button", { name: "Workspace files" }).click()
    await expect(page.getByRole("dialog")).toContainText("Invoice_Oct_2026.pdf")
    await page.getByRole("option", { name: /@file:october-invoice/ }).click()
    await expect(input).toHaveValue("@file:october-invoice ")
  })

  test("binds files to a workflow step and overrides them at run time", async ({ page }) => {
    await page.route("**/api/files", (route) =>
      route.fulfill({ json: { success: true, data: { files: [SAMPLE_FILE] } } })
    )
    let savedWorkflow: unknown
    await page.route("**/api/workflows", async (route) => {
      savedWorkflow = route.request().postDataJSON()
      await route.fulfill({ status: 201, json: { success: true, data: { workflow: savedWorkflow } } })
    })
    await page.route("**/api/workflows/expense-upload", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            workflow: savedWorkflow ?? {
              name: "expense-upload",
              description: "Uploads expense receipt",
              task: "Submit the receipt",
              trigger: { type: "manual" },
              steps: [
                {
                  id: "step-1",
                  agent: "planner",
                  instructions: "Upload receipt in browser form",
                  input: "previous",
                  files: ["october-invoice"],
                  allowWrites: false,
                  maxTurns: 6,
                  gate: false,
                },
              ],
              limits: { stepTimeoutMinutes: 10, runTimeoutMinutes: 60, maxRetries: 1 },
              selfAssess: false,
            },
            active: false,
          },
        },
      })
    )
    let startedRunBody: unknown
    await page.route("**/api/workflows/expense-upload/runs", async (route) => {
      if (route.request().method() === "POST") {
        startedRunBody = route.request().postDataJSON()
        await route.fulfill({
          status: 201,
          json: {
            success: true,
            data: {
              run: {
                id: "run-99",
                workflow: "expense-upload",
                workspaceRoot: WORKSPACE.path,
                status: "queued",
                trigger: "manual",
                task: "Submit the receipt",
                createdAt: "2026-10-14T10:00:00.000Z",
                steps: [],
              },
            },
          },
        })
        return
      }
      await route.fulfill({ json: { success: true, data: { runs: [] } } })
    })

    await page.goto("/workflows/new")
    await page.getByLabel("Name").fill("expense-upload")
    await page.getByLabel("Default task").fill("Submit the receipt")
    await page.getByRole("combobox", { name: "Agent" }).click()
    await page.getByRole("option", { name: "planner" }).click()

    // Select a file for Step 1
    await page.getByRole("button", { name: "Select or upload files" }).click()
    await page.getByRole("option", { name: /@file:october-invoice/ }).click()
    await page.keyboard.press("Escape")

    await expect(
      page.getByRole("list", { name: "Files for step 1" }).getByText("@file:october-invoice")
    ).toBeVisible()

    await page.getByRole("button", { name: "Save" }).click()
    await expect(page).toHaveURL(/\/workflows\/expense-upload$/)
    expect(savedWorkflow).toMatchObject({
      name: "expense-upload",
      steps: [{ id: "step-1", agent: "planner", files: ["october-invoice"] }],
    })

    // In the Run panel on the edit page, verify the step's default file is pre-populated and sent on Run now
    await page.getByRole("button", { name: "Run now" }).click()
    await expect(page).toHaveURL(/\/workflows\/runs\/run-99$/)
    expect(startedRunBody).toEqual({
      stepFiles: { "step-1": ["october-invoice"] },
    })
  })
})
