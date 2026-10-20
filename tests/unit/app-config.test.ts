import { describe, expect, it } from "vitest"

import { DEFAULT_MODELS, LIMITS, PROVIDER_URLS, TIMEOUTS_MS } from "@/lib/app-config"
import { MAX_ATTACHMENTS, MAX_TEXT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES } from "@/lib/chat/attachments"
import { OPENROUTER_BASE_URL } from "@/lib/decision/client"
import { MAX_STEP_FILES as FILES_MAX_STEP_FILES } from "@/lib/files/schema"
import { MODEL_TASKS } from "@/lib/llm/task-models"
import { MAX_WATCH_SECONDS } from "@/lib/llm/watch-video"
import { DEFAULT_MAX_TURNS, MAX_TURNS_LIMIT } from "@/lib/runtime/agent-loop"
import { APPROVAL_TIMEOUT_MS } from "@/lib/runtime/approvals"
import { aiSettingsSchema } from "@/lib/settings"
import { MAX_STEP_FILES as WORKFLOW_MAX_STEP_FILES } from "@/lib/workflows/schema"

describe("app config", () => {
  it("is the one source for shared limits", () => {
    expect(MAX_ATTACHMENTS).toBe(LIMITS.attachments.maxCount)
    expect(MAX_TEXT_BYTES).toBe(LIMITS.attachments.textBytes)
    expect(MAX_TOTAL_ATTACHMENT_BYTES).toBe(LIMITS.attachments.totalBytes)
    expect(MAX_WATCH_SECONDS).toBe(LIMITS.watchVideo.maxSeconds)
    expect(FILES_MAX_STEP_FILES).toBe(LIMITS.workflows.maxStepFiles)
    expect(WORKFLOW_MAX_STEP_FILES).toBe(LIMITS.workflows.maxStepFiles)
    expect([DEFAULT_MAX_TURNS, MAX_TURNS_LIMIT]).toEqual([
      LIMITS.agentLoop.defaultMaxTurns,
      LIMITS.agentLoop.maxTurns,
    ])
    expect(APPROVAL_TIMEOUT_MS).toBe(TIMEOUTS_MS.approval)
  })

  it("feeds default models, URLs, and settings defaults", () => {
    expect(MODEL_TASKS.voice.openRouterDefault).toBe(DEFAULT_MODELS.openRouter.voice)
    expect(MODEL_TASKS.video.openRouterDefault).toBe(DEFAULT_MODELS.openRouter.video)
    expect(OPENROUTER_BASE_URL).toBe(PROVIDER_URLS.openRouter)
    expect(aiSettingsSchema.parse({}).assistant.maxToolTurns).toBe(LIMITS.agentLoop.defaultMaxTurns)
  })

  it("keeps a sane order between limits", () => {
    expect(LIMITS.attachments.totalBytes).toBeGreaterThanOrEqual(LIMITS.attachments.pdfBytes)
    expect(LIMITS.agentLoop.defaultMaxTurns).toBeLessThanOrEqual(LIMITS.agentLoop.maxTurns)
    expect(LIMITS.workflows.defaultStepTurns).toBeLessThanOrEqual(LIMITS.workflows.maxStepTurns)
    expect(LIMITS.workflows.defaultStepTimeoutMinutes).toBeLessThanOrEqual(LIMITS.workflows.maxStepTimeoutMinutes)
    expect(LIMITS.workflows.defaultRunTimeoutMinutes).toBeLessThanOrEqual(LIMITS.workflows.maxRunTimeoutMinutes)
  })
})
