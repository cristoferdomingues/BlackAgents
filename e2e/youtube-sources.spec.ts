import { expect, test } from "@playwright/test"

import { fulfillSse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const VIDEO = {
  videoId: "dQw4w9WgXcQ",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Demo video",
  channel: "Demo channel",
  language: "en",
  transcript: "Use a checklist when you review code.",
  truncated: false,
}

test.describe("YouTube sources", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page, [])
    await stubVerifiedProvider(page)
  })

  test("drafts a new skill from a YouTube link", async ({ page }) => {
    await page.route("**/api/sources/youtube", (route) =>
      route.fulfill({ json: { success: true, data: VIDEO } })
    )
    await page.route("**/api/artifacts/draft-body", async (route) => {
      const body = route.request().postDataJSON() as { sources?: Array<{ title?: string }> }
      expect(body.sources?.[0]?.title).toBe("Demo video")
      await route.fulfill({
        json: {
          success: true,
          data: {
            description: "Use when the user asks for a code review.",
            body: "# code-review\n\n## When to Apply\n\n- Review a pull request.\n\n## Sources\n\n- [Demo video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n",
            extra: { parallel: false, alwaysApply: false, globs: [] },
            links: [],
          },
        },
      })
    })

    await page.goto("/skills/new")
    await page.getByRole("button", { name: "Start blank" }).click()
    await page.getByLabel("Name").fill("code-review")
    await expect(page.getByRole("button", { name: "Draft with assistant" })).toBeDisabled()
    await page.getByLabel("YouTube videos").fill(VIDEO.url)
    await page.getByRole("button", { name: "Add video" }).click()
    await expect(page.getByText("Captions ready")).toBeVisible()
    await expect(page.getByRole("button", { name: "Draft with assistant" })).toBeEnabled()
    await page.getByRole("button", { name: "Draft with assistant" }).click()
    await expect(page.getByLabel("Description")).toHaveValue("Use when the user asks for a code review.")
    await page.getByRole("tab", { name: "Preview" }).click()
    await expect(page.getByRole("link", { name: "Demo video" })).toBeVisible()
  })

  test("lets the user paste a transcript when captions are missing", async ({ page }) => {
    await page.route("**/api/sources/youtube", (route) =>
      route.fulfill({
        status: 404,
        json: {
          success: false,
          error: "This video has no captions. Paste the transcript instead.",
        },
      })
    )
    await page.goto("/skills/new")
    await page.getByRole("button", { name: "Start blank" }).click()
    await page.getByLabel("YouTube videos").fill("https://youtu.be/dQw4w9WgXcQ")
    await page.getByRole("button", { name: "Add video" }).click()
    await expect(page.getByText("This video has no captions. Paste the transcript instead.")).toBeVisible()
    await page.getByLabel("Paste the transcript").fill("Steps for a careful code review.")
    await page.getByRole("button", { name: "Use transcript" }).click()
    await expect(page.getByText("Pasted transcript")).toBeVisible()
  })

  test("adds a YouTube video to the assistant", async ({ page }) => {
    await page.route("**/api/workflows", (route) =>
      route.fulfill({ json: { success: true, data: { workflows: [] } } })
    )
    await page.route("**/api/sources/youtube", (route) =>
      route.fulfill({ json: { success: true, data: VIDEO } })
    )
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [["done", { content: "I read the video.", model: "gpt-4o-mini", toolExecutions: [] }]])
    )

    await page.goto("/chat")
    await page.getByRole("button", { name: "Add a YouTube video" }).click()
    await page.getByLabel("YouTube link").fill(VIDEO.url)
    await page.getByRole("button", { name: "Add video" }).click()
    await expect(page.getByText("Demo video")).toBeVisible()
    await page.getByLabel("Message assistant").fill("Summarize this video")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("I read the video.")).toBeVisible()
  })

  test("watches a YouTube video for the assistant", async ({ page }) => {
    const notes = "- [00:04] A checklist on a slide"
    let sourceBody: { watch?: boolean } = {}
    let chatBody: { messages?: Array<{ attachments?: Array<{ visualNotes?: string }> }> } = {}
    await page.route("**/api/workflows", (route) =>
      route.fulfill({ json: { success: true, data: { workflows: [] } } })
    )
    await page.route("**/api/sources/youtube", async (route) => {
      sourceBody = route.request().postDataJSON() as typeof sourceBody
      await route.fulfill({ json: { success: true, data: { ...VIDEO, visualNotes: notes } } })
    })
    await page.route("**/api/chat", async (route) => {
      chatBody = route.request().postDataJSON() as typeof chatBody
      await fulfillSse(route, [["done", { content: "I watched it.", model: "gpt-4o-mini", toolExecutions: [] }]])
    })

    await page.goto("/chat")
    await page.getByRole("button", { name: "Add a YouTube video" }).click()
    await page.getByLabel("YouTube link").fill(VIDEO.url)
    await page.getByRole("switch", { name: "Watch the video" }).click()
    await page.getByRole("button", { name: "Add video" }).click()
    await expect(page.getByText("Demo video")).toBeVisible()
    expect(sourceBody.watch).toBe(true)
    await page.getByLabel("Message assistant").fill("What is on the slides?")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("I watched it.")).toBeVisible()
    expect(chatBody.messages?.at(-1)?.attachments?.[0]?.visualNotes).toBe(notes)
  })

  test("drafts a skill from a watched video without captions", async ({ page }) => {
    let draftSources: Array<{ transcript?: string; visualNotes?: string }> = []
    await page.route("**/api/sources/youtube", (route) =>
      route.fulfill({
        json: { success: true, data: { ...VIDEO, transcript: "", visualNotes: "- [00:10] Code on screen" } },
      })
    )
    await page.route("**/api/artifacts/draft-body", async (route) => {
      draftSources = (route.request().postDataJSON() as { sources?: typeof draftSources }).sources ?? []
      await route.fulfill({
        json: {
          success: true,
          data: {
            description: "Use when the user asks for a code review.",
            body: "# code-review\n",
            extra: { parallel: false, alwaysApply: false, globs: [] },
            links: [],
          },
        },
      })
    })

    await page.goto("/skills/new")
    await page.getByRole("button", { name: "Start blank" }).click()
    await page.getByLabel("Name").fill("code-review")
    await page.getByRole("switch", { name: "Watch the video" }).click()
    await page.getByLabel("YouTube videos").fill(VIDEO.url)
    await page.getByRole("button", { name: "Add video" }).click()
    await expect(page.getByText("Video notes ready (no captions)")).toBeVisible()
    await page.getByRole("button", { name: "Draft with assistant" }).click()
    await expect(page.getByLabel("Description")).toHaveValue("Use when the user asks for a code review.")
    expect(draftSources[0]).toMatchObject({ transcript: "", visualNotes: "- [00:10] Code on screen" })
  })
})
