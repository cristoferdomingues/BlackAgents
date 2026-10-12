import { fail, handle, ok } from "@/lib/api-response"
import { isOpenRouterBaseUrl } from "@/lib/decision/client"
import { listProviderModels } from "@/lib/llm/list-models"
import { isProviderId } from "@/lib/llm/model-ref"
import { PROVIDER_LIST } from "@/lib/llm/registry"
import {
  chatModelTaskSchema,
  MODEL_TASKS,
  modelTaskSchema,
  modelsForTask,
  resolveTaskModel,
} from "@/lib/llm/task-models"
import type { ProviderId } from "@/lib/llm/types"
import { getProviderSecret, readSecrets } from "@/lib/secrets"
import { readAiSettings } from "@/lib/settings"

/**
 * Models that fit one task, plus the saved choice. Chat kinds also take a
 * `provider` query (saved provider, else the first verified one). Never
 * returns API keys.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url)
    const task = modelTaskSchema.safeParse(url.searchParams.get("task"))
    if (!task.success) return fail("Unknown task")

    const requestedRaw = url.searchParams.get("provider")
    if (requestedRaw && !isProviderId(requestedRaw)) return fail(`Unknown provider "${requestedRaw}"`)
    const requested: ProviderId | undefined = requestedRaw && isProviderId(requestedRaw) ? requestedRaw : undefined

    const [settings, customSecret, secrets] = await Promise.all([
      readAiSettings(),
      getProviderSecret("custom"),
      readSecrets(),
    ])
    const providers = PROVIDER_LIST.map((item) => ({
      id: item.id,
      label: item.label,
      verified: secrets.providers[item.id]?.verification?.status === "valid",
    }))
    const firstVerified = providers.find((item) => item.verified)?.id
    const chat = chatModelTaskSchema.safeParse(task.data)
    const savedEntry = settings.models[task.data]
    const savedProvider = chat.success && savedEntry && typeof savedEntry === "object" ? savedEntry.provider : undefined
    const provider: ProviderId = chat.success
      ? (requested ?? savedProvider ?? firstVerified ?? "openai")
      : "custom"

    const baseUrl = customSecret?.baseUrl
    const isOpenRouter = isOpenRouterBaseUrl(baseUrl)
    const saved = savedEntry ?? null
    const savedModel = typeof savedEntry === "string" ? savedEntry : savedEntry?.model
    const effective = chat.success
      ? (savedModel ?? null)
      : (resolveTaskModel(task.data, typeof savedEntry === "string" ? savedEntry : undefined, isOpenRouter) ?? null)
    const base = {
      task: task.data,
      provider,
      saved,
      defaultModel: isOpenRouter ? (MODEL_TASKS[task.data].openRouterDefault ?? null) : null,
      effective,
      custom: { configured: Boolean(baseUrl), isOpenRouter },
      ...(chat.success ? { providers } : {}),
    }

    const listed = await listProviderModels(provider)
    const fit =
      provider === "openai" || provider === "anthropic"
        ? { models: listed.models, filtered: false as const }
        : modelsForTask(task.data, listed.models)
    const models = fit.models.map(({ id, name }) => ({ id, ...(name ? { name } : {}) }))
    return ok({
      ...base,
      models,
      filtered: fit.filtered,
      ...(listed.warning ? { warning: listed.warning } : {}),
    })
  })
}
