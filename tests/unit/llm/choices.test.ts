import { describe, expect, it } from "vitest"

import { formatChoiceAnswer, inspectChoices, MAX_OTHER_ANSWER } from "@/lib/llm/choices"

const quiz = `You're debugging an agent. The loop never continues.

Which step of the agent loop is missing?

- **A)** Inspecting \`stop_reason\` before deciding what to do next
- **B)** Appending the tool result to the conversation history
- **C)** Forcing the tool choice via \`tool_choice\`
- **D)** Retrying the call with exponential backoff`

describe("inspectChoices with lettered lines", () => {
  it("reads a bold, bulleted A–D quiz and removes the options from the prose", () => {
    const found = inspectChoices(quiz)
    expect(found?.prompt.multiple).toBe(false)
    expect(found?.prompt.options).toEqual([
      { label: "A", text: "Inspecting `stop_reason` before deciding what to do next" },
      { label: "B", text: "Appending the tool result to the conversation history" },
      { label: "C", text: "Forcing the tool choice via `tool_choice`" },
      { label: "D", text: "Retrying the call with exponential backoff" },
    ])
    expect(found?.rest).toBe(
      "You're debugging an agent. The loop never continues.\n\nWhich step of the agent loop is missing?"
    )
  })

  it("accepts A. / (B) / C: styles and blank lines between options", () => {
    const found = inspectChoices("Pick one:\nA. Red\n\n(B) Green\nC: Blue\n\nReply with a letter.")
    expect(found?.prompt.options.map((o) => o.text)).toEqual(["Red", "Green", "Blue"])
    expect(found?.rest).toBe("Pick one:\n\nReply with a letter.")
  })

  it("marks a select-all question as multiple", () => {
    const found = inspectChoices("Select all that apply:\nA) One\nB) Two\nC) Three")
    expect(found?.prompt.multiple).toBe(true)
  })

  it("keeps the last option run when the reply has two", () => {
    const found = inspectChoices("Old:\nA) x\nB) y\n\nNew question:\nA) Cat\nB) Dog")
    expect(found?.prompt.options.map((o) => o.text)).toEqual(["Cat", "Dog"])
    expect(found?.rest).toBe("Old:\nA) x\nB) y\n\nNew question:")
  })

  it("ignores options out of order, a single option, or options inside code", () => {
    expect(inspectChoices("A) only one")).toBeNull()
    expect(inspectChoices("A) one\nC) three")).toBeNull()
    expect(inspectChoices("B) one\nC) two")).toBeNull()
    expect(inspectChoices("```\nA) one\nB) two\n```")).toBeNull()
  })

  it("ignores lettered lines followed by a long explanation", () => {
    const text = "A) one\nB) two\nLine 1\nLine 2\nLine 3\nLine 4"
    expect(inspectChoices(text)).toBeNull()
  })

  it("breaks the run on a prose line between options", () => {
    expect(inspectChoices("A) one\nsome text\nB) two")).toBeNull()
  })
})

describe("inspectChoices with a choices block", () => {
  it("reads the block, strips its letters and removes it from the prose", () => {
    const text =
      'Which colors do you like?\n\n```choices\n{ "question": "Colors", "multiple": true, "options": ["A) Red", "**Green**"] }\n```'
    expect(inspectChoices(text)).toEqual({
      prompt: {
        question: "Colors",
        multiple: true,
        options: [
          { label: "A", text: "Red" },
          { label: "B", text: "Green" },
        ],
      },
      rest: "Which colors do you like?",
    })
  })

  it("defaults to a single choice", () => {
    const found = inspectChoices('```choices\n{ "options": ["Yes", "No"] }\n```')
    expect(found?.prompt).toEqual({
      multiple: false,
      options: [
        { label: "A", text: "Yes" },
        { label: "B", text: "No" },
      ],
    })
  })

  it("falls back to lettered lines when the block is invalid", () => {
    expect(inspectChoices('```choices\n{ "options": ["only"] }\n```')).toBeNull()
    const found = inspectChoices('```choices\n{ "options": [] }\n```\nA) Yes\nB) No')
    expect(found?.prompt.options.map((o) => o.text)).toEqual(["Yes", "No"])
  })
})

describe("formatChoiceAnswer", () => {
  const prompt = inspectChoices(quiz)!.prompt

  it("sends the label and text of each pick, in option order", () => {
    expect(formatChoiceAnswer(prompt, ["B"], "")).toBe(
      "B) Appending the tool result to the conversation history"
    )
    expect(formatChoiceAnswer(prompt, ["C", "A"], "")).toBe(
      "A) Inspecting `stop_reason` before deciding what to do next\nC) Forcing the tool choice via `tool_choice`"
    )
  })

  it("adds a trimmed, capped Other answer and is empty with nothing picked", () => {
    expect(formatChoiceAnswer(prompt, [], "  None of them  ")).toBe("Other: None of them")
    expect(formatChoiceAnswer(prompt, ["A"], "also this")).toContain("\nOther: also this")
    expect(formatChoiceAnswer(prompt, [], "   ")).toBe("")
    expect(formatChoiceAnswer(prompt, [], "x".repeat(MAX_OTHER_ANSWER + 50))).toHaveLength(
      "Other: ".length + MAX_OTHER_ANSWER
    )
  })
})
