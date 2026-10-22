import { isProviderId } from "@/lib/llm/provider-id"
import type { ProviderId } from "@/lib/llm/types"
import { readAiSettings } from "@/lib/settings"

import { K0dingError } from "./errors"
import type { CodingModel } from "./schema"

/** Saved Coding model, or the provider and model the page sends (the Assistant picker). */
export async function resolveCodingModel(requested?: {
  provider?: string
  model?: string
}): Promise<CodingModel> {
  const saved = (await readAiSettings()).models.coding
  if (saved) return saved
  if (requested?.provider && requested.model && isProviderId(requested.provider)) {
    return { provider: requested.provider as ProviderId, model: requested.model }
  }
  throw new K0dingError(
    "Choose a Coding model in Settings → Models, or pick a model in the Assistant.",
    412
  )
}
