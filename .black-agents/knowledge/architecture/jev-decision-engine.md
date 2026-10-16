---
type: Reference
title: Jev Decision Engine
description: 'Optional fast classifier (routing, gates, learning)'
tags:
  - blackagents
  - architecture
  - llm
  - jev
  - decision-engine
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/02%20-%20Architecture/Jev%20Decision%20Engine.md
    title: Jev Decision Engine
    last_modified: '2026-10-08T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:57Z'
---

# Jev Decision Engine

> [!abstract] One-liner
> **Jev** (TypeSafe "System One") is an optional, fast classifier that makes small decisions before or after the main LLM: which artifacts to load, which skill fits a task, whether a skill description is too wide, whether a workflow step is good, whether a scheduled run is needed, and what is worth learning. Chat, workflows, and learning stay **fail-open** — without Jev, they still work. Skill suggest and the trigger check ask for Jev on purpose, so those two return **412** when it is off.

## Setup

- Settings → **AI** tab → turn on **Use Jev**, choose provider `auto` / `direct` / `openrouter`, test with **Test Jev** (`POST /api/settings/ai/jev-test`).
- `direct`: a TypeSafe key stored write-only in `secrets.json` (`jev.apiKey`).
- `openrouter`: model `typesafe/jev-1.13` via `https://openrouter.ai/api`. It reuses the **custom** provider key when that provider points at openrouter.ai.
- Only `lib/decision/*` imports `@typesafe-ai/sdk`.

## Rules

- Every `evaluate*` function **never throws**. It returns `unavailable` | `error` | a decided result.
- Background calls use a 2 s timeout and no retries. Skill suggest and each trigger probe use **3.5 s** and no retries, because the user is waiting on them.
- Act on a routing label only at confidence **≥ 0.85**. A skill pick counts only at **≥ 0.80**.
- Skip work only at confidence **≥ 0.95** and `noul ≤ 0.05`.

## Where Jev Decides

| Decision | File | Question | Acts when |
|----------|------|----------|-----------|
| Artifacts for a chat turn | `classify-artifacts.ts` | pick one of ≤ 40 candidates | ≥ 0.85, only if the user did not mention any |
| Workflow step gate | `classify-workflow.ts` | `continue` / `retry` / `stop` | ≥ 0.85, else continue |
| Schedule preflight | `classify-workflow.ts` | `skip` / `run` + "new work?" noul | skip only at ≥ 0.95 and noul ≤ 0.05 |
| What to learn | `classify-learning.ts` | one of 6 actions + importance score 0–3 | ≥ 0.85 and importance ≥ 2 |
| Brain notes relevance | `classify-learning.ts` | one noul per note (≤ 12) | noul ≥ 0.5 |
| Which skill fits a task | `skill-suggest.ts` | one of ≤ 40 skills, or `NONE` | ≥ 0.80, else no skill |
| Is this skill description safe? | `skill-suggest.ts` | the same choice, once per probe | see below |

## Artifact Selection per Chat Turn (`lib/assistant/turn-artifacts.ts`)

1. **Mentions win**: `@type:name` or `/name` (when the name is unique).
2. Otherwise Jev may pick one artifact.
3. Then the linked skills/rules of what was picked (and of the persona) are added.
4. Max 5 artifacts, 24k-char budget, injected as **quoted JSON data**.

The chat shows them as "Context:" badges (`mention` / `auto` / `linked`).

## Skill Suggest and Trigger Check (`lib/decision/skill-suggest.ts`)

Jev only reads the **description**. A good one says what the skill does, then **Use when …** with words a person would type.

**Suggest** (`POST /api/skills/suggest`) asks which saved skill fits one task. Labels are `S0`… plus `NONE`. A weak match under 0.80, or `NONE`, means no skill. The Skills page box is **Which skill fits?**

**Check trigger** (`POST /api/skills/eval`) tests one skill, including a draft that is not saved yet. The draft replaces a saved skill of the same name. Default probes:

- up to 3 short lines taken from the description (should open this skill)
- four unrelated tasks: “refactor this function”, “create a table”, “write tests”, “fix a typo in the readme” (should stay closed)

The caller may send up to 6 `positive` and 6 `negative` prompts instead. The dialog shows one of:

| Verdict | Meaning |
|---------|---------|
| `ready` | It opened only for its real job |
| `too-broad` | Unrelated tasks also opened it |
| `never-triggers` | Its own tasks did not open it |
| `unclear` | Both problems |

If the description has no “Use when”, “Read when”, “when the user”, or “when you”, the report also warns to add that phrase. Nothing is written to disk.

## Related

- [Agent Runtime & Approvals](./agent-runtime-approvals.md)
- [Workflows](./workflows.md) — step gates and preflight
- [Second Brain](./second-brain.md) — learning decisions and note relevance
- [LLM Integration](./llm-integration.md)
- [Skills](../artifacts/skills.md) — the description is the trigger Jev reads
