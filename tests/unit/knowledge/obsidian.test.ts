import { describe, expect, it } from "vitest"

import { actorLabel, groupKnowledge } from "@/lib/knowledge/explain"
import { convertObsidianNotes, fileUri } from "@/lib/knowledge/obsidian"
import { toKnowledgeLibraryView, toKnowledgeListItem } from "@/lib/knowledge/view"

const NOW = new Date("2026-10-16T16:05:00Z")

describe("convertObsidianNotes", () => {
  it("turns wikilinks, aliases, and a map line into an OKF draft", () => {
    const drafts = convertObsidianNotes(
      [
        {
          relativePath: "00 - MOC.md",
          absolutePath: "/vault/00 - MOC.md",
          content: `---
type: moc
aliases: [Home]
---
# Home
- [[Start]] — How to begin
`,
        },
        {
          relativePath: "01 - Guides/Start.md",
          absolutePath: "/vault/01 - Guides/Start.md",
          content: `---
type: guide
tags: [setup]
updated: 2026-10-01
---
# Start

See [[Home|the map]] and [[Missing]].

\`\`\`
[[Not a link]]
\`\`\`

> [!tip] Careful
> Do this.
`,
        },
      ],
      NOW
    )

    const moc = drafts.find((draft) => draft.id === "map-of-content")
    const start = drafts.find((draft) => draft.id === "guides/start")
    expect(moc).toBeTruthy()
    expect(start?.frontmatter.type).toBe("How To")
    expect(start?.frontmatter.verified).toBeUndefined()
    expect(start?.frontmatter.generated).toEqual({ by: "process:obsidian-import", at: "2026-10-16T16:05:00Z" })
    expect(start?.frontmatter.status).toBe("draft")
    expect(start?.description).toBe("How to begin")
    expect(start?.body).toContain("[the map](../map-of-content.md)")
    expect(start?.body).toContain("[[Not a link]]")
    expect(start?.body).toContain("**Tip — Careful**")
    expect(start?.warnings).toContain("[[Missing]]")
    expect(start?.frontmatter.sources?.[0]?.resource).toBe(fileUri("/vault/01 - Guides/Start.md"))
    expect(start?.frontmatter.sources?.[0]?.last_modified).toBe("2026-10-01T00:00:00Z")
  })

  it("keeps reserved names and duplicate slugs as valid concept ids", () => {
    const drafts = convertObsidianNotes(
      [
        { relativePath: "Index.md", absolutePath: "/v/Index.md", content: "# Index\n\nA.\n" },
        { relativePath: "Log.md", absolutePath: "/v/Log.md", content: "# Log\n\nB.\n" },
        { relativePath: "Hello.md", absolutePath: "/v/Hello.md", content: "# Hello\n\nC.\n" },
        { relativePath: "Hello!.md", absolutePath: "/v/Hello!.md", content: "# Hello!\n\nD.\n" },
      ],
      NOW
    )
    expect(drafts.map((draft) => draft.id)).toEqual(["index-note", "log-note", "hello", "hello-2"])
    expect(drafts.every((draft) => draft.error === undefined)).toBe(true)
  })

  it("follows an escaped alias in a wikilink", () => {
    const drafts = convertObsidianNotes(
      [
        { relativePath: "Jev.md", absolutePath: "/v/Jev.md", content: "# Jev\n\nFast.\n" },
        {
          relativePath: "Use.md",
          absolutePath: "/v/Use.md",
          content: "See [[Jev\\|the classifier]].\n",
        },
      ],
      NOW
    )
    expect(drafts.find((draft) => draft.id === "use")?.body).toContain("[the classifier](./jev.md)")
  })
})

describe("knowledge library helpers", () => {
  it("groups concepts and names who produced them", () => {
    expect(actorLabel("process:obsidian-import")).toBe("Imported from Obsidian")
    expect(actorLabel("human:local")).toBe("You")
    const groups = groupKnowledge([
      { title: "Beta", folder: "guides" },
      { title: "Alpha", folder: "guides" },
      { title: "Map", folder: "" },
    ])
    expect(groups.map((group) => group.label)).toEqual(["Top", "Guides"])
    expect(groups[1]?.items.map((item) => item.title)).toEqual(["Alpha", "Beta"])
  })

  it("lists a concept without its body", () => {
    const item = toKnowledgeListItem(
      {
        id: "guides/start",
        body: "Long body",
        warnings: [],
        frontmatter: {
          type: "How To",
          title: "Start",
          description: "How to begin",
          status: "draft",
          extra: {},
          verified: [{ by: "human:local", at: "2026-10-16T16:10:00Z" }],
        },
      },
      NOW
    )
    expect(item).toMatchObject({
      id: "guides/start",
      folder: "guides",
      trust: "human-reviewed",
      stale: false,
    })
    expect(item).not.toHaveProperty("body")
  })

  it("builds graph links only between saved concepts", () => {
    const concept = (id: string, body: string) => ({
      id,
      body,
      warnings: [],
      frontmatter: { type: "Reference", title: id, description: id, extra: {} },
    })
    const view = toKnowledgeLibraryView(
      [
        concept("architecture/brain", "See [Workflows](./workflows.md) and [Missing](./missing.md)."),
        concept("architecture/workflows", "Back to [Brain](./brain.md)."),
      ],
      NOW
    )

    expect(view.concepts).toHaveLength(2)
    expect(view.links).toEqual([
      { source: "architecture/brain", target: "architecture/workflows" },
      { source: "architecture/workflows", target: "architecture/brain" },
    ])
  })
})
