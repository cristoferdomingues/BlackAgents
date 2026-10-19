---
name: implement-project-scopes
description: >-
  Orchestrates the implementation of project scopes in the BlackAgents source —
  one-level sub-scopes inside a workspace with a project.json inheritance
  whitelist — across domain, loaders, UI, tests, and a gated release review.
---

## Input

- Optional: a project id to seed as the first example project (default `myhealthcare`).
- Optional: a subset of the whitelist tokens to implement first (default: all tokens from the `project-scopes` skill).
- The BlackAgents source folder is the target — all file changes happen there, never in `.black-agents/artifacts/`.

## Prerequisites

- Read the `project-scopes` skill before starting; it defines the manifest spec, the resolution algorithm, the closed token set, and the code-seam table this command follows.
- The workspace builds clean: `type-check`, `lint`, and the existing test suite pass on the current commit.
- No other in-flight change touches `lib/artifacts/parser.ts`, `lib/mcp/config.ts`, or `lib/config.ts` — those files are on the critical path.

## Steps

1. **Domain layer.** Invoke the **feature-developer** agent to implement the seam table from the `project-scopes` skill in order: parameterize `SOURCE_ROOT` in `lib/artifacts/source.ts`, add `scope` to `Artifact` in `lib/artifacts/types.ts`, add the `project.json` zod schema and loader, and extend `scanWorkspace` in `lib/artifacts/parser.ts` with scope-first, whitelist-gated merging. Enforce the invariants: one level only, id must equal folder name, fail closed on any invalid manifest. Follow the `typescript-strict` rule.

2. **Service loaders.** Invoke the **feature-developer** agent to make the remaining loaders scope-aware: merge-order MCP config in `lib/mcp/config.ts` (project wins on name), scope-gated workflow and knowledge loaders, `activeProject` persistence in `lib/config.ts` (cleared on workspace switch), and scope-aware `@mention` resolution in the graph. Writes must resolve against the scope root through `resolveInWorkspace` — add the escape test proving `../../` traversal fails.

3. **API + UI.** Invoke the **feature-developer** agent for the API surface (project CRUD, scope-aware artifact endpoints using the standard envelope from `api-response-format`), then invoke the **uiux-designer** agent for the project switcher beside the workspace switcher and origin badges (project vs inherited) on artifact lists. Follow the `design-system` rule and the `design-system` skill.

4. **Tests.** Invoke the **tester** agent to cover: manifest validation (reject unknown tokens, id/folder mismatch, nested projects), resolution order (project beats parent), fail-closed behavior for every non-inherited token, MCP merge order, filesystem confinement, and an API integration test for project CRUD. Follow the `testing-required` rule.

5. **Verification against the running app.** Per the `ironbee-devtools-use` rule, drive the built app: create a project, confirm inherited artifacts appear badged, confirm a non-inherited service is absent, confirm writes land inside the project folder.

6. **Fix pass.** If step 4 or 5 found defects, invoke the **feature-developer** agent with the defect list; re-run the failed tests and the verification flow. Repeat until clean.

7. **Release review (gate).** Invoke the **release-reviewer** agent to verify each acceptance criterion from the `project-scopes` skill against the diff and the running app. A FAIL verdict returns to step 6 with the defect list; do not ship on FAIL.

## Parallelization

- Steps 1 and 2 are sequential (both touch the parser's merge path).
- Step 3's API work can start once step 2 lands; the UI half of step 3 can run in parallel with the API half.
- Step 4 begins as soon as step 3's API surface is stable; unit tests for step 1–2 logic can be written in parallel with step 3.
- Steps 5–7 are strictly serial and gated.

## Error handling

- **Manifest/spec drift:** if the implementation needs a token or field not in the `project-scopes` skill, stop and update the skill first — the skill is the source of truth, then resume.
- **Fail-closed regression:** any test showing a project inheriting by default is a blocker — route to step 6 immediately.
- **Confinement violation:** any read/write escaping the workspace root is a blocker; halt the run and report.
- **Idempotency:** if `.black-agents/projects/` already exists with a valid manifest and all tests pass, skip steps 1–4 and jump to step 5 verification.
- **Repeated FAIL:** two consecutive FAIL verdicts from the **release-reviewer** agent end the run with a summary of unresolved defects instead of looping.
