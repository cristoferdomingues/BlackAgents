import { getVerifiedCredentials } from "@/lib/llm/credentials"
import { getProvider, PROVIDER_IDS } from "@/lib/llm/registry"
import type { LLMCredentials, LLMProvider, ProviderId } from "@/lib/llm/types"
import { readSecrets, type ProviderSecret } from "@/lib/secrets"

export interface ResolvedLlm {
  provider: LLMProvider
  credentials: LLMCredentials
  secret: ProviderSecret
  model: string
}

/**
 * Pick the LLM for a background run: the workflow's own provider/model, else
 * the saved Assistant defaults, else the first verified provider. Throws a
 * readable error (e.g. CredentialStateError) when nothing usable exists.
 */
export async function resolveRunLlm(choice: {
  provider?: ProviderId
  model?: string
}): Promise<ResolvedLlm> {
  const secrets = await readSecrets()
  const verified = PROVIDER_IDS.filter(
    (id) => secrets.providers[id]?.verification?.status === "valid"
  )
  const id = choice.provider ?? secrets.defaults?.provider ?? verified[0]
  const provider = id ? getProvider(id) : undefined
  if (!provider) throw new Error("No verified AI provider. Verify one under AI Providers.")
  const model =
    choice.model?.trim() ||
    (secrets.defaults?.provider === provider.id ? secrets.defaults.model : undefined) ||
    provider.models[0]
  if (!model) throw new Error(`Choose a model for ${provider.label} in the workflow settings`)
  const { credentials, secret } = await getVerifiedCredentials(provider)
  return { provider, credentials, secret, model }
}
