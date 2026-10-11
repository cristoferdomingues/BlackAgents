import { expect, test, type Page } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const TRIAGE = {
  workflow: {
    name: "triage",
    description: "Sort incoming bugs.",
    task: "Default triage task",
    trigger: { type: "manual" },
    steps: [{ id: "sort", agent: "planner", instructions: "", input: "previous", allowWrites: false, maxTurns: 6, gate: false }],
    limits: { stepTimeoutMinutes: 10, runTimeoutMinutes: 60, maxRetries: 1 },
    selfAssess: false,
  },
  lastRun: null,
  active: false,
}

async function stubWorkflows(page: Page, items: unknown[] = [TRIAGE]): Promise<unknown[]> {
  const posted: unknown[] = []
  await page.route("**/api/workflows", async (route) => {
    if (route.request().method() === "POST") {
      posted.push(route.request().postDataJSON())
      await route.fulfill({ status: 201, json: { success: true, data: { workflow: posted.at(-1) } } })
      return
    }
    await route.fulfill({ json: { success: true, data: { workflows: items } } })
  })
  return posted
}

/** A fake Web Speech engine that "hears" one phrase as soon as it starts. */
async function fakeSpeech(page: Page, phrase: string): Promise<void> {
  await page.addInitScript((heard: string) => {
    class FakeRecognition {
      continuous = false
      interimResults = false
      lang = "en-US"
      onresult: ((event: unknown) => void) | null = null
      onerror: ((event: unknown) => void) | null = null
      onend: (() => void) | null = null
      start(): void {
        setTimeout(() => {
          const alternative = { transcript: heard }
          const result = Object.assign([alternative], { isFinal: true })
          this.onresult?.({ results: [result] })
          this.onend?.()
        }, 50)
      }
      stop(): void {}
      abort(): void {}
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition })
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => new MediaStream() },
    })
  }, phrase)
}

test.describe("assistant files, voice and workflows", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page, [{ name: "planner", type: "agent", description: "Plans work." }])
    await stubVerifiedProvider(page)
  })

  test("attaches a file, sends it, and shows the chip", async ({ page }) => {
    await stubWorkflows(page, [])
    let body: { messages?: Array<{ attachments?: unknown[] }> } = {}
    await page.route("**/api/chat", async (route) => {
      body = route.request().postDataJSON() as typeof body
      await fulfillSse(route, [["done", { content: "It is a note.", model: "gpt-4o-mini", toolExecutions: [] }]])
    })

    await page.goto("/chat")
    await expect(page.getByRole("button", { name: "Attach files" })).toBeEnabled()
    await page.getByTestId("chat-file-input").setInputFiles({
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Release notes"),
    })
    const attached = page.getByRole("list", { name: "Attached files" })
    await expect(attached.getByText("notes.md")).toBeVisible()
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled()

    await page.getByRole("textbox", { name: "Message assistant" }).fill("What is this?")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(page.getByText("It is a note.")).toBeVisible()
    await expect(page.getByRole("list", { name: "Files sent" }).getByText("notes.md")).toBeVisible()
    await expect(attached).toHaveCount(0)
    expect(body.messages?.[0]?.attachments).toEqual([
      { kind: "text", name: "notes.md", mimeType: "text/markdown", text: "# Release notes" },
    ])
  })

  test("removes an attached file and rejects unsupported types", async ({ page }) => {
    await stubWorkflows(page, [])
    await page.goto("/chat")
    const input = page.getByTestId("chat-file-input")
    await input.setInputFiles({ name: "a.png", mimeType: "image/png", buffer: Buffer.from("png") })
    await page.getByRole("button", { name: "Remove a.png" }).click()
    await expect(page.getByRole("list", { name: "Attached files" })).toHaveCount(0)

    await input.setInputFiles({ name: "song.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("x") })
    await expect(page.getByText('"song.mp3" is not a supported file type')).toBeVisible()
  })

  test("mic turns into send when there is text, and voice fills the input", async ({ page }) => {
    await stubWorkflows(page, [])
    await fakeSpeech(page, "create a commit rule")
    await page.goto("/chat")
    const input = page.getByRole("textbox", { name: "Message assistant" })
    const mic = page.getByRole("button", { name: "Start voice input" })
    await expect(mic).toBeEnabled()
    await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0)

    await input.fill("hello")
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled()
    await expect(mic).toHaveCount(0)
    await input.fill("")
    await expect(mic).toBeVisible()

    await mic.click()
    await expect(input).toHaveValue("create a commit rule")
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled()
  })

  test("saves a workflow drafted by the assistant", async ({ page }) => {
    const posted = await stubWorkflows(page, [])
    const draft = {
      name: "release-line",
      description: "Plan a release.",
      steps: [{ id: "plan", agent: "planner", instructions: "Plan the release" }],
    }
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [
        ["done", { content: `Here it is.\n\n\`\`\`workflow\n${JSON.stringify(draft)}\n\`\`\``, model: "gpt-4o-mini", toolExecutions: [] }],
      ])
    )
    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Make a release workflow")
    await page.getByRole("button", { name: "Send" }).click()

    const card = page.getByTestId("workflow-draft-card")
    await expect(card.getByText("release-line")).toBeVisible()
    await expect(card.getByText("Plan the release")).toBeVisible()
    await card.getByRole("button", { name: "Save workflow" }).click()
    await expect(card.getByText("Saved. Start it with /release-line")).toBeVisible()
    expect(posted).toEqual([expect.objectContaining({ name: "release-line", steps: [expect.objectContaining({ agent: "planner" })] })])
  })

  test("starts a workflow with /name input without calling the model", async ({ page }) => {
    await stubWorkflows(page)
    let chatCalls = 0
    await page.route("**/api/chat", async (route) => {
      chatCalls++
      await route.abort()
    })
    let runBody: unknown
    await page.route("**/api/workflows/triage/runs", async (route) => {
      runBody = route.request().postDataJSON()
      await route.fulfill({ status: 201, json: { success: true, data: { run: { id: "run-42" } } } })
    })

    await page.goto("/chat")
    const input = page.getByRole("textbox", { name: "Message assistant" })
    await expect(input).toBeEnabled()
    await input.pressSequentially("@tri")
    await expect(page.getByRole("option", { name: /triage/ })).toBeVisible()
    await input.press("Escape")
    await input.fill("/triage bug 12 crashes on save")
    await page.getByRole("button", { name: "Send" }).click()

    const card = page.getByTestId("workflow-run-card")
    await expect(card.getByText("Sort incoming bugs.")).toBeVisible()
    await expect(card.getByRole("textbox")).toHaveValue("bug 12 crashes on save")
    await card.getByRole("button", { name: "Run workflow" }).click()
    await expect(card.getByRole("link", { name: "View run" })).toHaveAttribute("href", "/workflows/runs/run-42")
    expect(runBody).toEqual({ task: "bug 12 crashes on save" })
    expect(chatCalls).toBe(0)
  })

  test("start @name uses the workflow default input", async ({ page }) => {
    await stubWorkflows(page)
    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("start @workflow:triage")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByTestId("workflow-run-card").getByRole("textbox")).toHaveValue("Default triage task")
  })
})
