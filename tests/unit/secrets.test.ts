import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  getProviderSecret,
  readSecrets,
  removeProviderSecret,
  setDefaults,
  setProviderSecret,
  setProviderVerification,
  toStatusList,
} from "@/lib/secrets"
import { PROVIDER_IDS } from "@/lib/llm/registry"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ba-sec-"))
  process.env.BLACK_AGENTS_CONFIG_DIR = dir
})
afterEach(async () => {
  delete process.env.BLACK_AGENTS_CONFIG_DIR
  await rm(dir, { recursive: true, force: true })
})

describe("secrets storage", () => {
  it("returns empty providers when no file exists", async () => {
    expect(await readSecrets()).toEqual({ providers: {}, defaults: undefined })
  })

  it("stores and reads back a provider secret", async () => {
    await setProviderSecret("openai", { apiKey: "sk-test-1234" })
    expect(await getProviderSecret("openai")).toEqual({ apiKey: "sk-test-1234" })
  })

  it("treats legacy credentials as unverified and persists later checks", async () => {
    await setProviderSecret("openai", { apiKey: "sk-test-1234" })
    let status = toStatusList(await readSecrets(), PROVIDER_IDS).find(
      (item) => item.id === "openai"
    )
    expect(status?.verificationStatus).toBe("unverified")
    expect(status?.checkedAt).toBeUndefined()

    await setProviderVerification("openai", {
      status: "valid",
      checkedAt: "2026-08-21T10:00:00.000Z",
    })
    status = toStatusList(await readSecrets(), PROVIDER_IDS).find(
      (item) => item.id === "openai"
    )
    expect(status?.verificationStatus).toBe("valid")
    expect(status?.checkedAt).toBe("2026-08-21T10:00:00.000Z")
  })

  it("writes the secrets file with 0600 permissions", async () => {
    await setProviderSecret("openai", { apiKey: "sk-1234" })
    const mode = (await stat(path.join(dir, "secrets.json"))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it("removes a provider and clears it from defaults", async () => {
    await setProviderSecret("openai", { apiKey: "sk-1234" })
    await setDefaults({ provider: "openai", model: "gpt-4o-mini" })
    const secrets = await removeProviderSecret("openai")
    expect(secrets.providers.openai).toBeUndefined()
    expect(secrets.defaults?.provider).toBeUndefined()
    expect(secrets.defaults?.model).toBe("gpt-4o-mini")
  })

  it("merges defaults across calls", async () => {
    await setDefaults({ provider: "anthropic" })
    const secrets = await setDefaults({ model: "claude-3" })
    expect(secrets.defaults).toEqual({ provider: "anthropic", model: "claude-3" })
  })
})

describe("toStatusList", () => {
  it("redacts keys to configured + last4 and keeps baseUrl", async () => {
    await setProviderSecret("custom", { apiKey: "abcd1234WXYZ", baseUrl: "http://x/v1" })
    const statuses = toStatusList(await readSecrets(), PROVIDER_IDS)

    const custom = statuses.find((s) => s.id === "custom")!
    expect(custom.configured).toBe(true)
    expect(custom.last4).toBe("WXYZ")
    expect(custom.baseUrl).toBe("http://x/v1")
    expect(custom.verificationStatus).toBe("unverified")
    // never leaks the full key
    expect(JSON.stringify(statuses)).not.toContain("abcd1234WXYZ")

    const openai = statuses.find((s) => s.id === "openai")!
    expect(openai.configured).toBe(false)
    expect(openai.last4).toBeUndefined()
  })
})
