import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { findArtifact } from "@/lib/artifacts/parser"
import { nameSchema } from "@/lib/artifacts/schemas"
import { readConfig } from "@/lib/config"
import {
  CredentialStateError,
  getVerifiedCredentials,
  markInvalidOnAuthFailure,
} from "@/lib/llm/credentials"
import { getProvider, isProviderId } from "@/lib/llm/registry"
import {
  buildAgentPersonaContext,
  buildSystemContext,
} from "@/lib/llm/context"
import { ProviderError } from "@/lib/llm/types"

const chatRequestSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .min(1, "At least one message is required"),
  temperature: z.number().finite().min(0).max(2).optional(),
  agent: nameSchema.optional(),
})

/**
 * Bring-your-own-key chat. The API key stays server-side: it is read from the
 * local secrets file, never accepted from or returned to the client. The
 * authoring standards + workspace registry are injected as system context.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = chatRequestSchema.safeParse(
      await req.json().catch(() => null)
    )
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    }
    const body = parsed.data

    if (!isProviderId(body.provider)) {
      return fail("Unknown provider")
    }
    const provider = getProvider(body.provider)
    if (!provider) return fail("Unknown provider")

    const model = body.model?.trim() || provider.models[0]
    if (!model) return fail("A model is required for this provider")

    let systemContext: string
    if (body.agent) {
      const config = await readConfig()
      const agent = config.currentPath
        ? await findArtifact(config.currentPath, "agent", body.agent)
        : null
      if (!agent) return fail(`Agent "${body.agent}" was not found`, 404)
      systemContext = buildAgentPersonaContext(agent)
    } else {
      systemContext = await buildSystemContext()
    }

    let verified: Awaited<ReturnType<typeof getVerifiedCredentials>>
    try {
      verified = await getVerifiedCredentials(provider)
    } catch (error) {
      if (error instanceof CredentialStateError) {
        return fail(error.message, error.status)
      }
      throw error
    }

    try {
      const result = await provider.generate(
        {
          model,
          messages: body.messages,
          temperature: body.temperature,
          systemContext,
        },
        verified.credentials
      )
      return ok(result)
    } catch (err) {
      if (err instanceof ProviderError) {
        await markInvalidOnAuthFailure(provider, err, verified.secret)
        return fail(err.message, err.status)
      }
      throw err
    }
  })
}
