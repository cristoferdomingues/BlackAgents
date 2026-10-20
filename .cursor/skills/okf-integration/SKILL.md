---
name: okf-integration
description: >-
  Reference for Open Knowledge Format (OKF) in BlackAgents — v0.2 spec summary,
  mapping to the internal model, adoption phases, and what must NOT be migrated.
  Read when importing an OKF bundle, exporting knowledge context, or deciding
  where domain context lives.
---

## When to Apply

Read this when a task touches **Open Knowledge Format (OKF)** bundles: importing a bundle as a source, exporting workspace knowledge as a bundle, building the Second Brain Knowledge layer, or deciding whether some content should become an OKF concept instead of a skill, rule, or memory note.

For the Memory-vs-Knowledge split inside the Brain, follow the `brain-memory-vs-knowledge` rule first — this skill covers the OKF format itself.

Do NOT read it for authoring agents, commands, rules, or skills — those keep the existing authoring standards.

## What OKF Is

Google's open standard for sharing domain knowledge between humans and agents. **Current version: v0.2** (supersedes v0.1 — re-check [GoogleCloudPlatform/open-knowledge-format](https://github.com/GoogleCloudPlatform/open-knowledge-format) before changing the zod schema).

- **Bundle** — a directory of markdown files, distributed as a git repo (recommended), tarball/zip, or a subdirectory. `index.md` (progressive disclosure) and `log.md` (history) are optional, at any level.
- **Concept** — one unit of knowledge: a `.md` file with typed YAML frontmatter (required `type`; recommended `title`/`description`/`resource`/`tags`) and a body of prose/schemas/queries.
- **Concept ID** — the file's path inside the bundle with `.md` removed (there is no separate manifest ID). Hierarchy is implicit in directories; `index.md` lets a reader navigate one level at a time.
- **Links** — standard markdown links between concepts, beyond the parent/child hierarchy.
- **The invention is the agreement**, not the markdown: one shared rule for what a file contains, what its name means, how files link.

Target domain: catalog/enterprise data context (tables, KPIs, lineage) — context agents need that today is scattered across catalogs and stale wikis.

## What v0.2 Added (matters for BlackAgents)

- **Provenance, trust, freshness are first-class frontmatter:** `sources` (per-source credibility signals `author`, `usage_count`, `last_modified`, plus `usage_window`), `generated: { by, at }` + `verified[]` → trust tiers (unverified / machine-confirmed / human-reviewed), `status` + `stale_after`. Actor convention: `<agent>/<version>`, `human:<id>`, `process:<id>`.
- **`Attested Computation` concept type** — `runtime`, `parameters`, `computation`, `executor`, `attester`, `receipt`: a sanctioned way to compute a value plus evidence it was computed that way. Body heading `# Computation`.
- **Progressive disclosure built in** — `index.md` navigation instead of loading whole bundles.
- **Breaking vs v0.1:** `timestamp` → `generated.at`; body `# Citations` → frontmatter `sources`. Consumers MAY fall back to legacy fields.
- Reference bundles live in the repo (`bundles/crypto_bitcoin/` is directly relevant to the Crypto starter kit).

## Fit With BlackAgents

BlackAgents already applies the same thesis to agent artifacts: typed frontmatter, `@` mentions, an authoring-standards baseline, a relationship graph, and a platform-agnostic internal model exported to multiple layouts. OKF is the counterpart for **knowledge context**, not for artifacts.

| Concern | Owner |
| --- | --- |
| Agents, commands, rules, skills | Existing authoring standards + multi-platform export (never OKF) |
| Domain context (data, metrics, protocols) | OKF concepts (candidate) — Brain **Knowledge** layer |
| Second Brain Memory (preferences, pitfalls, feedback) | Stays in `lib/brain/` as lightweight notes — never OKF |
| Second Brain durable knowledge promoted from memory | OKF concepts via approval — see `brain-memory-vs-knowledge` rule |
| Chat transcripts, workflows, MCP config | Stay in `.black-agents/` as-is |

v0.2's `generated`/`verified`/`status` map naturally onto Brain proposals (who produced, who approved, still current) — reuse that instead of inventing a parallel trust scheme.

## Mapping Table

