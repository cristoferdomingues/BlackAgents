---
description: Definition of done for tests in BlackAgents — no feature ships untested.
alwaysApply: true
---

- A feature is not complete until it has tests: unit (Vitest) for `lib/` logic, integration for `app/api/**` route handlers, E2E (Playwright) for user-facing flows.
- Cover happy path, edge cases, and error scenarios — not just the success case.
- Filesystem tests run against a temporary workspace directory; never read or write the developer's real workspace or `~/.black-agents`.
- Test observable behavior, not implementation details; mock only true externals (the LLM provider, the filesystem boundary when needed).
- Keep coverage at 80%+ on the `lib/` domain, which holds the app's core logic.
- Never commit `.only` or `.skip`; a skipped test is a failing test.

See also: testing-patterns skill.
