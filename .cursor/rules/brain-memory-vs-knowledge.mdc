---
description: >-
  Where Second Brain content lives — ephemeral Memory notes vs durable OKF
  Knowledge concepts — and who may mark knowledge verified.
globs:
  - lib/brain/**
  - app/api/brain/**
  - app/brain/**
  - components/features/brain/**
  - .black-agents/knowledge/**
---

- **Memory** (`lib/brain/`, `.black-agents/brain/`) = ephemeral, subjective learnings: user preferences, agent pitfalls, chat feedback, `selfAssess` notes. Keep notes lightweight (Obsidian frontmatter: `aliases`/`tags`/`parent`) — they are injected automatically and often.
- **Knowledge** (`<workspace>/.black-agents/knowledge/`) = durable domain facts: metrics, definitions, protocols, thresholds — stored as OKF v0.2 concepts with path-derived IDs and typed frontmatter. See `okf-integration` skill.
- Decide by **lifecycle, not topic**: "needs provenance, verification and staleness tracking; will outlive sessions?" → Knowledge concept; "preference or hard-won lesson?" → Memory note.
- Promotion memory → concept goes only through explicit approval (Brain inbox): human approval writes `verified`; a model proposal writes only `generated` (`llm-output-safety` rule).
- Injection: Memory sparingly and always; concepts on demand — one concept (or one `index.md` level) at a time via Jev, never whole bundles (`context-headroom` rule).
- Never store domain entities as memory notes, and never store preferences/opinions as OKF concepts.
- Never let model output mark a concept `verified`.

Related rules: context-headroom, llm-output-safety. See also: okf-integration skill.
