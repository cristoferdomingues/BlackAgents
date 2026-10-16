---
type: Reference
title: Rules
description: Short guardrails
tags:
  - blackagents
  - artifacts
  - rules
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/03%20-%20Artifact%20Model/Rules.md
    title: Rules
    last_modified: '2026-06-20T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:48Z'
---

# Rules

A **rule** is a short, declarative guardrail — an "always do / never do" constraint. Rules *constrain*; they are not tutorials.

## File & Frontmatter

- **Location**: `.cursor/rules/<name>.mdc` (note the `.mdc` extension)
- **Frontmatter** (rules omit `name` — the filename is the identifier):

```yaml
---
description: Use Conventional Commits format for all commits.
alwaysApply: true
globs: ["**/*.ts", "**/*.tsx"]
---
```

| Field | Required | Meaning |
|-------|----------|---------|
| `description` | yes | the constraint in one line |
| `alwaysApply` | no | always-on vs context-triggered → **always** badge |
| `globs` | no | file patterns that activate the rule → **globs** badge |

> [!note] No `name` in frontmatter
> The serializer intentionally drops `name` for rules; the file name carries identity. This matches the `.mdc` convention from `edu-sidekick`.

## Body Shape (from the standards)

- The constraint, stated plainly.
- A short rationale.
- A `Related rules:` line when it pairs with others — this feeds the [Relationship Graph](../architecture/relationship-graph.md).

> [!warning] Anti-pattern
> A rule that grows into a how-to guide. The moment it needs steps, examples, and templates, it should become a [skill](./skills.md).

## In the UI

The editor shows an `alwaysApply` switch and a `globs` badge-input (`GlobsInput`). Lists render **always** / **globs** badges via `ArtifactBadges`.

## Related

- [Skills](./skills.md) — where deep content belongs
- [Authoring Standards](./authoring-standards.md)
- [Relationship Graph](../architecture/relationship-graph.md)
