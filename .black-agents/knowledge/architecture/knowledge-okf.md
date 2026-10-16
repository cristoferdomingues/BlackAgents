---
type: Reference
title: Knowledge (OKF)
description: 'Durable facts as OKF 0.2 concepts, separate from memory'
tags:
  - blackagents
  - architecture
  - knowledge
  - okf
  - brain
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/02%20-%20Architecture/Knowledge%20(OKF).md
    title: Knowledge (OKF)
    last_modified: '2026-10-15T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:56Z'
---

# Knowledge (OKF)

> [!abstract] One-liner
> Durable facts live as **OKF v0.2 concepts** in `.black-agents/knowledge/`. Memory notes stay lightweight. A concept file is written only when a person approves it, except the crypto starter kit.

Agents, commands, rules, and skills are **not** OKF. See [Domain Model](./domain-model.md). Preferences and lessons stay in [Memory](./second-brain.md).

## Where files live

| Path | Role |
|------|------|
| `.black-agents/knowledge/<id>.md` | One concept. The id is the path without `.md` (`crypto/bitcoin`) |
| `.black-agents/knowledge/**/index.md` | One folder at a time. Root index may say `okf_version: "0.2"` |
| `.black-agents/knowledge/**/log.md` | History. Export builds the root log from `generated` and `verified` dates |
| `okf/` in an export folder | A copy of the bundle. Not the source |

`index.md` and `log.md` are reserved. They are not concepts.

## Version pin (`lib/knowledge/schema.ts`)

Only OKF **0.2** is accepted. A bundle that declares any other version fails with a clear error. A missing version is allowed. Inside an accepted bundle, v0.1 leftovers are explicit warnings:

- `timestamp` → `generated.at` (actor `process:okf-v0.1`)
- a `# Citations` list → `sources`, only when `sources` is empty

Unknown concept types and extra frontmatter keys are kept. They do not fail the parse.

## Trust

| Who | Field |
|-----|--------|
| A proposal (import, or promoting a memory note) | `generated` only |
| Human approval | appends `verified: { by: "human:local", at }` |
| The crypto starter | `generated.by: process:workspace-template`, no `verified` |

No `verified` means unverified. Only a `human:` actor means human-reviewed.

## Import, inbox, export

1. **Preview** — Brain → Knowledge. `POST /api/knowledge/import` `{ action: "preview", path }`. Reads `index.md` one level at a time. Writes nothing.
2. **Add to inbox** — `{ action: "queue", path, id }` saves a pending `new_concept` proposal. Still no knowledge file.
3. **Approve** — `decideProposal` calls `writeConcept`. That is the only writer of `.black-agents/knowledge/` besides the crypto template seed.
4. **Update** — promoting a note whose id already exists queues `update_concept`.
5. **Export** — `/export` target **OKF Bundle** (`platform: "okf"`). Same dry-run / write / `targetPath` contract as IDE export. Files land under `okf/`.

A second queue of an id that is already saved returns **409**.

## What the assistant sees

`buildSystemContext()` adds one line per concept: id, title, description. Bodies are not in the prompt. The model reads one file with `fs_read` at `.black-agents/knowledge/<id>.md`.

## Checks (`lib/knowledge/checks.ts`)

Before a concept is queued or saved:

- `type` is required
- id segments are kebab-case
- `stale_after`, when set, is an ISO datetime
- a markdown link to a missing concept is a **warning**, not an error

## Crypto starter

`scaffoldWorkspace(..., "crypto")` writes `lib/workspace/crypto-knowledge.ts` into `.black-agents/knowledge/`. Concepts: `crypto/bitcoin`, `crypto/ethereum`, `crypto/portfolio-metrics`, `crypto/risk-thresholds`. Blank and software templates do not get this folder. Bitcoin is adapted from the official `crypto_bitcoin` bundle, not a copy of its BigQuery tables.

## Code

| Piece | Path |
|-------|------|
| Schema | `lib/knowledge/schema.ts` |
| Store | `lib/knowledge/store.ts` (`writeConcept`) |
| Bundle reader | `lib/knowledge/bundle.ts` |
| Import | `lib/knowledge/import.ts`, `POST /api/knowledge/import` |
| Export writer | `lib/knowledge/export.ts` |
| Promote | `proposeConceptFromMemory`, `POST /api/brain/promote` |

## Related

- [Second Brain](./second-brain.md)
- [Relationship Graph](./relationship-graph.md)
- [Domain Model](./domain-model.md)
- [API Reference](../api/api-reference.md)
- [Future Phases](../roadmap/future-phases.md)
