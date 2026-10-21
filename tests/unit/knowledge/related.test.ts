import { describe, expect, it } from "vitest"

import { conceptLinkTarget, linkedConceptIds } from "@/lib/knowledge/links"
import {
  addRelatedLinks,
  conceptTerms,
  relativeConceptHref,
  suggestConceptLinks,
  type RelatedInput,
} from "@/lib/knowledge/related"

const saved: RelatedInput[] = [
  {
    id: "crypto/portfolio-metrics",
    title: "Portfolio metrics",
    description: "How we measure portfolio return and drawdown.",
    tags: ["crypto"],
    body: "Portfolio return is measured weekly. Drawdown is the drop from the peak.",
  },
  {
    id: "overview/tech-stack",
    title: "Tech stack",
    description: "Next.js, TypeScript, and Electron.",
    body: "The app uses Next.js and Electron. Tests run with Vitest.",
  },
  {
    id: "crypto/exchange-fees",
    title: "Exchange fees",
    description: "Fees charged by each exchange.",
    tags: ["crypto"],
    body: "Binance charges a small fee per trade.",
  },
]

describe("related knowledge", () => {
  it("folds accents and drops stop words", () => {
    expect(conceptTerms("Decisões sobre o lançamento")).toEqual(["decisoe", "lancamento"])
    expect(conceptTerms("See [notes](a/b.md) at https://x.dev")).toEqual(["note"])
  })

  it("ranks the note about the same topic first and explains why", () => {
    const links = suggestConceptLinks(
      {
        id: "crypto/drawdown-alerts",
        title: "Drawdown alerts",
        tags: ["crypto"],
        body: "Send an alert when portfolio drawdown passes 20 percent. See Portfolio metrics.",
      },
      saved
    )
    expect(links[0]?.id).toBe("crypto/portfolio-metrics")
    expect(links[0]?.reason).toContain("This note names “Portfolio metrics”")
    expect(links[0]?.reason).toContain("Same tag: crypto")
    expect(links.map((link) => link.id)).not.toContain("overview/tech-stack")
  })

  it("skips itself and notes it already links to", () => {
    const links = suggestConceptLinks(
      {
        id: "crypto/drawdown-alerts",
        title: "Drawdown alerts",
        tags: ["crypto"],
        body: "Uses [metrics](portfolio-metrics.md) for portfolio drawdown.",
      },
      [...saved, { id: "crypto/drawdown-alerts", title: "Drawdown alerts", body: "old" }]
    )
    expect(links.map((link) => link.id)).not.toContain("crypto/portfolio-metrics")
    expect(links.map((link) => link.id)).not.toContain("crypto/drawdown-alerts")
  })

  it("finds nothing when no saved note shares the topic", () => {
    expect(suggestConceptLinks({ id: "food/pasta", title: "Pasta", body: "Boil water and add salt." }, saved)).toEqual([])
    expect(suggestConceptLinks({ id: "food/pasta", body: "Boil water." }, [])).toEqual([])
  })

  it("writes relative hrefs that resolve back to the concept", () => {
    const pairs: Array<[string, string]> = [
      ["meeting/2026-10-21-standup-1111", "crypto/portfolio-metrics"],
      ["crypto/a", "crypto/b"],
      ["top", "crypto/b"],
      ["meeting/app/x", "top"],
    ]
    for (const [from, to] of pairs) {
      expect(conceptLinkTarget(from, relativeConceptHref(from, to))).toBe(to)
    }
    expect(relativeConceptHref("crypto/a", "crypto/b")).toBe("b.md")
    expect(relativeConceptHref("meeting/x", "crypto/b")).toBe("../crypto/b.md")
  })

  it("adds a Related section once and does not repeat a link", () => {
    const once = addRelatedLinks("crypto/a", "Body text.", [{ id: "crypto/b", title: "B [note]" }])
    expect(once).toBe("Body text.\n\n## Related\n- [B note](b.md)\n")
    expect(addRelatedLinks("crypto/a", once, [{ id: "crypto/b", title: "B" }])).toBe(once)
  })

  it("adds to an existing Related section before the next heading", () => {
    const body = "Intro.\n\n## Related\n- [Old](old.md)\n\n## Sources\n- Book\n"
    const next = addRelatedLinks("crypto/a", body, [{ id: "crypto/b", title: "B" }])
    expect(next).toBe("Intro.\n\n## Related\n- [Old](old.md)\n- [B](b.md)\n\n## Sources\n- Book\n")
    expect(linkedConceptIds("crypto/a", next)).toEqual(["crypto/old", "crypto/b"])
  })
})
