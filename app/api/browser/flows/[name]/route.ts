import { ok, fail, handle } from "@/lib/api-response"
import { deleteBrowserFlow, readBrowserFlow } from "@/lib/browser"
import { nameSchema } from "@/lib/artifacts/schemas"
import { readConfig } from "@/lib/config"

type Params = { params: Promise<{ name: string }> }

export async function GET(_req: Request, { params }: Params) {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return fail("No active workspace selected", 400)

    const name = nameSchema.safeParse((await params).name)
    if (!name.success) return fail("Invalid flow name", 400)

    const flow = await readBrowserFlow(config.currentPath, name.data)
    if (!flow) return fail(`Flow "${name.data}" not found`, 404)
    return ok({ flow })
  })
}

export async function DELETE(_req: Request, { params }: Params) {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return fail("No active workspace selected", 400)

    const name = nameSchema.safeParse((await params).name)
    if (!name.success) return fail("Invalid flow name", 400)

    const deleted = await deleteBrowserFlow(config.currentPath, name.data)
    if (!deleted) return fail(`Flow "${name.data}" not found`, 404)
    return ok({ deleted: name.data })
  })
}
