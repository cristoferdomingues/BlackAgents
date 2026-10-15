import { describe, expect, it } from "vitest"

import {
  findSecretRefs,
  formatSecretRef,
  isFullSecretRef,
  mcpSecretId,
  parseFullSecretRef,
  resolveSecretRefs,
} from "@/lib/mcp/secret-refs"
import { promoteMcpSecrets } from "@/lib/mcp/promote-secrets"
import {
  collectMcpServerSecretIds,
  mcpServerSecretStatuses,
  resolveMcpServerSecrets,
} from "@/lib/mcp/resolve-secrets"

describe("mcp secret refs", () => {
  it("builds a stable id for a header", () => {
    expect(mcpSecretId("github", "header", "Authorization")).toBe(
      "mcp.github.header.Authorization"
    )
  })

  it("detects and parses a full secret ref", () => {
    const ref = formatSecretRef("mcp.github.header.Authorization")
    expect(isFullSecretRef(ref)).toBe(true)
    expect(parseFullSecretRef(ref)).toBe("mcp.github.header.Authorization")
    expect(isFullSecretRef("Bearer ghp_x")).toBe(false)
  })

  it("resolves embedded refs and lists ids", () => {
    const value = "Bearer ${secret:mcp.github.header.Authorization}"
    expect(findSecretRefs(value)).toEqual(["mcp.github.header.Authorization"])
    expect(
      resolveSecretRefs(value, {
        "mcp.github.header.Authorization": "ghp_live",
      })
    ).toBe("Bearer ghp_live")
  })

  it("throws when a secret is missing", () => {
    expect(() =>
      resolveSecretRefs("${secret:mcp.github.header.Authorization}", {})
    ).toThrow(/not configured/)
  })
})

describe("promoteMcpSecrets", () => {
  it("moves header values into upserts and leaves placeholders", () => {
    const result = promoteMcpSecrets({
      serverName: "github",
      config: {
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer ghp_secret" },
        args: [],
        env: {},
        disabled: false,
      },
      secretHeaders: ["Authorization"],
      existingSecrets: {},
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.upserts).toEqual({
      "mcp.github.header.Authorization": "Bearer ghp_secret",
    })
    expect(result.config.headers.Authorization).toBe(
      "${secret:mcp.github.header.Authorization}"
    )
  })

  it("moves env values into upserts and leaves placeholders", () => {
    const result = promoteMcpSecrets({
      serverName: "github",
      config: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        headers: {},
        env: { GITHUB_TOKEN: "ghp_stdio_secret" },
        disabled: false,
      },
      secretEnv: ["GITHUB_TOKEN"],
      existingSecrets: {},
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.upserts).toEqual({
      "mcp.github.env.GITHUB_TOKEN": "ghp_stdio_secret",
    })
    expect(result.config.env.GITHUB_TOKEN).toBe(
      "${secret:mcp.github.env.GITHUB_TOKEN}"
    )
  })

  it("keeps an existing secret when the value is already a ref", () => {
    const result = promoteMcpSecrets({
      serverName: "github",
      config: {
        url: "https://api.githubcopilot.com/mcp/",
        headers: {
          Authorization: "${secret:mcp.github.header.Authorization}",
        },
        args: [],
        env: {},
        disabled: false,
      },
      secretHeaders: ["Authorization"],
      existingSecrets: {
        "mcp.github.header.Authorization": "Bearer ghp_existing",
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.upserts).toEqual({})
    expect(result.config.headers.Authorization).toBe(
      "${secret:mcp.github.header.Authorization}"
    )
  })
})

describe("resolveMcpServerSecrets", () => {
  it("resolves headers and reports redacted status", () => {
    const config = {
      url: "https://api.githubcopilot.com/mcp/",
      headers: {
        Authorization: "${secret:mcp.github.header.Authorization}",
      },
      args: [] as string[],
      env: {} as Record<string, string>,
      disabled: false,
    }
    const secrets = {
      "mcp.github.header.Authorization": "Bearer ghp_abcd1234",
    }
    expect(resolveMcpServerSecrets(config, secrets).headers.Authorization).toBe(
      "Bearer ghp_abcd1234"
    )
    expect(collectMcpServerSecretIds(config)).toEqual([
      "mcp.github.header.Authorization",
    ])
    expect(mcpServerSecretStatuses(config, secrets)).toEqual({
      "mcp.github.header.Authorization": { configured: true, last4: "1234" },
    })
  })

  it("resolves stdio env secrets and reports redacted status", () => {
    const config = {
      command: "npx",
      args: [] as string[],
      headers: {} as Record<string, string>,
      env: {
        GITHUB_TOKEN: "${secret:mcp.github.env.GITHUB_TOKEN}",
      },
      disabled: false,
    }
    const secrets = {
      "mcp.github.env.GITHUB_TOKEN": "ghp_abcd9999",
    }
    expect(resolveMcpServerSecrets(config, secrets).env.GITHUB_TOKEN).toBe(
      "ghp_abcd9999"
    )
    expect(mcpServerSecretStatuses(config, secrets)).toEqual({
      "mcp.github.env.GITHUB_TOKEN": { configured: true, last4: "9999" },
    })
  })
})
