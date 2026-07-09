import { describe, it, expect } from "vitest"

import {
  PROVIDER_IDS,
  describeProviders,
  getProvider,
  isProviderId,
} from "@/lib/llm/registry"

describe("provider registry", () => {
  it("exposes the three built-in providers", () => {
    expect(PROVIDER_IDS.sort()).toEqual(["anthropic", "custom", "openai"])
  })

  it("isProviderId narrows known ids", () => {
    expect(isProviderId("openai")).toBe(true)
    expect(isProviderId("gemini")).toBe(false)
  })

  it("getProvider returns a provider or undefined", () => {
    expect(getProvider("anthropic")?.id).toBe("anthropic")
    expect(getProvider("nope")).toBeUndefined()
  })

  it("describeProviders returns client-safe descriptors with no credentials", () => {
    const described = describeProviders()
    expect(described).toHaveLength(3)
    for (const d of described) {
      expect(d).toHaveProperty("label")
      expect(Array.isArray(d.models)).toBe(true)
      expect(typeof d.requiresBaseUrl).toBe("boolean")
      expect(d).not.toHaveProperty("generate")
    }
    expect(described.find((d) => d.id === "custom")?.requiresBaseUrl).toBe(true)
  })
})
