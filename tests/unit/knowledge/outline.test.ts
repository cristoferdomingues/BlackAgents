import { describe, expect, it } from "vitest"

import { conceptOutline, withoutLeadingTitle } from "@/lib/knowledge/outline"

describe("conceptOutline", () => {
  it("lists ## and ### headings in order as plain text", () => {
    const body = [
      "# Design Spec",
      "## 1. Goal",
      "text",
      "### Test `two` [env](./env.md)",
      "#### Too deep",
      "## **Rollout** ##",
    ].join("\n")
    expect(conceptOutline(body)).toEqual([
      { level: 2, text: "1. Goal" },
      { level: 3, text: "Test two env" },
      { level: 2, text: "Rollout" },
    ])
  })

  it("skips headings inside code blocks", () => {
    const body = ["## Real", "```md", "## Not a heading", "```", "~~~", "### Also not", "~~~", "### After"].join("\n")
    expect(conceptOutline(body).map((item) => item.text)).toEqual(["Real", "After"])
  })

  it("keeps underscores inside names but drops _emphasis_ marks", () => {
    expect(conceptOutline("### report_issue\n### _Notes_ here").map((item) => item.text)).toEqual([
      "report_issue",
      "Notes here",
    ])
  })

  it("returns nothing for a body with no headings", () => {
    expect(conceptOutline("Just text.\n\n#hashtag")).toEqual([])
  })
})

describe("withoutLeadingTitle", () => {
  it("drops a first # line that repeats the title", () => {
    expect(withoutLeadingTitle("\n# Issue Report MCP — Design Spec\n\n## 1. Goal", "Issue Report MCP — Design Spec")).toBe(
      "## 1. Goal"
    )
    expect(withoutLeadingTitle("# *overview*\nBody", "Overview")).toBe("Body")
  })

  it("keeps the body when the first heading is different or not a #", () => {
    expect(withoutLeadingTitle("# Other\nBody", "Overview")).toBe("# Other\nBody")
    expect(withoutLeadingTitle("## Overview\nBody", "Overview")).toBe("## Overview\nBody")
    expect(withoutLeadingTitle("Intro\n# Overview", "Overview")).toBe("Intro\n# Overview")
    expect(withoutLeadingTitle("", "Overview")).toBe("")
  })
})
