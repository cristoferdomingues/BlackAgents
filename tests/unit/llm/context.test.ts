import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { buildSystemContext } from "@/lib/llm/context"
import { DEFAULT_STANDARDS_MD } from "@/lib/standards/default-standards"
import { makeTempEnv, seedArtifact, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("buildSystemContext", () => {
  it("embeds the authoring standards and the draft protocol fence", async () => {
    const context = await buildSystemContext()
    expect(context).toContain(DEFAULT_STANDARDS_MD.slice(0, 40))
    expect(context).toContain("```artifact")
    expect(context).toContain("Authoring standards")
  })

  it("notes when the workspace has no artifacts", async () => {
    expect(await buildSystemContext()).toContain("no artifacts yet")
  })

  it("lists existing artifacts in the registry section", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/tester.md",
      "---\nname: tester\ndescription: Runs tests\n---\n\nbody\n"
    )
    const context = await buildSystemContext()
    expect(context).toContain("agent/tester: Runs tests")
  })
})
