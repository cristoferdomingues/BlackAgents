import { describe, expect, it } from "vitest"

import {
  findFencedJson,
  parseLenientJson,
  repairJsonStrings,
  stripFencedBlocks,
} from "@/lib/llm/fenced-json"

describe("repairJsonStrings", () => {
  it("escapes raw line breaks and tabs inside strings only", () => {
    const raw = '{\n  "body": "line one\nline\ttwo"\n}'
    expect(JSON.parse(repairJsonStrings(raw))).toEqual({ body: "line one\nline\ttwo" })
  })

  it("keeps escaped quotes and backslashes intact", () => {
    const raw = '{"body": "say \\"hi\\"\nC:\\\\dir"}'
    expect(JSON.parse(repairJsonStrings(raw))).toEqual({ body: 'say "hi"\nC:\\dir' })
  })

  it("escapes other control characters as unicode", () => {
    expect(repairJsonStrings('"a\u0001b"')).toBe('"a\\u0001b"')
  })
})

describe("parseLenientJson", () => {
  it("parses strict JSON", () => {
    expect(parseLenientJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  it("fails on JSON that cannot be repaired", () => {
    expect(parseLenientJson("{not json")).toEqual({ ok: false })
  })
})

describe("findFencedJson", () => {
  it("returns null without the fence", () => {
    expect(findFencedJson("no block here", "artifact")).toBeNull()
  })

  it("skips code fences inside a body with raw line breaks", () => {
    const text = [
      "Here:",
      "```artifact",
      '{"type":"command","body":"Run:',
      "```bash",
      "npm test",
      "```",
      'Done."}',
      "```",
      "After.",
    ].join("\n")
    const block = findFencedJson(text, "artifact")
    expect(block?.closed).toBe(true)
    expect(block?.value).toEqual({
      type: "command",
      body: "Run:\n```bash\nnpm test\n```\nDone.",
    })
    expect(text.slice(block?.end ?? 0)).toBe("\nAfter.")
  })

  it("reports an unclosed block with no value", () => {
    const block = findFencedJson('```artifact\n{"type":"comm', "artifact")
    expect(block).toMatchObject({ closed: false, value: undefined })
  })

  it("marks a closed block with broken JSON as having no value", () => {
    const block = findFencedJson("```artifact\n{oops}\n```", "artifact")
    expect(block).toMatchObject({ closed: true, value: undefined })
  })

  it("does not match a different fence", () => {
    expect(findFencedJson('```artifactx\n{}\n```', "artifact")).toBeNull()
  })
})

describe("stripFencedBlocks", () => {
  it("removes valid, broken and unclosed blocks", () => {
    const text = 'A\n```artifact\n{"a":1}\n```\nB\n```artifact\n{bad}\n```\nC\n```artifact\n{"x'
    expect(stripFencedBlocks(text, "artifact")).toBe("A\n\nB\n\nC")
  })

  it("leaves other fences alone", () => {
    expect(stripFencedBlocks("```bash\nls\n```", "artifact")).toBe("```bash\nls\n```")
  })
})
