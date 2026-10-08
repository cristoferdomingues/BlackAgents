import { z } from "zod"

import { fail, handle, ok } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { loadDecisionClient } from "@/lib/decision/client"
import { suggestSkill } from "@/lib/decision/skill-suggest"

const bodySchema = z.object({
  prompt: z.string().trim().min(1, "Describe the task").max(2_000, "The task is too long"),
})

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)

    const config = await readConfig()
    if (!config.currentPath) return fail("Select a workspace first", 400)
    const resolved = await loadDecisionClient()
    if (!resolved) return fail("Turn on Jev in Settings → AI to suggest a skill", 412)

    const artifacts = await scanWorkspace(config.currentPath)
    const suggestion = await suggestSkill({
      prompt: parsed.data.prompt,
      skills: artifacts
        .filter((artifact) => artifact.type === "skill")
        .map((artifact) => ({ name: artifact.name, description: artifact.description })),
      resolved,
    })
    if (suggestion.kind === "error") return fail(suggestion.message, 502)
    return ok(suggestion)
  })
}
