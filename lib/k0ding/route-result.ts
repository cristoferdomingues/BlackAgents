import { fail, ok } from "@/lib/api-response"
import { CredentialStateError } from "@/lib/llm/credentials"
import { ProviderError } from "@/lib/llm/types"

import { K0dingError } from "./errors"

/** Run K0ding work and map known errors onto the API envelope. */
export async function k0dingOk<T>(fn: () => Promise<T>, status?: number): Promise<Response> {
  try {
    return ok(await fn(), status)
  } catch (err) {
    if (err instanceof K0dingError) return fail(err.message, err.status)
    if (err instanceof CredentialStateError) return fail(err.message, err.status)
    if (err instanceof ProviderError) return fail(err.message, err.status)
    throw err
  }
}
