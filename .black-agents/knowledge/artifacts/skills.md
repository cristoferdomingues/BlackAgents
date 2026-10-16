---
type: Reference
title: Skills
description: Deep reference packages
tags:
  - blackagents
  - artifacts
  - skills
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/03%20-%20Artifact%20Model/Skills.md
    title: Skills
    last_modified: '2026-10-13T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:48Z'
---

# Skills

A **skill** is a deep reference package — a detailed procedure, template, or body of knowledge. Skills *educate*; agents read them when they need depth.

## File & Frontmatter

- **Location**: `.cursor/skills/<name>/SKILL.md` (a **folder**, not a flat file)
- **Frontmatter**:

```yaml
---
name: jira-workflow
description: JIRA-driven development workflow for all tickets.
---
```

| Field | Required | Meaning |
|-------|----------|---------|
| `name` | yes | kebab-case identifier (matches folder name) |
| `description` | yes | what it teaches, then **Use when …** so [Jev](../architecture/jev-decision-engine.md) knows when to open it |

> [!note] A skill is a package
> The unit is the folder. `SKILL.md` is the entry point; supporting files (scripts, references, templates) live alongside it. Deleting a skill removes the whole directory — see [Domain Model](../architecture/domain-model.md).

## Body Shape (from the standards)

- A **"When to use"** section up front.
- Ordered **steps** or a clear reference structure.
- Examples, templates, and a `See also:` line linking related artifacts (feeds the [Relationship Graph](../architecture/relationship-graph.md)).

> [!tip] Skills vs Rules
> If it states a constraint in a sentence, it's a [rule](./rules.md). If it walks you through *how*, it's a skill. The line is "do/don't" vs "here's how".

## In the UI

Skills are read and written through the nested layout: the parser looks for `<name>/SKILL.md`, and create/rename/delete operate on the folder.

On the **Skills** list, **Which skill fits?** asks Jev which saved skill matches a task. In the skill editor, **Check trigger** tests the current description before you save it. A description that is too wide, or that may never trigger, is reported in a dialog. Turn on Jev in Settings → AI first. See [Jev Decision Engine](../architecture/jev-decision-engine.md).

**Skills → New** also has **YouTube videos**. Paste a link and the app reads the captions. **Draft with assistant** can then write the body (and the description, if you left it empty) from those transcripts. The saved body keeps a `## Sources` section with the video links. A video with no captions asks you to paste the transcript. See [YouTube Sources](../specs/youtube-sources.md).

## Related

- [Agents](./agents.md) — who reads skills
- [Rules](./rules.md) — the lighter sibling
- [YouTube Sources](../specs/youtube-sources.md) — draft a new skill from video captions
- [Authoring Standards](./authoring-standards.md)
- [Domain Model](../architecture/domain-model.md)
