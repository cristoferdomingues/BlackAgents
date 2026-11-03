---
type: Proposal
title: MCP LLM Gateway (proposal)
description: >-
  Proposal: an MCP server that orchestrates cloud-hosted agents via the
  Claude/Codex CLIs (CLI-flag, subscription auth — the ToS-compliant path) or
  holds OpenAI/Anthropic API keys, exposing job-based LLM tools to BlackAgents.
tags:
  - proposal
  - mcp
  - llm
  - gateway
  - subscription
  - claude-code
  - codex
  - orchestration
  - architecture
sources:
  - resource: 'https://code.claude.com/docs/en/cli-reference'
    title: Claude Code CLI reference
  - resource: 'https://learn.chatgpt.com/docs/developer-commands?surface=cli'
    title: Codex developer commands
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/02%20-%20Architecture/MCP%20Servers.md
    title: MCP Servers (Obsidian)
generated:
  by: 'process:assistant-chat'
  at: '2026-10-28T22:05:44Z'
verified:
  - by: 'human:local'
    at: '2026-10-28T22:06:47Z'
  - by: 'human:local'
    at: '2026-10-28T22:27:06Z'
  - by: 'human:local'
    at: '2026-10-30T18:16:52Z'
---

# MCP LLM Gateway — Proposal

> [!abstract] One-liner
> A **stdio MCP server** (`llm-gateway-mcp`) orchestrates the **provider CLIs (Claude Code, Codex) through their CLI flags** — the sanctioned, ToS-compliant automation path — and/or holds **API keys**, exposing both as job-based MCP tools to BlackAgents, so auth and billing live outside the app.

## Why

BlackAgents is local-first with **bring-your-own-key**: credentials live in `~/.black-agents/secrets.json` and are consumed by `lib/llm/registry.ts` (native `openai` / `anthropic` / `custom` providers). True provider *subscriptions* (ChatGPT Plus, Claude Pro) do **not** include raw API access — OpenAI and Anthropic gate their HTTP APIs by API key only.

The sanctioned subscription paths are the provider **CLIs**: Claude Code (`claude`) authenticates via `claude login` (Pro/Max include Claude Code usage with weekly caps); Codex CLI (`codex`) authenticates against ChatGPT (Plus/Pro) or an API key. A gateway that shells out to these CLIs runs traffic on **subscription-included usage**, not metered API spend. **Compliance is a hard constraint:** ACP is not officially supported by Claude Code, and any extension enabling ACP or A2A is not compliant with their terms — automating via **CLI flags is supported and compliant**. We therefore never use the CLIs' MCP/ACP modes.

Tim's positional note: this write-up is *not* the solution for consuming inference, but it is close to how we will **orchestrate cloud-hosted agents** — per-agent skill/agent context (`--agent`), per-call MCP permissions (`--mcp-config`), parseable output, and session resume.

## Architecture

- **Shape:** a `stdio` MCP server, launched by BlackAgents as an MCP server (`.black-agents/mcp.json` → `command`/`args` → `StdioClientTransport`).
- **Two roles in one process:** (1) **agent host** — spawns `claude` / `codex` as child processes with built flag arrays, inheriting the user's existing CLI logins (`~/.claude`, `~/.codex/auth.json`); (2) **key holder** — optionally reads `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` from its own env/secret store for single-shot `llm_chat` fallbacks.
- **Transport:** stdio only, per the MCP client in `lib/mcp/client.ts`.
- **Tool listing:** `loadMcpRuntimeTools` (`lib/runtime/tools/mcp.ts`) wraps each exposed tool with a risk level from `lib/mcp/policy.ts`; `mcp-policy.json` defaults to `ask`.
- **Trust model:** the gateway's tools follow the workspace MCP trust (`trusted` | `ask` | `risky`, default `ask`).

## Protocol + tools

The **16-second constraint** is the design driver: `MCP_TOOL_TIMEOUT_MS = 16_000` in `lib/mcp/client.ts:36`, and per `lib/runtime/tools/mcp.ts` every MCP tool wraps `executeWorkspaceTool`, so a blocking LLM call cannot work. **Every inference is a job**: tools return a `{ jobId }` immediately; the gateway runs the work async; the agent polls to completion.

Key-based tier (single-shot chat):

