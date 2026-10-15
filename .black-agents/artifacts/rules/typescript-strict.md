---
description: TypeScript strictness conventions for BlackAgents.
alwaysApply: true
---

- TypeScript runs in strict mode; do not weaken `tsconfig.json`.
- No `any` — use generics, discriminated unions, and `unknown` with narrowing for uncertain input.
- Give exported functions explicit return types.
- Never silence the compiler with `@ts-ignore`; fix the type instead.
- Use absolute imports via the `@/` alias, not deep relative paths.
- Validate all external input (request bodies, file frontmatter) with `zod` before trusting it.
- Keep `npm run type-check` (`tsc --noEmit`) and `npm run lint` clean before declaring done.

Related rules: api-response-format.
