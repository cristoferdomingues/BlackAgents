import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GET, PUT } from "@/app/api/settings/ai/route"
import { POST as TEST_JEV } from "@/app/api/settings/ai/jev-test/route"
import { GET as GET_POLICY, PUT as PUT_POLICY } from "@/app/api/mcp/policy/route"
import { readSecrets } from "@/lib/secrets"

import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("/api/settings/ai", () => {
  it("returns defaults without keys", async () => {
    const body = await (await GET()).json()
    expect(body.data).toEqual({
      settings: {
        assistant: { maxToolTurns: 25, autoApproveFileWrites: false },
        jev: {
          enabled: false,
          provider: "auto",
          openRouterKeySource: "reuse",
          cutoffs: { artifactRouting: "balanced", skillSuggest: "balanced", stepGate: "balanced", learning: "balanced" },
        },
        models: {},
        browser: { updateFlowsOnHeal: false, headless: false },
      },
      jevKey: { configured: false },
      jevOpenRouterKey: { configured: false },
      aiOpenRouter: { available: false },
      openRouterAvailable: false,
      activeProvider: null,
    })
  })

  it("saves settings and a write-only Jev key", async () => {
    const res = await PUT(
      jsonRequest("http://t/api/settings/ai", "PUT", {
        assistant: { maxToolTurns: 12 },
        jev: { enabled: true },
        jevApiKey: "ts-secret-1234",
      })
    )
    const body = await res.json()
    expect(body.data.settings.assistant.maxToolTurns).toBe(12)
    expect(body.data.settings.assistant.autoApproveFileWrites).toBe(false)
    expect(body.data.jevKey).toEqual({ configured: true, last4: "1234" })
    expect(JSON.stringify(body)).not.toContain("ts-secret")
    expect(body.data.activeProvider).toBe("direct")
    expect((await readSecrets()).jev?.apiKey).toBe("ts-secret-1234")

    await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { jevApiKey: null }))
    expect((await readSecrets()).jev).toBeUndefined()
  })

  it("saves a dedicated OpenRouter key for Jev without treating it as TypeSafe", async () => {
    const res = await PUT(
      jsonRequest("http://t/api/settings/ai", "PUT", {
        jev: { enabled: true, provider: "openrouter", openRouterKeySource: "dedicated" },
        jevOpenRouterApiKey: "sk-or-jev-only-9999",
      })
    )
    const body = await res.json()
    expect(body.data.jevKey).toEqual({ configured: false })
    expect(body.data.jevOpenRouterKey).toEqual({ configured: true, last4: "9999" })
    expect(body.data.openRouterAvailable).toBe(true)
    expect(body.data.activeProvider).toBe("openrouter")
    expect(JSON.stringify(body)).not.toContain("sk-or-jev")
    expect((await readSecrets()).jev).toEqual({ openRouterApiKey: "sk-or-jev-only-9999" })

    // Clearing dedicated key must not leave a TypeSafe-shaped secret.
    await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { jevOpenRouterApiKey: null }))
    expect((await readSecrets()).jev).toBeUndefined()
  })

  it("keeps TypeSafe and dedicated OpenRouter keys independent", async () => {
    await PUT(
      jsonRequest("http://t/api/settings/ai", "PUT", {
        jevApiKey: "ts-secret-1234",
        jevOpenRouterApiKey: "sk-or-jev-only-9999",
      })
    )
    expect((await readSecrets()).jev).toEqual({
      apiKey: "ts-secret-1234",
      openRouterApiKey: "sk-or-jev-only-9999",
    })
    await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { jevApiKey: null }))
    expect((await readSecrets()).jev).toEqual({ openRouterApiKey: "sk-or-jev-only-9999" })
  })

  it("saves one Jev level and keeps the others", async () => {
    await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { jev: { cutoffs: { stepGate: "careful" } } }))
    const res = await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { jev: { cutoffs: { artifactRouting: "eager" } } }))
    expect((await res.json()).data.settings.jev.cutoffs).toEqual({
      artifactRouting: "eager",
      skillSuggest: "balanced",
      stepGate: "careful",
      learning: "balanced",
    })
    expect((await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { jev: { enabled: true } }))).status).toBe(200)
    expect((await (await GET()).json()).data.settings.jev.cutoffs.stepGate).toBe("careful")
  })

  it("rejects invalid values", async () => {
    expect((await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { jev: { cutoffs: { stepGate: "reckless" } } }))).status).toBe(400)
    const fixed = await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { jev: { cutoffs: { preflight: "eager" } } }))
    expect((await fixed.json()).data.settings.jev.cutoffs).not.toHaveProperty("preflight")
    expect((await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { assistant: { maxToolTurns: 101 } }))).status).toBe(400)
    expect((await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { jevApiKey: "x" }))).status).toBe(400)
    expect((await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { jevOpenRouterApiKey: "x" }))).status).toBe(400)
  })

  it("tests Jev and reports a disabled engine as 412", async () => {
    expect((await TEST_JEV()).status).toBe(412)
  })
})

describe("/api/mcp/policy", () => {
  it("defaults to empty and saves a server trust level", async () => {
    expect((await (await GET_POLICY()).json()).data).toEqual({ servers: {} })
    const res = await PUT_POLICY(jsonRequest("http://t/api/mcp/policy", "PUT", { server: "github", trust: "risky" }))
    expect((await res.json()).data).toEqual({ servers: { github: "risky" } })
    expect((await (await GET_POLICY()).json()).data.servers.github).toBe("risky")
  })

  it("validates input", async () => {
    expect((await PUT_POLICY(jsonRequest("http://t/api/mcp/policy", "PUT", { server: "a b", trust: "risky" }))).status).toBe(400)
    expect((await PUT_POLICY(jsonRequest("http://t/api/mcp/policy", "PUT", { server: "a", trust: "maybe" }))).status).toBe(400)
  })
})
