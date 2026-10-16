import { describe, expect, it } from "vitest"

import { formatSecretRef, mcpSecretId } from "@/lib/mcp/secret-refs"
import {
  buildMcpSaveBody,
  draftFromServer,
  emptyMcpDraft,
  isMcpDraftDirty,
  keepStoredSecretValues,
  mcpTestErrorAllowsSave,
  readMcpConnection,
} from "@/lib/settings/mcp-form"
import type { McpServerConfig } from "@/lib/mcp/types"

const httpDraft = {
  name: "blacklionfi",
  transport: "http" as const,
  command: "",
  args: "",
  url: "https://app.example/api/mcp",
  headers: [
    { name: "Authorization", value: "Bearer blf_mcp_secret" },
    { name: "", value: "" },
  ],
  env: [{ name: "", value: "" }],
}

describe("buildMcpSaveBody", () => {
  it("matches the add-server HTTP payload", () => {
    expect(buildMcpSaveBody(httpDraft, null)).toEqual({
      ok: true,
      body: {
        name: "blacklionfi",
        config: {
          url: "https://app.example/api/mcp",
          headers: { Authorization: "Bearer blf_mcp_secret" },
          transport: "http",
        },
        secretHeaders: ["Authorization"],
      },
    })
  })

  it("matches the add-server command payload", () => {
    expect(
      buildMcpSaveBody(
        {
          name: "github",
          transport: "stdio",
          command: "npx",
          args: "-y server",
          url: "",
          headers: [{ name: "", value: "" }],
          env: [
            { name: "GITHUB_TOKEN", value: "ghp_stdio_secret" },
            { name: "", value: "" },
          ],
        },
        null
      )
    ).toEqual({
      ok: true,
      body: {
        name: "github",
        config: {
          command: "npx",
          args: ["-y", "server"],
          env: { GITHUB_TOKEN: "ghp_stdio_secret" },
          transport: "stdio",
        },
        secretEnv: ["GITHUB_TOKEN"],
      },
    })
  })

  it("sends the stored placeholder when a secret is left blank", () => {
    const placeholder = formatSecretRef(mcpSecretId("github", "env", "GITHUB_TOKEN"))
    const built = buildMcpSaveBody(
      {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: "-y server",
        url: "",
        headers: [{ name: "", value: "" }],
        env: [{ name: "GITHUB_TOKEN", value: "  " }],
      },
      { env: { GITHUB_TOKEN: placeholder } }
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.config.env).toEqual({ GITHUB_TOKEN: placeholder })
    expect(built.body.secretEnv).toEqual(["GITHUB_TOKEN"])
  })

  it("sends a typed secret instead of the placeholder", () => {
    const placeholder = formatSecretRef(mcpSecretId("github", "header", "Authorization"))
    const built = buildMcpSaveBody(
      {
        ...httpDraft,
        headers: [{ name: "Authorization", value: "Bearer new" }],
      },
      { headers: { Authorization: placeholder } }
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.config.headers).toEqual({ Authorization: "Bearer new" })
  })

  it("asks for a value when a new secret is blank", () => {
    const built = buildMcpSaveBody(
      {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: "",
        url: "",
        headers: [{ name: "", value: "" }],
        env: [{ name: "NEW_TOKEN", value: "" }],
      },
      { env: {} }
    )
    expect(built).toEqual({ ok: false, error: "Each variable needs a name and a value" })
  })

  it("sends the stored HTTP placeholder when the header is left blank", () => {
    const placeholder = formatSecretRef(mcpSecretId("blacklionfi", "header", "Authorization"))
    const built = buildMcpSaveBody(
      {
        ...httpDraft,
        headers: [{ name: "Authorization", value: "   " }],
      },
      { headers: { Authorization: placeholder } }
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.config.headers).toEqual({ Authorization: placeholder })
    expect(built.body.secretHeaders).toEqual(["Authorization"])
    expect(JSON.stringify(built.body)).not.toContain("blf_mcp_secret")
  })

  it("keeps SSE as SSE when saving a remote server", () => {
    const built = buildMcpSaveBody(
      { ...httpDraft, transport: "sse", url: "https://mcp.example.com/sse" },
      null
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.config).toMatchObject({
      url: "https://mcp.example.com/sse",
      transport: "sse",
    })
  })

  it("rejects a missing name, command, or url", () => {
    expect(buildMcpSaveBody({ ...httpDraft, name: "  " }, null)).toEqual({
      ok: false,
      error: "Please provide a server name",
    })
    expect(
      buildMcpSaveBody(
        {
          name: "github",
          transport: "stdio",
          command: " ",
          args: "",
          url: "",
          headers: [{ name: "", value: "" }],
          env: [{ name: "", value: "" }],
        },
        null
      )
    ).toEqual({ ok: false, error: "Command is required for stdio server" })
    expect(buildMcpSaveBody({ ...httpDraft, url: " " }, null)).toEqual({
      ok: false,
      error: "URL is required for a remote server",
    })
  })

  it("keeps a disabled server disabled", () => {
    const built = buildMcpSaveBody(
      {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: "",
        url: "",
        headers: [{ name: "", value: "" }],
        env: [{ name: "", value: "" }],
      },
      null,
      { disabled: true }
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.config.disabled).toBe(true)
  })
})