| OKF | BlackAgents |
| --- | --- |
| Bundle | A workspace folder, or an exported `.zip`/git subtree |
| Concept ID (path minus `.md`) | Stable key in `<workspace>/.black-agents/knowledge/` (e.g. `crypto/portfolio-metrics.md`) |
| Concept frontmatter | Validated with zod (same pattern as `lib/artifacts/schemas.ts`), with `generated`/`verified`/`stale_after` mapped to Brain approval state |
| Concept links | Feed the relationship graph alongside `@` mentions |
| `index.md` progressive disclosure | On-demand concept loading for `context-headroom` (Jev picks the level/concept) |
| `sources` + credibility signals | Existing source registry (YouTube-as-a-source flow) |
| Bundle `log.md` | Generated on export from artifact history |

## Adoption Phases

1. **Fase 0 — Adapter (checkpoint 0.2 reached, can start now).** Zod schema for the OKF v0.2 spec + a reader in `lib/export`. No change to the internal model. Handle the v0.1 fallbacks (`timestamp`, `# Citations`) or reject non-0.2 bundles explicitly.
2. **Fase 1 — Import as a source.** Paste/upload an OKF bundle → preview concepts (walk `index.md`, never load the whole bundle) → convert into a skill or a Knowledge concept, approved on the Brain screen. Mirrors the existing YouTube-as-a-source flow.
3. **Fase 2 — Export target.** A new "OKF Bundle" export layout reusing the existing per-file diff and `.zip` download; emit `index.md` + `log.md` and `generated`/`verified` from workspace history.
4. **Fase 3 — Second Brain Knowledge layer.** Split the Brain in two stores per the `brain-memory-vs-knowledge` rule: Memory notes keep their current format; durable domain facts land in `<workspace>/.black-agents/knowledge/` as path-derived concept IDs. Promotion memory → concept goes only through the Brain inbox approval (approval fills `verified`, proposal fills `generated`); orphan detection via `lib/standards/checks.ts`. Memory injects automatically and sparingly; concepts load on demand.
5. **Fase 4 — Domain context for starter kits.** The Crypto kit ships a `crypto` bundle (tokens, metrics, risk thresholds — seed from the repo's `bundles/crypto_bitcoin/`); agents load only the concepts they need so `context-headroom` is preserved (use Jev to pick).

## Guardrails

- **A knowledge file can only be written as a valid OKF concept.** `fs_write`/`fs_edit` (`lib/runtime/tools/fs.ts`) refuse to create or change any `.black-agents/knowledge/**/*.md` file (other than the reserved `index.md`/`log.md`) unless its content parses as a valid concept (`parseConceptContent`, requires at least `type`). This holds even when a model bypasses the `\`\`\`knowledge` draft/Inbox protocol and tries to write the file directly — the tool layer is the fail-closed backstop, not just the prompt.
- **Never migrate artifacts to OKF.** Agent/rule/skill frontmatter is platform-specific (`.mdc`, `alwaysApply`, `globs`) and already handled by multi-platform export. Two schemas for one file = fragile mapping.
- **Never migrate Memory notes to OKF.** Preferences, pitfalls and chat feedback stay lightweight in `lib/brain/`; only durable domain facts become concepts. Decide with the `brain-memory-vs-knowledge` rule.
- **Bundle OKF is verbose.** Do not load whole bundles into context; traverse `index.md` level by level and select concepts on demand (`context-headroom` rule). The spec's progressive disclosure is the mechanism.
- **Trust fields are evidence, not decoration.** Only human approval writes `verified`; a model proposal writes only `generated`; `stale_after` triggers a re-check (`llm-output-safety` rule).
- **`Attested Computation` executors are not in scope yet.** Reading the concept type is fine; running `executor`/`attester` code would be an `exec` action and must be approval-gated.
- **Spec drifts.** Re-check the repo README/SPEC before touching the adapter; pin the schema to a spec version and handle v0.1 fallbacks explicitly.
- **Local-first and approval keep priority.** Imports are previews; nothing is written to the workspace until the user approves.

## How to Use

- Importing a bundle → Fase 1 flow: parse (v0.2 schema), preview via `index.md`, convert, approve.
- Exporting knowledge → Fase 2: generate `index.md`/`log.md`/frontmatter from the internal model.
- Deciding where new content goes → `brain-memory-vs-knowledge` rule first, then the Fit table above.
- Spec details change: re-check the official OKF repo (`SPEC.md`, §13 = changelog) before touching the zod schema.

See also: `brain-memory-vs-knowledge` rule, `context-headroom` rule, `llm-output-safety` rule, `obsidian-conventions` skill, `nextjs-app-patterns` skill.
