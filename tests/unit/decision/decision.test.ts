import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { evaluateArtifactRouting } from "@/lib/decision/classify-artifacts"
import {
  getDecisionCredentials,
  isOpenRouterBaseUrl,
  loadDecisionClient,
  resolveDecisionClient,
  resolveDecisionProvider,
  type DecisionCredentials,
} from "@/lib/decision/client"
import { probeDecisionEngine } from "@/lib/decision/probe"
import { setJevApiKey, setJevOpenRouterApiKey, setProviderSecret } from "@/lib/secrets"
import { updateAiSettings } from "@/lib/settings"

import { choiceAnswer, fakeJev } from "../../helpers/jev"
import { makeTempEnv, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const creds = (over: Partial<DecisionCredentials>): DecisionCredentials => ({
  enabled: true,
  providerPreference: "auto",
  openRouterKeySource: "reuse",
  directApiKey: null,
  openRouterApiKey: null,
  aiOpenRouterAvailable: false,
  ...over,
})

describe("decision client", () => {
  it("routes by preference and available keys", () => {
    expect(resolveDecisionProvider(creds({ enabled: false, directApiKey: "k" }))).toBeNull()
    expect(resolveDecisionProvider(creds({ directApiKey: "k", openRouterApiKey: "o" }))).toBe("direct")
    expect(resolveDecisionProvider(creds({ openRouterApiKey: "o" }))).toBe("openrouter")
    expect(resolveDecisionProvider(creds({ providerPreference: "direct", openRouterApiKey: "o" }))).toBeNull()
    expect(resolveDecisionProvider(creds({ providerPreference: "openrouter", directApiKey: "k" }))).toBeNull()
    expect(resolveDecisionClient(creds({ directApiKey: "k" }))?.provider).toBe("direct")
    expect(resolveDecisionClient(creds({ providerPreference: "openrouter", openRouterApiKey: "o" }))?.provider).toBe("openrouter")
    expect(resolveDecisionClient(creds({}))).toBeNull()
  })

  it("recognizes only the exact openrouter.ai host", () => {
    expect(isOpenRouterBaseUrl("https://openrouter.ai/api/v1")).toBe(true)
    expect(isOpenRouterBaseUrl("https://evil-openrouter.ai.example.com")).toBe(false)
    expect(isOpenRouterBaseUrl("not a url")).toBe(false)
    expect(isOpenRouterBaseUrl(undefined)).toBe(false)
  })

  it("reads settings and secrets, reusing an OpenRouter custom key", async () => {
    expect(await loadDecisionClient()).toBeNull()
    await updateAiSettings({ jev: { enabled: true } })
    await setProviderSecret("custom", { apiKey: "or-key", baseUrl: "https://openrouter.ai/api/v1" })
    expect(await getDecisionCredentials()).toMatchObject({
      enabled: true,
      openRouterApiKey: "or-key",
      directApiKey: null,
      aiOpenRouterAvailable: true,
      openRouterKeySource: "reuse",
    })
    expect((await loadDecisionClient())?.provider).toBe("openrouter")
    await setJevApiKey("ts-direct-key")
    expect((await loadDecisionClient())?.provider).toBe("direct")
  })

  it("uses a dedicated Jev OpenRouter key without requiring AI Custom to be OpenRouter", async () => {
    await updateAiSettings({
      jev: { enabled: true, provider: "openrouter", openRouterKeySource: "dedicated" },
    })
    await setProviderSecret("custom", {
      apiKey: "ollama-local",
      baseUrl: "http://127.0.0.1:11434/v1",
    })
    expect(await getDecisionCredentials()).toMatchObject({
      openRouterApiKey: null,
      aiOpenRouterAvailable: false,
    })
    expect(await loadDecisionClient()).toBeNull()

    await setJevOpenRouterApiKey("sk-or-dedicated")
    expect(await getDecisionCredentials()).toMatchObject({
      openRouterApiKey: "sk-or-dedicated",
      aiOpenRouterAvailable: false,
    })
    expect((await loadDecisionClient())?.provider).toBe("openrouter")

    // TypeSafe key alone must not activate OpenRouter-only mode.
    await setJevOpenRouterApiKey(null)
    await setJevApiKey("ts-only")
    expect(await getDecisionCredentials()).toMatchObject({
      directApiKey: "ts-only",
      openRouterApiKey: null,
    })
    expect(await loadDecisionClient()).toBeNull()
  })

  it("does not treat a non-OpenRouter Custom key as reusable for Jev", async () => {
    await updateAiSettings({
      jev: { enabled: true, provider: "openrouter", openRouterKeySource: "reuse" },
    })
    await setProviderSecret("custom", {
      apiKey: "groq-key",
      baseUrl: "https://api.groq.com/openai/v1",
    })
    expect(await getDecisionCredentials()).toMatchObject({
      openRouterApiKey: null,
      aiOpenRouterAvailable: false,
    })
  })

  it("prefers dedicated over reuse only when source is dedicated", async () => {
    await updateAiSettings({
      jev: { enabled: true, provider: "openrouter", openRouterKeySource: "reuse" },
    })
    await setProviderSecret("custom", {
      apiKey: "or-shared",
      baseUrl: "https://openrouter.ai/api/v1",
    })
    await setJevOpenRouterApiKey("or-dedicated")
    expect(await getDecisionCredentials()).toMatchObject({ openRouterApiKey: "or-shared" })

    await updateAiSettings({ jev: { openRouterKeySource: "dedicated" } })
    expect(await getDecisionCredentials()).toMatchObject({ openRouterApiKey: "or-dedicated" })
  })
})

describe("evaluateArtifactRouting", () => {
  const candidates = [
    { type: "skill" as const, name: "testing", description: "How to test" },
    { type: "rule" as const, name: "style", description: "x".repeat(400) },
  ]

  it("returns picked with the candidate", async () => {
    const jev = fakeJev({ artifact: choiceAnswer("C1", 0.9) })
    const decision = await evaluateArtifactRouting({ message: "hi", candidates, resolved: jev })
    expect(decision).toEqual({ kind: "picked", type: "rule", name: "style", confidence: 0.9, model: "jev-test" })
    const request = jev.systemOne.mock.calls[0][0] as { questions: { artifact: { criteria: Record<string, string> } } }
    expect(request.questions.artifact.criteria.C1.length).toBeLessThanOrEqual(200)
    expect(request.questions.artifact.criteria.NONE).toBeDefined()
  })

  it("handles none, unknown labels, errors, no client, and no candidates", async () => {
    expect((await evaluateArtifactRouting({ message: "m", candidates, resolved: fakeJev({ artifact: choiceAnswer("NONE", 0.7) }) })).kind).toBe("none")
    expect(await evaluateArtifactRouting({ message: "m", candidates, resolved: fakeJev({ artifact: choiceAnswer("C9", 0.9) }) })).toMatchObject({ kind: "error" })
    expect(await evaluateArtifactRouting({ message: "m", candidates, resolved: fakeJev(new Error("timeout")) })).toEqual({ kind: "error", message: "timeout" })
    expect(await evaluateArtifactRouting({ message: "m", candidates, resolved: null })).toEqual({ kind: "unavailable" })
    expect(await evaluateArtifactRouting({ message: "m", candidates: [], resolved: null })).toEqual({ kind: "skipped" })
  })
})

describe("probeDecisionEngine", () => {
  it("reports disabled, not configured, and errors", async () => {
    expect(await probeDecisionEngine(creds({ enabled: false }))).toMatchObject({ ok: false, code: "JEV_DISABLED" })
    expect(await probeDecisionEngine(creds({}))).toMatchObject({ ok: false, code: "JEV_NOT_CONFIGURED" })
    expect(await probeDecisionEngine()).toMatchObject({ ok: false, code: "JEV_DISABLED" })
  })
})
