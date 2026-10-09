---
name: obsidian-conventions
description: BlackAgents authoring for the base knowledge for BlackAgents
---

# Obsidian Conventions

## When to Apply

Read this when writing or updating notes in the project vault. The exploration workflow and persona live in the **knowledge-base-builder** agent; this skill is the formatting and quality reference.

## Vault Structure

Notes are organized into numbered sections for navigation order:

```
ProjectName/
├── 00 - MOC.md                    # Map of Content (main index)
├── 01 - Project Overview/         # Identity, stack, setup, principles
├── 02 - Architecture/             # System design, patterns, data flow
├── 03 - Modules/                  # One note per feature module
├── 04 - API Reference/            # One note per endpoint group
├── 05 - Data Models/              # TypeScript interfaces and schemas
├── 06 - Integrations/             # External services and protocols
├── 07 - UI & Components/          # Component architecture, design system
├── 08 - DevOps & Infrastructure/  # CI/CD, Docker, env vars, deployment
├── 09 - Testing/                  # Strategy, tools, configuration
├── 10 - Development Guide/        # How-to guides for common tasks
└── Templates/                     # Reusable note templates
```

Adapt to the project: skip sections that don't apply; add domain-specific ones (e.g. "Blockchain").

## Frontmatter (required on every note)

```yaml
---
aliases: [Alternative Name 1, Alternative Name 2]
tags: [project-name, section-tag, topic-tag]
created: YYYY-MM-DD
updated: YYYY-MM-DD
type: reference | how-to | module | api-reference | data-model | template | moc
parent: "[[Parent Note Name]]"
---
```

- `aliases` — enable linking by alternative names; include common abbreviations.
- `tags` — project name first, then 2–3 topical tags.
- `type` — for Dataview queries/filtering.
- `parent` — link to the containing MOC or section overview.

## Internal Links

- Link extensively — the graph is what makes the vault valuable.
- Every note ends with a "Related" section linking 2–3 related notes.
- Link inline when referencing concepts defined elsewhere (e.g. "Uses the [[Provider-Aggregator Pattern]]").
- Link to headings when useful: `[[API Overview#Error Codes]]`.

## Callouts

Reserve for genuinely important context (don't overuse): `> [!info]`, `> [!warning]`, `> [!important]`, `> [!tip]`, `> [!note]` with a title and body.

## Mermaid

One concept per diagram. Use for architecture (graph TB/LR), data flow (sequenceDiagram), component hierarchy (graph TB), decision flows (flowchart). Prefer several simple diagrams over one overwhelming one.

## Tables & Code

- Use tables for module/feature inventories, API summaries, env var references, integration status, and file-path references — they're the fastest lookup for AI agents.
- Include actual TypeScript interfaces and key types in language-tagged code blocks so agents can write correct code.

## Note-Writing Principles

Each note should be self-contained enough that an agent reading only it understands:
1. **What** it is and does
2. **Where** it lives (actual file paths)
3. **How** to follow its interfaces, patterns, conventions
4. **Why** the design decisions and constraints matter
5. **Related** parts of the system

Be specific, not generic: real file paths, real types, real endpoints and response shapes, real env var names, real library versions. Use a consistent structure within each section. Flag README/code discrepancies with a `> [!warning]` callout.

## MOC (`00 - MOC.md`)

The entry point must contain: a Project Identity table (name, type, framework, language, repo path); Navigation (links to every note, grouped by section); and Quick Reference (file tree + key entry points). Use `[[internal links]]` for every note.

## Templates

Create 2–4 reusable templates in `Templates/` for the most common note types (e.g. Module, API Endpoint, Provider). Show expected frontmatter, headings, and placeholders.

## Quality Checklist

- [ ] Every note has frontmatter (aliases, tags, type, parent)
- [ ] Every note has a "Related" section with 2+ links
- [ ] MOC links to every note
- [ ] File paths reference actual files
- [ ] TypeScript types match the codebase
- [ ] Mermaid diagrams use valid syntax
- [ ] No orphan notes (all reachable from MOC)
- [ ] Templates exist for common note types
- [ ] Doc/code discrepancies flagged

## How to Use

Reference-only. Follow these conventions for every note; verify against the checklist before declaring the vault complete.
