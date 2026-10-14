import { randomUUID } from "node:crypto"

import type { PendingLogin } from "./schema"

export const LOGIN_WAIT_MS = 15 * 60_000

export type LoginDecision =
  | { action: "save" }
  | { action: "already" }
  | { action: "cancel" }

interface Pending {
  request: PendingLogin
  resolve: (decision: LoginDecision) => void
  timer: ReturnType<typeof setTimeout>
}

const globalKey = Symbol.for("black-agents.login-waits")
type GlobalWithWaits = typeof globalThis & { [globalKey]?: Map<string, Pending> }

function registry(): Map<string, Pending> {
  const g = globalThis as GlobalWithWaits
  if (!g[globalKey]) g[globalKey] = new Map()
  return g[globalKey]
}

export interface LoginHandle {
  request: PendingLogin
  decision: Promise<LoginDecision>
}

/** Park a workflow step until the user submits a login or cancels. */
export function requestLogin(
  input: Omit<PendingLogin, "id">,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): LoginHandle {
  const request: PendingLogin = { ...input, id: randomUUID() }
  const map = registry()
  const decision = new Promise<LoginDecision>((resolve) => {
    const finish = (value: LoginDecision) => {
      const pending = map.get(request.id)
      if (!pending) return
      clearTimeout(pending.timer)
      map.delete(request.id)
      resolve(value)
    }
    const timer = setTimeout(() => finish({ action: "cancel" }), options.timeoutMs ?? LOGIN_WAIT_MS)
    map.set(request.id, { request, resolve: finish, timer })
    if (options.signal) {
      const abort = () => finish({ action: "cancel" })
      if (options.signal.aborted) abort()
      else options.signal.addEventListener("abort", abort, { once: true })
    }
  })
  return { request, decision }
}

/** Wake a waiting step. False when that wait is already gone. */
export function resolveLogin(id: string, decision: LoginDecision): boolean {
  const pending = registry().get(id)
  if (!pending) return false
  pending.resolve(decision)
  return true
}