describe("draftFromServer", () => {
  it("fills transport, command, args, url, and secret names, with blank values", () => {
    const config: McpServerConfig = {
      command: "npx",
      args: ["-y", "server"],
      env: { GITHUB_TOKEN: "${secret:mcp.github.env.GITHUB_TOKEN}" },
      url: undefined,
      headers: {},
      transport: "stdio",
      disabled: false,
    }
    expect(draftFromServer("github", config)).toEqual({
      name: "github",
      transport: "stdio",
      command: "npx",
      args: "-y server",
      url: "",
      headers: [{ name: "", value: "" }],
      env: [{ name: "GITHUB_TOKEN", value: "" }],
    })
  })

  it("fills an SSE url and header names, and treats a bare url as HTTP", () => {
    const sse: McpServerConfig = {
      command: undefined,
      args: [],
      env: {},
      url: "https://mcp.example.com/sse",
      headers: { Authorization: "${secret:mcp.demo.header.Authorization}" },
      transport: "sse",
      disabled: false,
    }
    const draft = draftFromServer("demo", sse)
    expect(draft.transport).toBe("sse")
    expect(draft.url).toBe("https://mcp.example.com/sse")
    expect(draft.headers).toEqual([{ name: "Authorization", value: "" }])

    const bare: McpServerConfig = { ...sse, transport: undefined, headers: {}, url: "https://app.example/api/mcp" }
    expect(draftFromServer("demo", bare).transport).toBe("http")
  })
})

describe("form helpers", () => {
  it("marks a changed draft as dirty", () => {
    const base = emptyMcpDraft()
    expect(isMcpDraftDirty(base, emptyMcpDraft())).toBe(false)
    expect(isMcpDraftDirty({ ...base, command: "npx" }, base)).toBe(true)
  })

  it("keeps only full secret placeholders", () => {
    expect(
      keepStoredSecretValues([{ name: "TOKEN", value: "" }], { TOKEN: "plain-value" })
    ).toEqual([{ name: "TOKEN", value: "" }])
    expect(
      keepStoredSecretValues([{ name: "TOKEN", value: "" }], {
        TOKEN: "${secret:mcp.demo.env.TOKEN}",
      })
    ).toEqual([{ name: "TOKEN", value: "${secret:mcp.demo.env.TOKEN}" }])
  })

  it("reads connection status from test and save payloads", () => {
    expect(readMcpConnection({ status: "connected", tools: [{ name: "a" }] })).toEqual({
      status: "connected",
      toolCount: 1,
      error: undefined,
    })
    expect(
      readMcpConnection({ saved: true, server: { status: "error", tools: [], error: "down" } })
    ).toEqual({ status: "error", toolCount: 0, error: "down" })
    expect(readMcpConnection({ saved: true })).toBeNull()
  })

  it("allows save when the test route cannot run", () => {
    expect(mcpTestErrorAllowsSave("No active workspace selected")).toBe(true)
    expect(mcpTestErrorAllowsSave("Invalid response from /api/mcp/test (404)")).toBe(true)
    expect(mcpTestErrorAllowsSave('MCP secret "mcp.github.env.TOKEN" is not configured')).toBe(false)
  })
})
