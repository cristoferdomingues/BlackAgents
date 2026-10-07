import { ok, fail, handle } from "@/lib/api-response"
import { processSignal } from "@/lib/brain/learn"
import { feedbackSignalSchema } from "@/lib/brain/types"
import { readConfig } from "@/lib/config"

/** Record feedback; may create a pending proposal in the Brain inbox. */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = feedbackSignalSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid feedback")
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    return ok(await processSignal(currentPath, parsed.data))
  })
}
