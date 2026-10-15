import { describe, expect, it } from "vitest"

import { abilityChoiceOf } from "@/lib/artifacts/abilities"
import { editorChecks } from "@/lib/artifacts/editor-helpers"
import { artifactInputSchema } from "@/lib/artifacts/schemas"
import { STARTER_TEMPLATES } from "@/lib/artifacts/starter-templates"
import type { ArtifactType } from "@/lib/artifacts/types"

const TYPES: ArtifactType[] = ["agent", "rule", "skill", "command"]

describe("STARTER_TEMPLATES", () => {
  it("has at least one template for every type, with unique ids", () => {
    for (const type of TYPES) {
      const list = STARTER_TEMPLATES[type]
      expect(list.length).toBeGreaterThan(0)
      expect(new Set(list.map((t) => t.id)).size).toBe(list.length)
    }
  })

  it("only holds templates that pass every editor check", () => {
    for (const type of TYPES) {
      for (const t of STARTER_TEMPLATES[type]) {
        const failed = editorChecks({ type, name: t.name, description: t.description, body: t.body }).filter(
          (c) => !c.ok
        )
        expect(failed, `${type}/${t.id}`).toEqual([])
      }
    }
  })

  it("only holds templates the save API accepts", () => {
    for (const type of TYPES) {
      for (const t of STARTER_TEMPLATES[type]) {
        const parsed = artifactInputSchema.safeParse({
          type,
          platform: "cursor",
          name: t.name,
          description: t.description,
          body: t.body,
          extra: { tools: t.tools, parallel: t.parallel, alwaysApply: t.alwaysApply, globs: t.globs },
        })
        expect(parsed.success, `${type}/${t.id}`).toBe(true)
      }
    }
  })

  it("gives agent templates a clear ability level", () => {
    for (const t of STARTER_TEMPLATES.agent) {
      expect(t.tools).toBeDefined()
      expect(abilityChoiceOf(t.tools ?? [])).not.toBe("custom")
    }
  })
})
