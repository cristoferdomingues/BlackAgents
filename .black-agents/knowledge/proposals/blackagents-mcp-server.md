---
type: Proposal
title: 'BlackAgents as an MCP server (provide services, not just consume)'
description: >-
  Design direction: BlackAgents exposes its own capabilities — Brain, issues,
  knowledge, workflows — as MCP tools over stdio so external SDLC tools and
  orchestrators can call them, inverting the current consume-only role.
tags:
  - mcp
  - server
  - brain
  - issues
  - sdlc
  - proposal
sources: []
generated:
  by: 'process:assistant-chat'
  at: '2026-11-03T16:12:19Z'
verified:
  - by: 'human:local'
    at: '2026-11-03T16:12:42Z'
---

# BlackAgents as an MCP server (provide services, not just consume)

Status: **proposal / design direction**. No BlackAgents changes are made yet.

## The two MCP directions

**Direction 1 — BlackAgents as MCP *client* (today).** BlackAgents connects *out* to MCP servers via `lib/mcp/client.ts` (`StdioClientTransport`, HTTP, SSE) and wraps their tools into the agent toolset with trust levels (`mcp-policy.json`). It consumes; it never serves.

**Direction 2 — BlackAgents as MCP *server* (this proposal).** BlackAgents exposes its own capabilities — Brain, issues, knowledge, workflows — as MCP tools that *other* tools (external SDLC agents, CI, other orchestrators) can call over stdio. This is "provide services," not "consume."

## Why it makes sense

The pattern of "an MCP server that talks to BlackAgents' world" already exists: `proposals/mcp-llm-gateway` is a stdio MCP server that BlackAgents launches as a client. The gateway's job is to be a server BlackAgents consumes. This proposal is the **mirror image**: a server that *BlackAgents itself* runs, exposing its internal state outward.

Concretely, a new stdio MCP server (e.g. `black-agents-mcp`) that BlackAgents ships and that external SDLC tools register as a client. It would expose the Brain/issue/knowledge surface as MCP tools, reusing the existing trust, approval, and security machinery. It is a **separate component from the gateway** — the gateway is about *inference*; this one is about *BlackAgents' own state*.

Example tools it could expose:
- `brain_report_issue` — external SDLC tools report issues (complements `POST /api/brain/issues` from `specs/brain-issues`).
- `brain_list_issues` / `brain_get_issue` — query the issue lifecycle.
- `brain_propose_concept` / `brain_get_knowledge` — propose and read knowledge.
- `brain_propose_memory` — propose a memory note.

## stdio vs HTTP

**stdio** is the right default for *local* tools (a CI job on the same machine, a sibling agent process) and matches the gateway's transport. Constraint: stdio servers are launched as child processes by a client, so BlackAgents must expose a runnable entrypoint (e.g. `black-agents mcp-server`) that other tools add to *their* MCP config.

If consumers are **remote** (other machines, cloud SDLC agents), the HTTP/SSE transport is needed — a bigger step (auth, TLS, exposure). For a local-first SDLC, stdio is the clean, secure starting point.

## Security (the trust model inverts)

This is the same trust inversion discussed for issues, but now in the other direction: **BlackAgents is the *provider* of tools that external, possibly untrusted, tools call.** The same rules apply, inverted:

- Every exposed tool must be **approval-gated** (the Brain's core guarantee) — an external tool can *propose* an issue, never *auto-apply* one.
- The server must **validate and redact** before anything durable is written or returned (secrets, path traversal, prompt injection — the risks from `specs/brain-issues` Security section).
- The **trust model flips**: now *BlackAgents* decides how much to trust its *callers*, not the other way around. A low-trust caller should not submit high-severity issues or read sensitive knowledge.

## Relationship to the SDLC vision

In an Agentic SDLC where BlackAgents is the orchestrator (or part of the process), external tools executing tasks report issues back to BlackAgents. A BlackAgents MCP server gives those tools a first-class, local, trust-aware channel to do so — and to read back the knowledge the Brain has learned, closing the loop.

## Open questions

- Which capabilities to expose first (Brain/issues vs knowledge vs workflows)?
- stdio-only initially, or HTTP/SSE for remote consumers?
- How callers are authenticated/trusted, and how that maps to `mcp-policy.json`.

## Related

- [MCP Servers](../architecture/mcp-servers.md)
- [MCP LLM Gateway (proposal)](../proposals/mcp-llm-gateway.md)
- [Brain Issues (spec)](../specs/brain-issues.md)
- [Second Brain](../architecture/second-brain.md)
- [Agent Runtime & Approvals](../architecture/agent-runtime-approvals.md)
- [Agents](../artifacts/agents.md)
- [Workflows](../architecture/workflows.md)
- [Rules](../artifacts/rules.md)
- [Browser Automation](../specs/browser-automation.md)
- [Knowledge (OKF)](../architecture/knowledge-okf.md)
