import { fail, handle, ok } from "@/lib/api-response"
import { isOpenRouterBaseUrl } from "@/lib/decision/client"
import { listModelsWithModalities } from "@/lib/llm/list-models"
import {
  MODEL_TASKS,
  modelTaskSchema,
  modelsForTask,
  resolveTaskModel,
  type ModelInfo,
} from "@/lib/llm/task-models"
import { ProviderError } from "@/lib/llm/types"
import { getProviderSecret } from "@/lib/secrets"
import { readAiSettings } from "@/lib/settings"

/**
 * Models that fit one task (e.g. voice) from the Custom provider, plus the
 * saved choice and the default. Never returns API keys.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const task = modelTaskSchema.safeParse(new URL(req.url).searchParams.get("task"))
    if (!task.success) return fail("Unknown task")

    const [settings, secret] = await Promise.all([readAiSettings(), getProviderSecret("custom")])
    const baseUrl = secret?.baseUrl
    const isOpenRouter = isOpenRouterBaseUrl(baseUrl)
    const saved = settings.models[task.data]
    const base = {
      task: task.data,
      saved: saved ?? null,
      defaultModel: isOpenRouter ? MODEL_TASKS[task.data].openRouterDefault : null,
      effective: resolveTaskModel(task.data, saved, isOpenRouter) ?? null,
      custom: { configured: Boolean(baseUrl), isOpenRouter },
    }
    if (!baseUrl) return ok({ ...base, models: [] as ModelInfo[], filtered: false })

    try {
      const all = await listModelsWithModalities(baseUrl, secret?.apiKey ?? "")
      const { models, filtered } = modelsForTask(task.data, all)
      return ok({ ...base, models: models.map(({ id, name }) => ({ id, name })), filtered })
    } catch (err) {
      if (err instanceof ProviderError) {
        // The picker still accepts a typed model id when the list fails.
        return ok({ ...base, models: [] as ModelInfo[], filtered: false, warning: err.message })
      }
      throw err
    }
  })
}
