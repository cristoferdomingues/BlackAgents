import { fail, handle } from "@/lib/api-response"
import { CredentialStateError } from "@/lib/llm/credentials"
import { ProviderError } from "@/lib/llm/types"
import { K0dingError } from "@/lib/k0ding/errors"
import { openCodingProvider, runCodingTurn } from "@/lib/k0ding/run"
import { followUpSchema, sessionView } from "@/lib/k0ding/schema"
import { k0dingWorkspace } from "@/lib/k0ding/scope"
import { readCodingSession, saveCodingSession } from "@/lib/k0ding/sessions"
import { requireCodeRoot } from "@/lib/k0ding/store"
import { sseResponse } from "@/lib/sse"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(async () => {
    try {
      const parsed = followUpSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
      const { workspace, scope } = await k0dingWorkspace()
      const current = await readCodingSession(workspace, (await ctx.params).id)
      if (!current) throw new K0dingError("Coding session not found", 404)
      if (current.status === "running") throw new K0dingError("This run is still going", 409)
      const root = await requireCodeRoot(workspace, scope, current.rootId)
      const opened = await openCodingProvider(current.model)
      const pending = current.changes.filter((change) => change.state === "pending").map((change) => change.path)
      const note = pending.length > 0 ? `Staged files still waiting: ${pending.join(", ")}.\n` : ""
      const session = await saveCodingSession(workspace, scope, {
        ...current,
        status: "running",
        messages: [...current.messages, { role: "user", content: `${note}Follow-up:\n${parsed.data.prompt}` }],
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
      if (err instanceof K0dingError) return fail(err.message, err.status)
      if (err instanceof CredentialStateError) return fail(err.message, err.status)
      if (err instanceof ProviderError) return fail(err.message, err.status)
      throw err
    }
  })
}
