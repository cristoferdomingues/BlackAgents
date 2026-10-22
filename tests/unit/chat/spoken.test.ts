import { describe, expect, it } from "vitest"

import { READ_ALOUD_LABEL, READ_REPLIES_ON, STOP_READING_LABEL, TALK_SPEAKING } from "@/lib/chat/explain"
import { listenFollowUp } from "@/lib/chat/talk"
import { assistantSpeechText, speechChunks, SPOKEN_MAX_CHARS } from "@/lib/chat/spoken"

describe("assistant speech copy", () => {
  it("says the browser voice reads answers and code stays on screen", () => {
    expect(READ_REPLIES_ON).toContain("browser")
    expect(READ_REPLIES_ON.toLowerCase()).toContain("code")
    expect(READ_ALOUD_LABEL.length).toBeGreaterThan(0)
    expect(STOP_READING_LABEL.length).toBeGreaterThan(0)
  })
})

describe("listenFollowUp", () => {
  it("retries when nobody spoke, stops on an error, and ignores a normal end", () => {
    expect(listenFollowUp("empty")).toBe("retry")
    expect(listenFollowUp("error")).toBe("stop")
    expect(listenFollowUp("transcript")).toBe("ignore")
    expect(listenFollowUp("cancelled")).toBe("ignore")
    expect(TALK_SPEAKING.toLowerCase()).toContain("interrupt")
  })

  it("speaks only the first sentences in short style", () => {
    const text = assistantSpeechText("Alpha is ready. Beta is ready. Gamma is extra.", "short")
    expect(text).toContain("Alpha is ready. Beta is ready.")
    expect(text).toContain("The rest is on the screen.")
    expect(text).not.toContain("Gamma")
    expect(assistantSpeechText("Alpha is ready. Beta is ready.", "short")).toBe("Alpha is ready. Beta is ready.")
  })
})

describe("assistantSpeechText", () => {
  it("reads headings, links and emphasis as plain words", () => {
    const text = assistantSpeechText(
      "# Hello\n\nSee the [docs](https://example.com/secret).\n\nThis is **bold** and `inline`."
    )
    expect(text).toContain("Hello")
    expect(text).toContain("See the docs")
    expect(text).toContain("bold")
    expect(text).toContain("inline")
    expect(text).not.toContain("https://")
    expect(text).not.toContain("**")
    expect(text).not.toContain("`")
  })

  it("skips code blocks and draft fences", () => {
    const text = assistantSpeechText(
      ["Here is the plan.", "```js", "const secret = 1", "```", "```artifact", '{"name":"x"}', "```"].join("\n")
    )
    expect(text).toContain("Here is the plan")
    expect(text).toContain("code, shown on the screen")
    expect(text).not.toContain("secret")
    expect(text).not.toContain("artifact")
  })

  it("says where to look when the reply is only code", () => {
    expect(assistantSpeechText("```js\nconst x = 1\n```")).toBe("The answer is on the screen.")
  })

  it("keeps names with underscores and reads a choice question", () => {
    const text = assistantSpeechText("Use report_issue.\n\nA) Red\nB) Blue")
    expect(text).toContain("report_issue")
    expect(text).toContain("A. Red")
    expect(text).toContain("B. Blue")
  })

  it("stops a very long reply", () => {
    const text = assistantSpeechText(`Hello. ${"word ".repeat(600)}`)
    expect(text.length).toBeLessThan(SPOKEN_MAX_CHARS + 40)
    expect(text.endsWith("The rest is on the screen.")).toBe(true)
  })

  it("returns nothing for an empty reply", () => {
    expect(assistantSpeechText("   ")).toBe("")
  })
})

describe("speechChunks", () => {
  it("keeps short text in one piece and splits long text", () => {
    expect(speechChunks("Hello there.")).toEqual(["Hello there."])
    const chunks = speechChunks(`${"A".repeat(100)}. ${"B".repeat(100)}. ${"C".repeat(100)}.`, 120)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(" ")).toContain("A".repeat(100))
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true)
  })

  it("returns nothing for blank text", () => {
    expect(speechChunks("  ")).toEqual([])
  })
})
