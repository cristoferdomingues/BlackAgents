import { expect, test } from "@playwright/test"

import { sse, stubVerifiedProvider, stubWorkspace } from "./support/stubs"

const approval = {
  id: "exec-1",
  tool: "shell",
  server: "builtin",
  risk: "exec",
  summary: "Run npm test",
  args: { command: "npm test" },
  scope: { kind: "chat" },
  createdAt: "2026-10-14T19:00:00.000Z",
}

type SoundWindow = Window & { __notes: number[]; __approve: () => void }

test.describe("approval sound", () => {
  test.beforeEach(async ({ page }) => {
    await stubWorkspace(page)
    await stubVerifiedProvider(page)
    await page.route("**/api/approvals/**", (route) =>
      route.fulfill({ json: { success: true, data: {} } })
    )
    await page.addInitScript(
      ({ start, end }) => {
        const win = window as unknown as SoundWindow
        win.__notes = []
        const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }
        class FakeAudioContext {
          state = "running"
          currentTime = 0
          destination = {}
          async resume() {}
          createGain() {
            return { gain: param, connect() {} }
          }
          createOscillator() {
            let hz = 0
            return {
              type: "sine",
              frequency: { setValueAtTime: (value: number) => (hz = value) },
              connect() {},
              start: () => win.__notes.push(hz),
              stop() {},
            }
          }
        }
        ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext

        const original = window.fetch.bind(window)
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
          if (!url.endsWith("/api/chat")) return original(input, init)
          const encoder = new TextEncoder()
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(start))
              win.__approve = () => {
                controller.enqueue(encoder.encode(end))
                controller.close()
              }
            },
          })
          return Promise.resolve(
            new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
          )
        }
      },
      {
        start: sse([
          ["context", { artifacts: [], tools: 1 }],
          ["approval_required", { approval }],
        ]),
        end: sse([
          ["approval_resolved", { id: approval.id, approved: true }],
          ["done", { content: "Tests passed.", model: "gpt-4o-mini", toolExecutions: [] }],
        ]),
      }
    )
  })

  async function ask(page: import("@playwright/test").Page): Promise<void> {
    await page.goto("/chat")
    await page.getByRole("textbox", { name: /message/i }).fill("Run the tests")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByRole("alert", { name: "Approval needed for shell" })).toBeVisible()
  }

  test("chimes once when an approval appears and can be muted", async ({ page }) => {
    await ask(page)
    await expect.poll(() => page.evaluate(() => (window as unknown as SoundWindow).__notes)).toEqual([880, 1318.5])

    await page.getByRole("button", { name: "Turn off approval sound" }).click()
    await expect(page.getByRole("button", { name: "Turn on approval sound" })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem("black-agents:approval-sound"))).toBe("off")

    await page.getByRole("button", { name: "Approve" }).click()
    await page.evaluate(() => (window as unknown as SoundWindow).__approve())
    await expect(page.getByText("Tests passed.")).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as SoundWindow).__notes)).toHaveLength(2)
  })

  test("stays quiet when the sound is off", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("black-agents:approval-sound", "off"))
    await ask(page)
    await expect(page.getByRole("button", { name: "Turn on approval sound" })).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as SoundWindow).__notes)).toEqual([])

    await page.getByRole("button", { name: "Turn on approval sound" }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as SoundWindow).__notes)).toHaveLength(2)
  })
})