| Tool | Shape | Notes |
|---|---|---|
| `llm_models` | `{} → { models: [{ id, family, provider }] }` | Non-blocking list of available models per provider |
| `llm_chat` | `{ provider, model?, system?, messages }` | **Non-blocking**: returns `{ jobId }` immediately; result/error surfaces via `llm_job_status` |
| `llm_job_status` | `{ jobId } → { state, result?, error?, sessionId? }` | Poll until `completed` / `failed`; always fits within 16 s |
| `llm_job_cancel` | `{ jobId }` | Stops a running job |
| `llm_complete_stream` | `{ jobId }` (SSE) | Optional, for desktop streaming UX in the future |

Orchestration tier (CLI-driven cloud agents):

| Tool | Shape | Notes |
|---|---|---|
| `claude_run` | `{ prompt, agent?, model?, effort?, mcpConfig?, strictMcpConfig?, sessionId? }` → `{ jobId }` | Builds `claude` flags per the table below; `sessionId` resumes a session |
| `codex_exec` | `{ prompt, profile?, model?, config?, sessionId? }` → `{ jobId }` | Builds `codex exec` flags; `config` carries `-c` overrides incl. `mcp_servers.*` |
| `claude_resume` / `codex_resume` | `{ sessionId|threadId, prompt, same profile flags }` | Explicit multi-turn continuation (or `sessionId` on the run tools) |
| `llm_job_status` | `{ jobId }` | Shared job table; CLI runs take minutes — polling is the only viable channel |
| `llm_job_cancel` | `{ jobId }` | Kills the child process (process group) |

- **No blocking inference** — every tool returns a `jobId` within 16 s (fits the MCP tool timeout with margin).
- **Polling loop** — the agent (or the app) polls `llm_job_status` until `completed` / `failed`; CLI jobs timeout on a longer bound (e.g. 10 min) and can be cancelled.
- **Usage visibility** — `llm_usage` (optional) reports token counts so subscription caps (Claude weekly caps, ChatGPT limits) stay observable.

## CLI consumption reference (per harness)

Claude Code (`claude -p "…"` — headless, profile first, resume with the same profile):

```bash
# Turn 1: pick a profile and capture the session id
id=$(claude -p "Start task" \
  --agent my-task-agent --effort high --model opus-5.5 \
  --mcp-config ./profiles/review.json --strict-mcp-config \
  --output-format json | jq -r '.session_id')

# Turn 2: resume, passing the same profile again
claude -p "Continue" --resume "$id" \
  --agent my-task-agent --effort high --model opus-5.5 \
  --mcp-config ./profiles/review.json --strict-mcp-config
```

| Flag | Purpose |
|---|---|
| `-p <prompt>` | the task Claude Code processes |
| `--agent <name>` | run inside a defined skill/agent context |
| `--effort low\|medium\|high` | effort level |
| `--model <id>` | model per call |
| `--mcp-config <file>` | session-by-session MCP config + permissions, per agent |
| `--strict-mcp-config` | overrides local/global MCP config |
| `--output-format json` | parseable output; exposes `session_id` |
| `--resume "$id"` | continue a previous session with the same profile |

Codex (`codex exec … --json` — same capture/resume shape):

```bash
# Turn 1: profile + model + effort overrides, JSONL transcript
codex exec -p <codex_profile> -m gpt-5.4 -c model_reasoning_effort=high \
  --json "Write an implementation plan for the auth refactor" \
  | tee run.jsonl

# Turn 2: resume the thread (thread id from the transcript)
id=$(jq -r 'select(.type=="thread.started") | .thread_id' run.jsonl | head -1)
codex exec resume "$id" -m gpt-5.4 -c model_reasoning_effort=high \
  "Add a rollout and rollback section"
```

| Flag | Purpose |
|---|---|
| `-p <profile>` | codex profile (from config.toml) |
| `-m <model>` | model per call |
| `-c key=value` | config override — e.g. `model_reasoning_effort=high`, `mcp_servers.<name>.command`, `mcp_servers.<name>.args` |
| `--json` | JSONL transcript (`run.jsonl`); `thread.started` → `thread_id` |
| `exec resume "$id"` | continue a thread |

MCP servers on the Codex CLI use dotted config on the command line:

```bash
-c 'mcp_servers.docs.command="npx"' -c 'mcp_servers.docs.args=["-y","@acme/docs-mcp"]'
```

**Codex wrinkle:** we must figure out how to **remove MCPs enabled in the local/global `codex.toml` on the command line** so we always have full control over the enabled MCP set on every call — whether the call comes from BlackAgents or any other cloud-hosted component that relies on inference.

## Config translation layer

The gateway's core job is **translation**: take a high-level request (`prompt`, `agent`, `model`, `effort`, `profile`, `mcpConfig`) and render the target harness's exact flags — profiles control MCP config in Codex globally, so we pass our **own** config files (MCP config + agent definitions) on the CLI and transform them per harness before the call. No reliance on the user's global CLI config.

