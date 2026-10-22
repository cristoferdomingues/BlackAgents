import { isProviderId } from "@/lib/llm/provider-id"
import { readAiSettings } from "@/lib/settings"
import type { ProviderId } from "@/lib/llm/types"

import type { MeetingNotesChoice } from "./models"
import { MeetingError } from "./store"

/**
 * Notes model: the saved Meeting choice wins.
 * Otherwise use the provider and model the caller sends (the Assistant picker).
 */
export async function resolveNotesModel(requested?: {
  provider?: string
  model?: string
}): Promise<MeetingNotesChoice> {
  const saved = (await readAiSettings()).models.meeting?.notes
  if (saved) return saved
  if (requested?.provider && requested.model && isProviderId(requested.provider)) {
    return { provider: requested.provider as ProviderId, model: requested.model }
  }
  throw new MeetingError(
    "Choose a Notes model in Settings → Models, or pick a model in the Assistant.",
    412
  )
}
