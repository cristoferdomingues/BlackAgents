---
name: mcp-llm-gateway
description: >-
  Reference for building the MCP LLM gateway (llm-gateway-mcp) — a stdio MCP
  server that orchestrates Claude/Codex CLIs via CLI flags (subscription auth,
  session resume) and/or holds OpenAI/Anthropic API keys, exposing job-based
  tools to BlackAgents. Read when implementing, building, or debugging the
  gateway, adding claude_run/codex_exec/llm_chat tools, or addressing
  mcp-llm-gateway-reviewer findings.
---

# mcp-llm-gateway

Reference for building `llm-gateway-mcp`, a **stdio MCP server** that gives BlackAgents a second LLM exit point beside native `lib/llm`:

- **Orchestration tier** — spawns the **Claude Code / Codex CLIs** as child processes with built flag arrays. Runs on the user's existing **CLI logins** (subscription-included usage), no API keys stored.
- **Key tier** — single-shot `llm_chat` completions using keys held in the gateway's own env/secret store.

Design and rationale live in the [MCP LLM Gateway (proposal)](../knowledge/proposals/mcp-llm-gateway.md) card; verification gates live in the `mcp-llm-gateway-reviewer` agent.

## When to Apply

- Implementing `llm-gateway-mcp` or adding tools to it (`claude_run`, `codex_exec`, `llm_chat`, `llm_job_*`).
- Wiring Claude Code or Codex CLI consumption into any BlackAgents component (chat, workflows, cloud-hosted agents).
- Building the CLI→flag translation layer or per-agent `--mcp-config` profile files.
- Addressing `mcp-llm-gateway-reviewer` findings (Blocker/Major items).

## Hard constraints (non-negotiables)

1. **16-second tool timeout.** `MCP_TOOL_TIMEOUT_MS = 16_000` in `lib/mcp/client.ts:36`, and every MCP tool wraps `executeWorkspaceTool` (`lib/runtime/tools/mcp.ts`). No tool may block for a full inference or agent run → **every inference is a job**: tools return `{ jobId }` immediately, work runs async, callers poll `llm_job_status`.
2. **No ACP / A2A / MCP-in-MCP.** ACP is not officially supported for Claude Code and enabling it violates their terms. Automating via **CLI flags** (`claude -p …`, `codex exec …`) is the supported, compliant path. Never invoke the CLIs in their own MCP modes.
3. **Never trust the user's global CLI MCP config.** Always pass explicit per-call MCP config (`--mcp-config … --strict-mcp-config` for Claude; `-c mcp_servers.*` for Codex) or strip it — full control of the enabled-MCP set on every call.
4. **Secrets never cross the MCP boundary.** No keys, tokens, or session ids in tool args, results, transcript output, or logs.

## Job model

Shared job table for both tiers. Tools return immediately; callers poll.

| Tool | Shape | Behavior |
|---|---|---|
| `llm_models` | `{} → { models: [{ id, family, provider }] }` | Non-blocking list |
| `llm_chat` | `{ provider, model?, system?, messages } → { jobId }` | Key tier; async completion |
| `claude_run` | `{ prompt, agent?, model?, effort?, mcpConfig?, strictMcpConfig?, sessionId? } → { jobId }` | Orchestration tier; `sessionId` resumes |
| `codex_exec` | `{ prompt, profile?, model?, config?, sessionId? } → { jobId }` | Orchestration tier; `sessionId` = thread |
| `claude_resume` / `codex_resume` | `{ sessionId\|threadId, prompt, same profile flags }` | Multi-turn continuation |
| `llm_job_status` | `{ jobId } → { state, result?, error?, sessionId? }` | Poll until `completed` / `failed` |
| `llm_job_cancel` | `{ jobId }` | Kill child process group |

- Job lifecycle: `queued → running → completed | failed | timeout`. CLI jobs get a longer bound (e.g. 10 min) than key chats (e.g. 120 s).
- Store `session_id` (Claude) / `thread_id` (Codex) on the job record when the CLI prints them; they are sensitive handles, never log them.

## CLI flag surfaces

### Claude Code (`claude -p "…"`)

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
| `-p <prompt>` | task text |
| `--agent <name>` | run inside a Claude Code skill/agent context |
| `--effort low\|medium\|high` | effort level |
| `--model <id>` | model per call |
| `--mcp-config <file>` | session-by-session MCP config + permissions |
| `--strict-mcp-config` | override local/global MCP config |
| `--output-format json` | parseable output; yields `session_id` |
| `--resume "$id"` | continue a session with the same profile |

Reference: https://code.claude.com/docs/en/cli-reference

### Codex (`codex exec …`)

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
| `-p <profile>` | codex profile |
| `-m <model>` | model per call |
| `-c key=value` | config override — `model_reasoning_effort=high`, `mcp_servers.<name>.command`, `mcp_servers.<name>.args`, … |
| `--json` | JSONL transcript; `thread.started` → `thread_id` |
| `exec resume "$id"` | continue a thread |

MCP servers on the CLI:

```bash
-c 'mcp_servers.docs.command="npx"' -c 'mcp_servers.docs.args=["-y","@acme/docs-mcp"]'
```

**Wrinkle:** Codex enables MCPs from local/global `codex.toml`. Find how to remove them on the command line so the gateway controls the enabled set on every call (open question in the proposal — resolve before Phase 3).

Reference: https://learn.chatgpt.com/docs/developer-commands?surface=cli

