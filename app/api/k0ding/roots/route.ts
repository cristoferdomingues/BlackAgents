import { handle } from "@/lib/api-response"
import { addCodeRoot, listCodeRoots } from "@/lib/k0ding/store"
import { k0dingOk } from "@/lib/k0ding/route-result"
import { k0dingWorkspace } from "@/lib/k0ding/scope"

export async function GET(): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const { workspace, scope } = await k0dingWorkspace()
      return { roots: await listCodeRoots(workspace, scope) }
    })
  )
}

export async function POST(req: Request): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const { workspace, scope } = await k0dingWorkspace()
      return addCodeRoot(workspace, scope, await req.json().catch(() => null))
    }, 201)
  )
}
