import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { loadStandards, resetStandards, saveStandards } from "@/lib/standards"

const putSchema = z.object({ content: z.string().min(1) })

export async function GET() {
  return handle(async () => ok(await loadStandards()))
}

export async function PUT(req: Request) {
  return handle(async () => {
    const json = await req.json().catch(() => null)
    const parsed = putSchema.safeParse(json)
    if (!parsed.success) return fail("Content is required")
    return ok(await saveStandards(parsed.data.content))
  })
}

export async function DELETE() {
  return handle(async () => ok(await resetStandards()))
}
