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

  test("warns when a drafted step cannot do its job and asks the assistant to fix it", async ({ page }) => {
    await stubWorkflows(page, [])
    const draft = {
      name: "build-line",
      steps: [{ id: "build", agent: "planner", instructions: "Implement the API" }],
    }
    const bodies: Array<{ messages: Array<{ content: string }> }> = []
    await page.route("**/api/chat", (route) => {
      bodies.push(route.request().postDataJSON())
      return fulfillSse(route, [
        ["done", { content: `Here it is.\n\n\`\`\`workflow\n${JSON.stringify(draft)}\n\`\`\``, model: "gpt-4o-mini", toolExecutions: [] }],
      ])
    })
    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Make a build workflow")
    await page.getByRole("button", { name: "Send" }).click()

    const card = page.getByTestId("workflow-draft-card").first()
    await expect(card.getByText("Read only")).toBeVisible()
    await expect(card.getByRole("list", { name: "Warnings for build" })).toContainText(
      "It can only read files, but its instructions ask it to change them."
    )
    await card.getByRole("button", { name: "Ask Assistant to fix the step tools" }).click()
    await expect.poll(() => bodies.length).toBe(2)
    expect(bodies[1].messages.at(-1)?.content).toContain('Fix the tools in the "build-line" workflow draft.')
    expect(bodies[1].messages.at(-1)?.content).toContain("- build: It can only read files")
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

  test("stop before any text gives the message back", async ({ page }) => {
    await stubWorkflows(page, [])
    await page.route("**/api/chat", () => {
      // Never answer: the reply stays in progress until the user stops it.
    })
    await page.goto("/chat")
    const input = page.getByRole("textbox", { name: "Message assistant" })
    await input.fill("Explain workflows")
    await page.getByRole("button", { name: "Send" }).click()

    await page.getByRole("button", { name: "Stop the reply" }).click()
    await expect(page.getByRole("button", { name: "Stop the reply" })).toHaveCount(0)
    await expect(input).toHaveValue("Explain workflows")
    await expect(input).toBeEnabled()
  })

  test("stop keeps the text that already arrived", async ({ page }) => {
    await stubWorkflows(page, [])
    await page.addInitScript(() => {
      const original = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (!url.endsWith("/api/chat")) return original(input, init)
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: token\ndata: {"content":"Workflows run steps"}\n\n'))
            init?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("Aborted", "AbortError"))
            )
          },
        })
        return Promise.resolve(new Response(body, { headers: { "Content-Type": "text/event-stream" } }))
      }
    })
    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Explain workflows")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("Workflows run steps")).toBeVisible()

    await page.getByRole("button", { name: "Stop the reply" }).click()
    await expect(page.getByText("Stopped by you. This reply may be incomplete.")).toBeVisible()
    await expect(page.getByText("Workflows run steps")).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Message assistant" })).toHaveValue("")
  })

  test("copies a reply", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
    await stubWorkflows(page, [])
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [
        ["done", { content: "Paste this note.", model: "gpt-4o-mini", toolExecutions: [] }],
      ])
    )
    await page.goto("/chat")
    await page.getByRole("textbox", { name: "Message assistant" }).fill("hello")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("Paste this note.")).toBeVisible()
    await page.getByRole("button", { name: "Copy", exact: true }).last().click()
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toBe("Paste this note.")
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible()
  })

  test("reads a reply aloud and skips code and links", async ({ page }) => {
    await stubWorkflows(page, [])
    await page.addInitScript(() => {
      const spoken: string[] = []
      Object.assign(window, { __spoken: spoken })
      const synth = window.speechSynthesis
      synth.cancel = () => {}
      synth.getVoices = () => []
      synth.speak = (utter: SpeechSynthesisUtterance) => {
        spoken.push(utter.text)
        queueMicrotask(() => utter.onend?.(new Event("end") as SpeechSynthesisEvent))
      }
    })
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [
        [
          "done",
          {
            content: "See the [docs](https://example.com/secret).\n\n```js\nconst secret = 1\n```",
            model: "gpt-4o-mini",
            toolExecutions: [],
          },
        ],
      ])
    )
    await page.goto("/chat")
    await page.getByRole("switch", { name: "Read replies aloud" }).click()
    await expect(page.getByText("New answers are read with this browser's voice.")).toBeVisible()
    await page.getByRole("textbox", { name: "Message assistant" }).fill("Hi")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("See the docs.")).toBeVisible()
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(" ")))
      .toContain("See the docs")
    const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(" "))
    expect(spoken).not.toContain("https://")
    expect(spoken).not.toContain("const secret")
    expect(spoken).toContain("code, shown on the screen")

    const before = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length)
    await page.getByRole("button", { name: "Read aloud" }).click()
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length))
      .toBeGreaterThan(before)
  })

  test("talk mode sends a pause, reads the answer, and can be interrupted", async ({ page }) => {
    await stubWorkflows(page, [])
    let posts = 0
    await page.addInitScript(() => {
      const spoken: string[] = []
      let starts = 0
      Object.assign(window, { __spoken: spoken, __starts: 0 })
      class FakeRecognition {
        continuous = false
        interimResults = false
        lang = "en-US"
        onresult: ((event: unknown) => void) | null = null
        onerror: ((event: unknown) => void) | null = null
        onend: (() => void) | null = null
        start(): void {
          starts += 1
          Object.assign(window, { __starts: starts })
          if (starts > 1) return
          setTimeout(() => {
            const alternative = { transcript: "hello there" }
            const result = Object.assign([alternative], { isFinal: true })
            this.onresult?.({ results: [result] })
            this.onend?.()
          }, 30)
        }
        stop(): void {
          this.onend?.()
        }
        abort(): void {}
      }
      Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition })
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: async () => new MediaStream() },
      })
      const synth = window.speechSynthesis
      synth.cancel = () => {}
      synth.getVoices = () => []
      synth.speak = (utter: SpeechSynthesisUtterance) => {
        spoken.push(utter.text)
        if (spoken.length === 1) {
          setTimeout(() => utter.onend?.(new Event("end") as SpeechSynthesisEvent), 20)
        }
      }
    })
    await page.route("**/api/chat", async (route) => {
      posts += 1
      await fulfillSse(route, [["done", { content: "Sure. I can help.", model: "gpt-4o-mini", toolExecutions: [] }]])
    })

    await page.goto("/chat")
    await page.getByRole("button", { name: "Talk", exact: true }).click()
    await expect(page.getByText("hello there")).toBeVisible()
    await expect(page.getByText("Sure. I can help.")).toBeVisible()
    await expect(page.getByText("Speaking. Tap Interrupt to cut in.")).toBeVisible()
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(" ")))
      .toContain("Sure. I can help.")

    await page.getByRole("button", { name: "Interrupt" }).click()
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __starts: number }).__starts))
      .toBeGreaterThan(1)
    await expect(page.getByText("Listening. Pause when you finish, and your words are sent.")).toBeVisible()

    await page.getByRole("button", { name: "Stop talking" }).first().click()
    await expect(page.getByRole("button", { name: "Talk", exact: true })).toBeVisible()
    expect(posts).toBe(1)
  })

  test("talk mode listens again after it finishes speaking", async ({ page }) => {
    await stubWorkflows(page, [])
    await page.addInitScript(() => {
      let starts = 0
      Object.assign(window, { __starts: 0 })
      class FakeRecognition {
        continuous = false
        interimResults = false
        lang = "en-US"
        onresult: ((event: unknown) => void) | null = null
        onerror: ((event: unknown) => void) | null = null
        onend: (() => void) | null = null
        start(): void {
          starts += 1
          Object.assign(window, { __starts: starts })
          if (starts > 1) return
          setTimeout(() => {
            const alternative = { transcript: "hello there" }
            const result = Object.assign([alternative], { isFinal: true })
            this.onresult?.({ results: [result] })
            this.onend?.()
          }, 30)
        }
        stop(): void {
          this.onend?.()
        }
        abort(): void {}
      }
      Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition })
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: async () => new MediaStream() },
      })
      const synth = window.speechSynthesis
      synth.cancel = () => {}
      synth.getVoices = () => []
      synth.speak = (utter: SpeechSynthesisUtterance) => {
        setTimeout(() => utter.onend?.(new Event("end") as SpeechSynthesisEvent), 20)
      }
    })
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [["done", { content: "Sure. I can help.", model: "gpt-4o-mini", toolExecutions: [] }]])
    )

    await page.goto("/chat")
    await page.getByRole("button", { name: "Talk", exact: true }).click()
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __starts: number }).__starts))
      .toBeGreaterThan(1)
    await expect(page.getByText("Listening. Pause when you finish, and your words are sent.")).toBeVisible()
  })

  test("talk greets with the persona and speaks a short answer", async ({ page }) => {
    await stubWorkflows(page, [])
    await page.addInitScript(() => {
      const spoken: string[] = []
      Object.assign(window, { __spoken: spoken })
      class FakeRecognition {
        continuous = false
        interimResults = false
        lang = "en-US"
        onresult: ((event: unknown) => void) | null = null
        onerror: ((event: unknown) => void) | null = null
        onend: (() => void) | null = null
        start(): void {
          setTimeout(() => {
            const alternative = { transcript: "hello there" }
            const result = Object.assign([alternative], { isFinal: true })
            this.onresult?.({ results: [result] })
            this.onend?.()
          }, 30)
        }
        stop(): void {
          this.onend?.()
        }
        abort(): void {}
      }
      Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition })
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: async () => new MediaStream() },
      })
      const synth = window.speechSynthesis
      synth.cancel = () => {}
      synth.getVoices = () => []
      synth.speak = (utter: SpeechSynthesisUtterance) => {
        spoken.push(utter.text)
        setTimeout(() => utter.onend?.(new Event("end") as SpeechSynthesisEvent), 20)
      }
    })
    await page.route("**/api/chat", (route) =>
      fulfillSse(route, [
        [
          "done",
          {
            content: "Alpha is ready. Beta is ready. Gamma is extra.",
            model: "gpt-4o-mini",
            toolExecutions: [],
          },
        ],
      ])
    )

    await page.goto("/chat")
    await page.getByRole("button", { name: "Voice", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Name").fill("Nova")
    await expect(dialog.getByText("Talk starts with: Hello. I am Nova.")).toBeVisible()
    await dialog.getByLabel("Greeting").fill("Hi from Nova.")
    await expect(dialog.getByText("Talk starts with: Hi from Nova.")).toBeVisible()
    await dialog.getByRole("radio", { name: /Short/ }).click()
    await dialog.getByRole("button", { name: "Close" }).click()

    await page.getByRole("button", { name: "Talk", exact: true }).click()
    await expect(page.getByText("Gamma is extra.")).toBeVisible()
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(" ")))
      .toContain("Hi from Nova.")
    const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(" "))
    expect(spoken).toContain("Alpha is ready. Beta is ready.")
    expect(spoken).toContain("The rest is on the screen.")
    expect(spoken).not.toContain("Gamma")
  })

  test("hello black agents starts talk without sending the microphone away", async ({ page }) => {
    await stubWorkflows(page, [])
    await page.addInitScript(() => {
      const spoken: string[] = []
      Object.assign(window, { __blackAgentsFakeWake: true, __spoken: spoken })
      const synth = window.speechSynthesis
      synth.cancel = () => {}
      synth.getVoices = () => []
      synth.speak = (utter: SpeechSynthesisUtterance) => {
        spoken.push(utter.text)
      }
    })
    await page.goto("/chat")
    await page.getByRole("switch", { name: "Wake word" }).click()
    await expect(page.getByText("Listening for Hello BlackAgents. Your voice stays on this computer.")).toBeVisible()

    await page.evaluate(() => (window as unknown as { __wakeSay: (text: string) => void }).__wakeSay("hello there"))
    await expect(page.getByText("Listening for Hello BlackAgents. Your voice stays on this computer.")).toBeVisible()

    await page.evaluate(() =>
      (window as unknown as { __wakeSay: (text: string) => void }).__wakeSay("Hello, BlackAgents")
    )
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(" ")))
      .toContain("Hello. I am Assistant.")
    await expect(page.getByText("Speaking. Tap Interrupt to cut in.")).toBeVisible()
  })
})