## Config translation layer

The gateway's core job: take a high-level request (`prompt`, `agent`, `model`, `effort`, `profile`, `mcpConfig`) and render the target harness's exact flags. Codex profiles control MCP config globally, so pass the gateway's **own** config files (MCP config + agent definitions) on the CLI, transformed per harness before the call — never rely on the user's global CLI config.

Profile file (`./profiles/review.json`) shape (Claude `--mcp-config`):

```json
{
  "mcpServers": {
    "docs": { "command": "npx", "args": ["-y", "@acme/docs-mcp"] },
    "repo": { "command": "npx", "args": ["-y", "@acme/repo-mcp"] }
  },
  "permissions": { "edit": "ask", "bash": "deny", "network": "ask" }
}
```

## MCP permission strategy

- **Phase A (fast start):** centralized config with all needed MCPs in **always-allow**; fine-grained ask/allow/deny gates live in skill/agent definitions. Install only what each deployment needs.
- **Phase B (final delivery):** **per-CLI-call strict config** — `--mcp-config … --strict-mcp-config` (Claude), `-c mcp_servers.*` (Codex) — overriding global state on every call. Expect security review to require this.

## Secret handling

- **CLI tier:** no stored keys. The CLIs reuse existing logins (`~/.claude`, `~/.codex/auth.json`); do **not** copy those credentials into BlackAgents' `secrets.json`.
- **Key tier:** gateway reads `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` from its own env/OS keychain. When BlackAgents launches it, resolvable via `${secret:mcp.llm-gateway.env.OPENAI_API_KEY}` refs; removal from `mcp.json` cleans them up (`lib/mcp/promote-secrets.ts`).
- **Redaction:** follow `lib/mcp/resolve-secrets.ts` redaction in MCP error paths; scrub CLI transcripts for env-var leaks (`redactSecretValues` pattern).

## Trust & approval

- Key tier (`llm_chat`, `llm_models`, `llm_job_status`): read-only, bounded → `ask`/`trusted`.
- Orchestration tier (`claude_run`, `codex_exec`, resumes): **`risky` by default** — approval per call, **sandboxed `cwd`** (temp dir, never home/projects), per-agent permission profiles. Start with read-only task kinds (review, explain, summarize); escalate to edit/run only behind explicit opt-in per agent.
- Registration: `.black-agents/mcp.json` → `mcpServers.llm-gateway` (`command`/`args`); policy in `.black-agents/mcp-policy.json` (default `ask`, per-tool `risky` for the orchestration tier).

## BlackAgents seams

| Seam | Why |
|---|---|
| `lib/mcp/client.ts` | stdio client; `MCP_TOOL_TIMEOUT_MS = 16_000` |
| `lib/runtime/tools/mcp.ts` | `loadMcpRuntimeTools` wraps MCP tools into the agent loop |
| `lib/runtime/tools/index.ts` | tool surface; frontmatter `mcpServers` gates agents |
| `lib/mcp/policy.ts` + `mcp-policy.json` | per-tool risk levels (`ask`/`risky`) |
| `lib/llm/registry.ts` | native providers (baseline to compare against) |
| `lib/mcp/resolve-secrets.ts`, `promote-secrets.ts` | `${secret:…}` resolution + cleanup on removal |

## Implementation recipe

1. Scaffold an MCP stdio server package (`@modelcontextprotocol/sdk`), exposed tools registered in `listTools`.
2. Add the shared job table (in-memory + optional persistence): `createJob`, `updateJob`, `getJob`, poll endpoint.
3. Add the key tier: `llm_chat` schedules a completion job; worker calls the provider SDK with env-held keys.
4. Add the orchestration tier: `claude_run` / `codex_exec` build flag arrays (translation layer above), `spawn(claude|codex, args, { cwd: sandboxDir })`, stream stdout/stderr into the job record, parse `session_id` / `thread_id`.
5. Wire resume: `claude_resume` / `codex_resume` reuse stored session ids with the same profile flags.
6. Register in `.black-agents/mcp.json`; set `risky` in `mcp-policy.json` for the orchestration tools.
7. Verify with `mcp-llm-gateway-reviewer`, then Exercise the job model end-to-end.

## Phased rollout

1. Child-process wrapper + job table for `claude` (read-only task kinds).
2. Per-agent `--mcp-config` profile files (Phase A centralized → Phase B per-call strict).
3. `codex exec` parity incl. `-c mcp_servers.*` and global-config stripping.
4. Session/resume end-to-end (capture → `claude_resume` / `codex_resume`).
5. Agent-driven workflows on top (e.g. reviews pinned to a subscription model).

## Open questions

- How to strip globally-enabled Codex MCPs on the CLI (blocks Phase 3).
- Rate limits shared across providers/tiers; streaming via SSE/HTTP for desktop UX.
- Surface CLI usage caps (Claude weekly caps, ChatGPT limits) in Settings → AI.
- Should CLI tiers get `task:` model routing (e.g. reviews → Claude subscription) or stay manual?

## How to Use

This skill is a single reference file. Read the whole thing when implementing the gateway; jump to the flag tables when debugging specific harness calls. Pair it with: `mcp-llm-gateway-reviewer` agent (verdict gate), [MCP LLM Gateway (proposal)](../knowledge/proposals/mcp-llm-gateway.md) (design rationale), and the `llm-integration` skill (native provider baseline). Guard with the `llm-output-safety` and `llm-security` rules.
