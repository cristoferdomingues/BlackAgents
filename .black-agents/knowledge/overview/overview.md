---
type: Reference
title: Overview
description: What BlackAgents is and what it does
tags:
  - blackagents
  - overview
  - ai-agents
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/01%20-%20Project%20Overview/Overview.md
    title: Overview
    last_modified: '2026-10-11T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:16:00Z'
---

# BlackAgents — Overview

BlackAgents is a **local-first manager for AI agent artifacts**. It reads and writes the real `.md` / `.mdc` files in a project folder on your machine through a graphical UI, instead of editing them by hand.

## Core Value Proposition

- **Local-first**: the app runs on your machine and writes real files into a workspace folder. No cloud, no database in v1.
- **Standards-driven**: an editable authoring-standards baseline guides every artifact you create.
- **Multi-platform model**: the internal model is tool-agnostic, so the same artifact can target `.cursor`, `.claude`, or `.windsurf`.
- **Visual relationships**: an Obsidian-style graph shows how artifacts reference each other.

## The Four Artifact Types

| Type | Purpose | File |
|------|---------|------|
| **[Commands](../artifacts/commands.md)** | Orchestration — sequence agents | `.cursor/commands/<name>.md` |
| **[Agents](../artifacts/agents.md)** | Single-responsibility worker with a persona | `.cursor/agents/<name>.md` |
| **[Rules](../artifacts/rules.md)** | Short declarative guardrail | `.cursor/rules/<name>.mdc` |
| **[Skills](../artifacts/skills.md)** | Deep reference package with supporting files | `.cursor/skills/<name>/SKILL.md` |

> [!tip] Mental model
> **Commands wire, agents execute, rules constrain, skills educate.** Putting content in the wrong type leads to bloated agents, thin rules, or commands that do too much. See [Authoring Standards](../artifacts/authoring-standards.md).

## What You Can Do (v1)

- Open a workspace (any folder with a `.cursor` or `.claude` directory).
- Browse agents, commands, rules, and skills in typed lists.
- Create, edit, rename, and delete artifacts with a frontmatter form + Markdown body editor.
- Follow a guided creation wizard, or create directly from the sidebar/header.
- Edit the authoring-standards baseline per workspace.
- Explore the [Relationship Graph](../architecture/relationship-graph.md) of cross-references.

> [!note] Later than v1
> The Assistant can attach files, turn voice into text, draft workflows, and start a workflow with `/<name> input`. Agents can also use tools (with approval), MCP, [Workflows](../architecture/workflows.md), and the [Second Brain](../architecture/second-brain.md). See [LLM Integration](../architecture/llm-integration.md) and [Future Phases](../roadmap/future-phases.md).

## Lineage

BlackAgents is a generic evolution of the `edu-sidekick` toolkit. Sidekick proved the `commands → agents → rules → skills` model and the `sidekick-authoring-standards` reference. BlackAgents lifts that model out of one organization, gives it a UI, and makes the standards a first-class, editable artifact.

> [!example] Validation
> Parsed against the real `edu-sidekick` repo: **18 agents, 16 commands, 29 rules, 30 skills** (93 artifacts), producing **198 cross-reference edges** in the graph.

## User Experience

- Dark-first theme (violet accent) with light mode and system detection via `next-themes`.
- Responsive shell: sidebar with per-type counts and quick-create, top bar with global "New" and refresh.
- Toast feedback (`sonner`) on every async action.
- CodeMirror Markdown editor with live preview.

## Repository

- **Path**: `/Users/cristoferdomingues/Dev/Personal/BlackAgents`
- **Remote**: https://github.com/cristoferdomingues/BlackAgents
- **App config**: stored locally at `~/.black-agents/config.json` (current + recent workspaces)

## Related

- [Tech Stack](./tech-stack.md)
- [Getting Started](./getting-started.md)
- [Architecture Overview](../architecture/architecture-overview.md)
- [Future Phases](../roadmap/future-phases.md)
