import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { isBrowserSecretId } from "@/lib/browser"
import {
  browserSecretsStatus,
  readSecrets,
  setBrowserSecrets,
} from "@/lib/secrets"

const putSchema = z.object({
  /** Map of browser.* id → value. Empty string ignored. */
  secrets: z.record(z.string().trim().min(1), z.string()).default({}),
  removeIds: z.array(z.string().trim().min(1)).optional(),
})

/** List redacted statuses for all configured browser.* secrets. */
export async function GET() {
  return handle(async () => {
    const secrets = await readSecrets()
    const ids = Object.keys(secrets.browser ?? {}).sort()
    return ok({ secretStatuses: browserSecretsStatus(secrets, ids), ids })
  })
}

/** Upsert / remove browser flow secrets (never returned in plaintext). */
export async function PUT(req: Request) {
  return handle(async () => {
    const parsed = putSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
    }

    for (const id of Object.keys(parsed.data.secrets)) {
      if (!isBrowserSecretId(id)) {
        return fail(
          `Invalid secret id "${id}". Use browser.<name> (letters, digits, . _ -).`,
          400
        )
      }
    }
    for (const id of parsed.data.removeIds ?? []) {
      if (!isBrowserSecretId(id) && !id.startsWith("browser.")) {
        return fail(`Invalid remove id "${id}"`, 400)
      }
    }

    await setBrowserSecrets(parsed.data.secrets, parsed.data.removeIds ?? [])

    const secrets = await readSecrets()
    const ids = Object.keys(secrets.browser ?? {}).sort()
    return ok({ saved: true, secretStatuses: browserSecretsStatus(secrets, ids), ids })
  })
}
