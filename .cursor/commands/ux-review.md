---
name: ux-review
description: >-
  Reviews and improves the UX of one BlackAgents screen or module so a
  first-time user understands it without docs
---

Reviews one screen or module against the design-system checklists and fixes what fails. Check first: if the screen already passes every item, report that and stop.

## Input

- `target` — a route (e.g. `/brain`) or a component path under `components/features/**`.
- `scope` — optional: `review` (report only) or `fix` (default: `fix`).

## Prerequisites

- Every invoked agent reads the `design-system` rule and the `design-system` skill sections "UX State Patterns", "Self-explaining UX", "Form & Editor Patterns" and "Layout Pitfalls".
- The IronBee DevTools browser platform is available for verification (see the `ironbee-devtools-use` rule); without it, fall back to Playwright e2e screenshots and say so.
- `npx vitest run` and `npx playwright test` pass on the current tree (record the baseline).

## Steps

1. Invoke the **uiux-designer** agent with: open `target` in the running app, then audit it item by item:
   - all four states (loading, empty, error, success);
   - plain words, explained terms, and a one-line intro per tab or section;
   - a "How it works" panel if the module has more than one concept;
   - tooltips on badges and kinds;
   - each important action says what it will do;
   - teaching empty states with links;
   - limits shown;
   - choices instead of raw switches;
   - output preview / try before save where relevant;
   - unsaved-work protection;
   - both themes, and no page-level scroll.

   Return a short pass/fail list with screenshots.
2. If `scope` is `fix`, invoke the **uiux-designer** agent with: fix every failed item using `components/ui/` primitives, with the copy in `lib/<domain>/explain.ts`; keep the existing accessible names that e2e tests use, or update those tests.
3. Invoke the **feature-developer** agent with: any server support the fixes need (e.g. a preview route that reuses the save code), with zod-validated input and the API envelope.
4. Invoke the **tester** agent with: unit tests for the new `explain.ts` / helpers, integration tests for new routes, and e2e tests for the new flows (first-visit explainer, empty state links, action effect text). Gate: type-check, lint, vitest and playwright all pass.
5. Invoke the **uiux-designer** agent with: verify again with IronBee in dark and light theme, check the console, and attach the final screenshots.

## Parallelization

- Step 1 runs first; steps 2 and 3 may run in parallel once the audit list is agreed.
- The **tester** agent (step 4) runs after the fixes; step 5 runs last.

## Error handling

- If IronBee is not available, verify with Playwright screenshots and report that IronBee was skipped.
- If a fix needs a product decision (which choices or levels to offer), stop and ask the user with clear options instead of guessing.
- Never weaken a test to pass; if an accessible name must change, update the e2e selector and say so.
