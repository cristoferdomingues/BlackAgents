import { z } from "zod"

import { fail, handle, ok } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { nameSchema } from "@/lib/artifacts/schemas"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { loadDecisionClient } from "@/lib/decision/client"
import { evaluateSkillTriggers } from "@/lib/decision/skill-suggest"

const promptSchema = z.string().trim().min(1).max(2_000)
const bodySchema = z.object({
  name: nameSchema,
  description: z.string().trim().min(1, "Description is required").max(2_000),
  positive: z.array(promptSchema).max(6).optional(),
  negative: z.array(promptSchema).max(6).optional(),
})

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)

    const config = await readConfig()
    if (!config.currentPath) return fail("Select a workspace first", 400)
    const resolved = await loadDecisionClient()
    if (!resolved) return fail("Turn on Jev in Settings → AI to check this skill", 412)

    const artifacts = await scanWorkspace(config.currentPath)
    const result = await evaluateSkillTriggers({
      skill: { name: parsed.data.name, description: parsed.data.description },
      catalog: artifacts
        .filter((artifact) => artifact.type === "skill")
        .map((artifact) => ({ name: artifact.name, description: artifact.description })),
      resolved,
      positive: parsed.data.positive,
      negative: parsed.data.negative,
    })
    if (result.kind === "error") return fail(result.message, 502)
    if (result.kind === "unavailable") {
      return fail("Turn on Jev in Settings → AI to check this skill", 412)
    }
    return ok(result.report)
  })
}
