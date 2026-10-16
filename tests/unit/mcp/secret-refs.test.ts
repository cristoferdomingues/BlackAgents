import { describe, expect, it } from "vitest"

import { blankPlainHeaderError } from "@/lib/mcp/headers"
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
  firstMissingMcpSecret,
  mcpServerSecretStatuses,
  redactMcpServerStatus,
  redactSecretValues,
  resolveMcpServerSecrets,
} from "@/lib/mcp/resolve-secrets"
import type { McpServerStatus } from "@/lib/mcp/types"

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

  it("keeps a stored secret when the replacement is blank", () => {
    const result = promoteMcpSecrets({
      serverName: "github",
      config: {
        command: "npx",
        args: [],
        headers: {},
        env: { GITHUB_TOKEN: "  " },
        disabled: false,
      },
      secretEnv: ["GITHUB_TOKEN"],
      existingSecrets: {
        "mcp.github.env.GITHUB_TOKEN": "ghp_stdio_secret",
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.upserts).toEqual({})
    expect(result.config.env.GITHUB_TOKEN).toBe("${secret:mcp.github.env.GITHUB_TOKEN}")
  })

  it("rejects a placeholder whose secret is missing", () => {
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
      existingSecrets: {},
    })
    expect(result).toEqual({
      ok: false,
      error: 'MCP secret "mcp.github.header.Authorization" is not configured',
    })
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

  it("finds the first secret that has no stored value", () => {
    const config = {
      url: "https://app.example/api/mcp",
      headers: { Authorization: "${secret:mcp.github.header.Authorization}" },
      args: [] as string[],
      env: {} as Record<string, string>,
      disabled: false,
    }
    expect(firstMissingMcpSecret(config, {})).toBe("mcp.github.header.Authorization")
    expect(
      firstMissingMcpSecret(config, {
        "mcp.github.header.Authorization": "Bearer ghp_stored",
      })
    ).toBeNull()
  })
})

describe("redact MCP secrets", () => {
  const draft = "Bearer ghp_test_token_9999"
  const stored = "ghp_stdio_stored_4242"

  it("replaces longer secret values before shorter ones", () => {
    const inner = "ghp_test_token_9999"
    expect(
      redactSecretValues(`saw ${draft} and ${stored}`, { a: draft, b: stored, c: inner }, 4)
    ).toBe("saw ••••9999 and ••••4242")
    expect(redactSecretValues("short", { a: "no" })).toBe("short")
  })

  it("masks a draft secret in headers and strips it from errors and tools", () => {
    const status: McpServerStatus = {
      name: "github",
      status: "error",
      error: `rejected ${draft}`,
      config: {
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: draft },
        args: [],
        env: {},
        disabled: false,
      },
      tools: [
        {
          server: "github",
          name: "list",
          description: `uses ${draft}`,
          inputSchema: { note: stored },
        },
      ],
    }
    const redacted = redactMcpServerStatus(
      status,
      {
        "mcp.github.header.Authorization": draft,
        "mcp.github.env.GITHUB_TOKEN": stored,
      },
      { "mcp.github.header.Authorization": draft }
    )
    expect(redacted.config.headers.Authorization).toBe("${secret:mcp.github.header.Authorization}")
    expect(redacted.error).toBe("rejected ••••9999")
    expect(redacted.tools[0]?.description).toBe("uses ••••9999")
    expect(redacted.tools[0]?.inputSchema.note).toBe("••••4242")
    expect(JSON.stringify(redacted)).not.toContain("ghp_test_token_9999")
    expect(JSON.stringify(redacted)).not.toContain("ghp_stdio_stored_4242")
  })

  it("still requires a value for a header that is not a secret", () => {
    expect(blankPlainHeaderError({ Authorization: "  " }, [])).toBe("Header value is required")
    expect(blankPlainHeaderError({ Authorization: "  " }, ["Authorization"])).toBeNull()
  })
})
