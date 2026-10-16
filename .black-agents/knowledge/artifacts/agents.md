---
type: Reference
title: Agents
description: Single-responsibility workers
tags:
  - blackagents
  - artifacts
  - agents
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/03%20-%20Artifact%20Model/Agents.md
    title: Agents
    last_modified: '2026-10-07T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:52Z'
---

# Agents

An **agent** is a single-responsibility worker with a persona and a clear deliverable. Agents *execute*; they are invoked by [Commands](./commands.md), obey [Rules](./rules.md), and read [Skills](./skills.md) for depth.

## File & Frontmatter

- **Location**: `.cursor/agents/<name>.md`
- **Frontmatter**:

```yaml
---
name: review-code-quality
description: Review code changes for quality and best practices.
parallel: true   # optional — may run alongside other agents
tools: [fs_list, fs_read, fs_write]   # optional
mcpServers: [github]                   # optional
---
```

| Field | Required | Meaning |
|-------|----------|---------|
| `name` | yes | kebab-case identifier |
| `description` | yes | one line: what it does, when to use it |
| `parallel` | no | shown as a badge; signals it can fan out concurrently |
| `tools` | no | built-in tools the agent may use (`fs_list`, `fs_read`, `fs_write`, `shell_run`). Missing = `fs_list` + `fs_read` |
| `mcpServers` | no | MCP servers it may call. Missing = all workspace servers; `[]` = none |

`tools` and `mcpServers` are BlackAgents keys; they matter when the agent runs inside BlackAgents ([Agent Runtime & Approvals](../architecture/agent-runtime-approvals.md), [Workflows](../architecture/workflows.md)).

## Body Shape (from the standards)

- A crisp **responsibility** statement (one job).
- The **inputs** it expects and the **deliverable** it returns.
- Which [Skills](./skills.md) it leans on and which [Rules](./rules.md) it must respect.

> [!warning] Anti-pattern
> Pasting a long procedure into an agent body. If it reads like a tutorial, extract it into a [skill](./skills.md) and have the agent reference it. Agents stay lean.

## In the UI

The editor exposes a `parallel` switch and an **Agent tools** field (`tools` + `mcpServers`) in addition to name/description, and `ArtifactBadges` renders a **parallel** badge in lists and on nodes.

Each agent also has its own memory in the [Second Brain](../architecture/second-brain.md) (`.black-agents/brain/agents/<name>.md`).

## Related

- [Commands](./commands.md) — invoke agents
- [Skills](./skills.md) — what agents read
- [Rules](./rules.md) — what agents obey
- [Authoring Standards](./authoring-standards.md)
