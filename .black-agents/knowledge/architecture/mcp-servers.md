---
type: Reference
title: MCP Servers
description: '.black-agents/mcp.json, ${secret:…} refs, transports, trust'
tags:
  - blackagents
  - architecture
  - mcp
  - secrets
  - integrations
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/02%20-%20Architecture/MCP%20Servers.md
    title: MCP Servers
    last_modified: '2026-10-13T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:55Z'
---

# MCP Servers

> [!abstract] One-liner
> Workspace MCP servers live in **`.black-agents/mcp.json`** (BlackAgents-owned). Trust is in `.black-agents/mcp-policy.json`. Auth tokens for remote servers live in `~/.black-agents/secrets.json` as `${secret:…}` placeholders — never committed as plaintext.

## Why not `.cursor/mcp.json`?

Originally BlackAgents wrote Cursor’s file for “edit once, use in Cursor too.” That broke down once authenticated servers needed secret refs Cursor cannot resolve. Source of truth is now under `.black-agents/`, next to workflows, brain, and MCP trust.

| File | Role |
|------|------|
| `.black-agents/mcp.json` | Server list (stdio / HTTP / SSE) |
| `.black-agents/mcp-policy.json` | Per-server trust: `trusted` \| `ask` \| `risky` |
| `~/.black-agents/secrets.json` → `mcp` map | Secret values (`0600`) |

> [!note] Legacy migration
> If `.black-agents/mcp.json` is missing but `.cursor/mcp.json` exists, `readWorkspaceMcpConfig` copies it into `.black-agents/` on first read (`lib/mcp/config.ts`). New writes only touch `.black-agents/mcp.json`. Cursor’s MCP panel does **not** read BlackAgents’ file — configure Cursor separately if needed.

## Config shape

```json
{
  "mcpServers": {
    "sqlite-db": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "./data.db"],
      "env": {}
    },
    "docs-api": {
      "url": "https://example.com/api/mcp",
      "transport": "http",
      "headers": {
        "Authorization": "${secret:mcp.docs-api.header.Authorization}"
      }
    },
    "browser": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--browser", "chromium", "--user-data-dir", "…"]
    }
  }
}
```

`transport: "http"` is kept on disk (unlike the old Cursor-compat strip). A URL with no transport still means HTTP at connect time (`resolveMcpTransport`).

## Secret refs

| Piece | Detail |
|-------|--------|
| Placeholder | `${secret:mcp.<server>.header.<HeaderName>}` or `…env.<KEY>` |
| Helpers | `lib/mcp/secret-refs.ts`, `lib/mcp/promote-secrets.ts`, `lib/mcp/resolve-secrets.ts` |
| Promote | Settings → MCP: remote header values are stored as secrets; mcp.json gets the placeholder (`secretHeaders` on `POST /api/mcp`) |
| Resolve | `createMcpConnection` expands refs before connect; missing secret → clear error |
| Client | API returns redacted `secretStatuses` (`configured` + `last4`), never the raw token |
| Delete | Removing a server deletes `mcp.<server>.*` keys from secrets |

## Transports (`lib/mcp/transport.ts`)

| Transport | When | Client |
|-----------|------|--------|
| `stdio` | `command` set | `StdioClientTransport` |
| `http` | URL + HTTP (or bare URL) | `StreamableHTTPClientTransport` |
| `sse` | user picks SSE | `SSEClientTransport` |

Headers for remote servers: `mcpAuthRequestInit` after secret resolution. Form validation: `collectMcpHeaders` (`lib/mcp/headers.ts`).

## Trust → tool risk

See [Agent Runtime & Approvals](./agent-runtime-approvals.md). Default trust is `ask`. The [`browser`](../specs/browser-automation.md) server is installed as **`risky`**.

On non-desktop runtimes, tools from the `browser` server are **filtered out** of the agent toolset (`loadMcpRuntimeTools`) even if present in mcp.json.

## Settings UI

- **Settings → MCP Servers** — add/remove servers, headers (password fields), trust select, live tool list.
- **Settings → Browser** — desktop-only Playwright setup; see [Browser Automation](../specs/browser-automation.md).

## Key files

| Path | Role |
|------|------|
| `lib/mcp/config.ts` | Read/write + legacy migrate |
| `lib/mcp/client.ts` | Connect, list tools, execute, recording hook |
| `lib/mcp/policy.ts` | Trust file |
| `lib/secrets.ts` | `mcp` map in secrets.json |
| `app/api/mcp/route.ts` | CRUD + secret promote |
| `app/api/mcp/policy/route.ts` | Trust get/set |

## Related

- [Browser Automation](../specs/browser-automation.md) — Playwright MCP on desktop
- [Agent Runtime & Approvals](./agent-runtime-approvals.md) — how MCP tools enter the loop
- [API Reference](../api/api-reference.md) — `/api/mcp`, secretHeaders
- [Electron Desktop](./electron-desktop.md) — when `browser` tools are available
- [Workspace & Filesystem Safety](./workspace-filesystem-safety.md) — `.black-agents/` in the workspace