## MCP permission strategy (ease vs security)

Two postures, per the orchestration note:

- **Phase A (fast start):** enable all needed MCPs in **always-allow** mode in a centralized config, installing only the MCPs that deployment needs, and apply fine-grained ask/allow/deny gates in **skill/agent definitions**. Gets us running quickly.
- **Phase B (final delivery):** **per-CLI-call strict MCP config** — `--mcp-config … --strict-mcp-config` (Claude) and `-c mcp_servers.*` (Codex), overriding global state. Security will likely flag always-allow as hard to configure with fallout when misconfigured, so we land here.

## Secret handling

- **CLI tier:** no new secrets — the CLIs reuse the user's existing login state; do **not** copy `~/.claude` / `~/.codex` credentials into BlackAgents' `secrets.json`.
- **Key tier at rest/launch:** gateway keeps keys in its own env/secret store; BlackAgents never stores them; `${secret:mcp.llm-gateway.env.OPENAI_API_KEY}` refs resolve from `~/.black-agents/secrets.json` into the MCP server's `env`.
- **Never on the wire:** secrets do not appear in MCP tool args, tool results, or logs (`lib/mcp/resolve-secrets.ts` redaction pattern); scrub CLI transcripts for env-var leaks.
- **Session ids** (`session_id` / `thread_id`) are not secrets but are sensitive handles — store them in the job record, never in logs or artifact output.
- **Revocation:** removing the gateway from `mcp.json` deletes its `mcp.llm-gateway.*` secrets (`lib/mcp/promote-secrets.ts`).

## Trust & approval

- Tools follow the normal MCP trust flow (`trusted` → auto, `ask` → approvable, `risky` → every call approved).
- **Key tier** (`llm_chat`, `llm_models`, `llm_job_status`): read-only, bounded — `ask`/`trusted` acceptable.
- **Orchestration tier** (`claude_run`, `codex_exec`, resumes): **`risky` by default** — approval on every call; the `permissionProfile` / `mcpConfig` maps to per-agent `--mcp-config` profile files; start with read-only task kinds, escalate to edit/run only behind explicit opt-in per agent.
- Registration: `.black-agents/mcp.json` `mcpServers.llm-gateway`; policy in `.black-agents/mcp-policy.json` (default `ask`, per-tool override to `risky` for the orchestration tier).

## Phased rollout

1. Child-process wrapper + shared job table for `claude` (read-only task kinds).
2. `--mcp-config` profile files per agent (Phase A centralized, then Phase B per-call strict).
3. `codex exec` parity incl. `-c mcp_servers.*` and global-config stripping.
4. Session/resume end-to-end (capture → `claude_resume` / `codex_resume`).
5. Agent-driven workflows on top (e.g. long-running reviews pinned to a subscription model).

## Open questions

- How do we strip globally-enabled MCPs from `codex.toml` on the CLI (final answer needed before Phase 3)?
- Should jobs pool/share a rate limit across OpenAI+Anthropic and across key vs CLI tiers?
- Should the gateway expose streaming for the desktop chat UI (needs SSE/HTTP transport rather than stdio)?
- How do CLI weekly/cap limits surface to users (usage dashboard in Settings → AI)?
- Do the CLI tiers get their own `task:` model routing (e.g. reviews pinned to Claude via subscription), or stay manual?
- Where do provider **subscriptions** map: same keys, or a distinct `subscription` credential slot?

## Related

- [MCP Servers](../architecture/mcp-servers.md) — config, `${secret:…}`, transports, trust
- [LLM Integration](../architecture/llm-integration.md) — native providers and protocols
- [Agent Runtime & Approvals](../architecture/agent-runtime-approvals.md) — how MCP tools enter the loop
- [mcp-llm-gateway-reviewer agent](../../artifacts/agents/mcp-llm-gateway-reviewer.md) — evaluates this design against the source
- [Jev Decision Engine](../architecture/jev-decision-engine.md)
- [K0ding](../specs/k0ding.md) — a similar "LLM drives a project via a CLI/tool boundary" pattern
- [Architecture Overview](../architecture/architecture-overview.md)
- [Workflows](../architecture/workflows.md)
- [Model Routing](../specs/model-routing.md)
- [Agents](../artifacts/agents.md)
- [Agent Models](../specs/agent-models.md)
- [Electron Desktop](../architecture/electron-desktop.md)
- [Meeting Secretary](../specs/meeting-secretary.md)
- [Overview](../overview/overview.md)
- [Browser Automation](../specs/browser-automation.md)
