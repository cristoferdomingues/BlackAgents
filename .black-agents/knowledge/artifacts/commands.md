---
type: Reference
title: Commands
description: Orchestration layer
tags:
  - blackagents
  - artifacts
  - commands
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/03%20-%20Artifact%20Model/Commands.md
    title: Commands
    last_modified: '2026-06-20T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:49Z'
---

# Commands

A **command** is the orchestration layer. It *wires* a workflow by sequencing [Agents](./agents.md) — it should delegate, not do the work itself.

## File & Frontmatter

- **Location**: `.cursor/commands/<name>.md`
- **Frontmatter**:

```yaml
---
name: plan
description: Turn a ticket into a reviewed solution plan.
---
```

| Field | Required | Meaning |
|-------|----------|---------|
| `name` | yes | kebab-case identifier |
| `description` | yes | one line: the workflow it runs |

## Body Shape (from the standards)

- The **trigger** / when to run it.
- An ordered set of **steps**, each delegating to an agent or skill.
- Hand-off **inputs/outputs** between steps.

> [!warning] Anti-pattern
> A command that performs the logic inline. If it stops calling agents and starts doing the work, it has become an agent in disguise. Keep commands thin and declarative.

## Why Commands Sit at the Graph Hub

Because commands reference many agents, they tend to be the highest-degree nodes in the [Relationship Graph](../architecture/relationship-graph.md). That is expected: orchestration fans out.

## Related

- [Agents](./agents.md) — what commands invoke
- [Rules](./rules.md) — what commands obey
- [Artifact Types Overview](./artifact-types-overview.md)
- [Authoring Standards](./authoring-standards.md)
