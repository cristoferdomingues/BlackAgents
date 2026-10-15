---
name: integrate-okf
description: >-
  Orchestrates the five-phase adoption of OKF v0.2 (Open Knowledge Format) in
  BlackAgents
---

Orchestrates the five-phase adoption of OKF v0.2 (Open Knowledge Format) in BlackAgents — adapter, import, export, Brain Knowledge layer, starter-kit seed. Check for the output markers first and skip any phase that already exists.

## Input

- `phase` — optional scope: `0`..`4` (default: the next incomplete phase).

## Prerequisites

- Workspace builds and `npx vitest run` passes on the current tree (record the baseline before touching anything).
- Every invoked agent must read the `okf-integration` skill and the `brain-memory-vs-knowledge` rule before writing code.
- Spec pinning: OKF `0.2` is the only accepted version; bundles on any other version must fail with a clear message, never best-effort parsing.
- Knowledge lives in `<workspace>/.black-agents/knowledge/` with path-derived concept IDs; nothing writes there outside the Brain approval flow.

## Steps

1. Invoke the **feature-developer** agent (Fase 0) with: create `lib/knowledge/` — the OKF v0.2 zod schema (explicit v0.1 fallback warnings), the workspace-scoped concept store (path-derived IDs, all paths resolved inside the workspace), and the bundle parser for a **folder path** (zip deferred), walking `index.md` level by level, frontmatter parsed with the existing artifact parser.
2. Invoke the **tester** agent (Fase 0) with: unit tests for the schema (valid/invalid frontmatter, v0.1 fallback, version-pin failure) and the parser (folder bundle, orphan detection, index walk). Gate: all tests pass.
3. Invoke the **feature-developer** agent (Fase 1) with: dry-run-only import endpoint (parse + preview, zero writes, existing sources error pattern) plus the "Knowledge" tab preview in the Brain screens.
4. Invoke the **uiux-designer** agent (Fase 1) with: integrate the concept preview into the existing Brain UI (same visual language, approval CTA); approving a concept writes it via the store and queues an inbox proposal.
5. Invoke the **tester** agent (Fase 1) with: integration tests for the endpoint (happy path, malformed bundle, version mismatch) and component tests for the preview. Gate: all tests pass.
6. Invoke the **feature-developer** agent (Fase 2) with: concept-to-file writer generating v0.2 frontmatter + `index.md` + `log.md` from workspace history, reusing the existing export diff/targetPath contract; add the "OKF Bundle" target to the Export screen.
7. Invoke the **tester** agent (Fase 2) with: tests for manifest generation, per-file diff statuses, and the export endpoint (preview/write/dry-run). Gate: all tests pass.
8. Invoke the **feature-developer** agent (Fase 3) with: inbox actions `new_concept`/`update_concept`, concept standards check (type present, kebab-case path segments, links resolve, `stale_after` parses), approval semantics — human approval fills `verified`, model proposal fills only `generated`.
9. Invoke the **llm-integrator** agent (Fase 3) with: inject a compact knowledge registry into system context (one line per concept: id, title, description; bodies load on demand via `fs_read` only, per `context-headroom`); extend the relationship graph so concept links feed it alongside `@` mentions.
10. Invoke the **tester** agent (Fase 3) with: tests for the standards check, the memory→concept promotion flow, and context injection (registry only, never bodies). Gate: all tests pass.
11. Invoke the **feature-developer** agent (Fase 4) with: seed the workspace template with a `crypto` knowledge bundle adapted from the official OKF `crypto_bitcoin` reference bundle.
12. Invoke the **tester** agent (Fase 4) with: template test asserting the seeded bundle parses against the v0.2 schema. Gate: all tests pass.

## Parallelization

- Phases run strictly in order; each phase's gate is the next phase's prerequisite.
- Within a phase, developer/designer steps may run concurrently; the **tester** agent always runs last.
- In Fase 3, steps 8 and 9 are independent and may run in parallel.

## Error handling

- **Blocking:** test failure — hand the failing output back to the producing agent once; if it fails again, stop and report the diff and failures. **Blocking:** spec drift — if the version-pin check or v0.1 fallback cannot be made explicit, stop the phase; never ship best-effort parsing. **Blocking:** any attempt to write to the knowledge directory outside the Brain approval flow — stop the run and report it.
- **Non-blocking:** an already-existing phase marker (schema + store present with passing tests) — skip that phase and note it in the final report.
