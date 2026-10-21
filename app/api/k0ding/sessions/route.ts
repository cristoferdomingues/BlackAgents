import { fail, handle, ok } from "@/lib/api-response"
import { CredentialStateError } from "@/lib/llm/credentials"
import { ProviderError } from "@/lib/llm/types"
import { K0dingError } from "@/lib/k0ding/errors"
import { buildTaskMessage } from "@/lib/k0ding/prompt"
import { resolveCodingModel } from "@/lib/k0ding/resolve"
import { openCodingProvider, runCodingTurn } from "@/lib/k0ding/run"
import { codeRootIdSchema, sessionView, startSessionSchema } from "@/lib/k0ding/schema"
import { k0dingWorkspace } from "@/lib/k0ding/scope"
import { createCodingSession, latestCodingSession } from "@/lib/k0ding/sessions"
import { requireCodeRoot } from "@/lib/k0ding/store"
import { sseResponse } from "@/lib/sse"

function knownError(err: unknown): Response | null {
  if (err instanceof K0dingError) return fail(err.message, err.status)
  if (err instanceof CredentialStateError) return fail(err.message, err.status)
  if (err instanceof ProviderError) return fail(err.message, err.status)
  return null
}

export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    try {
      const { workspace, scope } = await k0dingWorkspace()
      const rootId = new URL(req.url).searchParams.get("rootId") ?? ""
      if (!codeRootIdSchema.safeParse(rootId).success) throw new K0dingError("Invalid code folder id")
      const session = await latestCodingSession(workspace, scope, rootId)
      return ok({ session: session ? sessionView(session) : null })
    } catch (err) {
      const mapped = knownError(err)
      if (mapped) return mapped
      throw err
    }
  })
}

export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    try {
      const parsed = startSessionSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
      const { workspace, scope } = await k0dingWorkspace()
      const root = await requireCodeRoot(workspace, scope, parsed.data.rootId)
      const model = await resolveCodingModel(parsed.data)
      const opened = await openCodingProvider(model)
      const content = await buildTaskMessage(root.path, parsed.data.prompt, parsed.data.context)
      const session = await createCodingSession({
        workspace,
        scope,
        rootId: root.id,
        context: parsed.data.context,
        model,
        messages: [{ role: "user", content }],
      })
      return sseResponse(async (send, signal) => {
        const saved = await runCodingTurn({
          workspace,
          scope,
          codeRoot: root,
          session,
          provider: opened.provider,
          credentials: opened.credentials,
          send,
          signal,
        })
        send("done", { session: sessionView(saved) })
      }, req.signal)
    } catch (err) {
      const mapped = knownError(err)
      if (mapped) return mapped
      throw err
    }
  })
}
