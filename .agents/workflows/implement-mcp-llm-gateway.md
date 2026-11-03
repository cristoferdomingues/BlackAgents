---
name: implement-mcp-llm-gateway
description: >-
  Orchestrates building llm-gateway-mcp — the stdio MCP server with a key-based
  llm_chat tier and a Claude/Codex CLI orchestration tier — through implement →
  test → review → fix until the reviewer verdict is PASS, then registers it with
  BlackAgents.
---

# implement-mcp-llm-gateway

Orchestrates building `llm-gateway-mcp`, the stdio MCP server that gives BlackAgents a CLI-orchestration LLM tier (Claude Code / Codex via CLI flags, subscription auth, session resume) plus a key-based `llm_chat` tier, through implement → test → review → fix until the reviewer verdict is `PASS`, then registers it with BlackAgents and verifies it.

## Input

- Target package path (default: `llm-gateway-mcp/`).
- Scope: `both` (default), `claude`, or `codex` — which CLI harness(es) to implement first.

## Prerequisites

- Read the `mcp-llm-gateway` skill — flag surfaces, job model, hard constraints (16 s timeout, no ACP/A2A, per-call MCP config), and the build recipe.
- Read the `proposals/mcp-llm-gateway` knowledge card for design rationale and open questions.
- Claude Code and/or Codex CLI installed and logged in on the machine (`claude --version`, `codex --version`), or a documented plan for the missing one.

## Steps

1. Invoke the **llm-integrator** agent to implement the gateway per the build recipe in the `mcp-llm-gateway` skill: shared job table; `llm_chat` key tier; `claude_run` / `codex_exec` orchestration tier with the flag translation layer (`--mcp-config --strict-mcp-config`, `-c mcp_servers.*`), sandboxed `cwd`, session/thread-id capture, and no ACP/A2A. (Deliverable: gateway source at the target path.)
2. Invoke the **tester** agent to cover the gateway: job lifecycle (`queued → running → completed | failed`), the 16 s non-blocking guarantee, per-harness flag construction, resume flows, and secret/session-id redaction. (Deliverable: passing test run.)
3. Invoke the **mcp-llm-gateway-reviewer** agent with the implementation and the BlackAgents seams (`lib/mcp/client.ts`, `lib/runtime/tools/mcp.ts`, `mcp.json`, `mcp-policy.json`). (Deliverable: `REVIEW.md` with `PASS` | `FAIL` | `CONDITIONAL`.)
4. If the verdict is not `PASS`: invoke the **llm-integrator** agent to fix each Blocker/Major finding, re-run tests (step 2), then re-review (step 3). Repeat until `PASS` or the loop cap is hit.
5. Register and verify: add `mcpServers.llm-gateway` (`command`/`args`) to `.black-agents/mcp.json`, set the orchestration tools to `risky` in `.black-agents/mcp-policy.json`, then have the **mcp-llm-gateway-reviewer** agent confirm registration and a live handshake.

## Parallelization

Steps 1–3 are strictly sequential (implementation → tests → review). Inside a fix cycle (step 4), independent findings may be fixed by separate invocations, but the reviewer gate itself is single-threaded.

## Error handling

- If a required CLI is missing or not logged in, build the available tier(s) and document the missing one as an open finding with the exact install/login step — never fake a handshake.
- If the reviewer raises a Blocker that spans BlackAgents core (e.g. the 16 s timeout model itself), stop and escalate the design decision instead of hacking the gateway around it.
- Loop cap of 3 fix cycles: after that, surface the remaining findings with severity and stop, rather than forcing a `PASS`.
- Idempotency: if `REVIEW.md` at the target already contains `Verdict: PASS` and the gateway source is unchanged, skip the rebuild and report the existing state.
