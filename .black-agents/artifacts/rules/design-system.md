---
description: UI consistency guardrails for BlackAgents components.
alwaysApply: false
globs: 'app/**/*.tsx,components/**/*.tsx'
---

- Reuse `components/ui/` (shadcn/ui) primitives; don't rebuild what already exists.
- Use Tailwind classes and design tokens (`bg-background`, `text-muted-foreground`, `border`) — never hardcoded hex or inline styles.
- Support dark and light mode through `next-themes`; dark is the default, so verify both.
- Implement every UI state: loading (skeleton), empty (with guidance), error (with retry), success.
- Icons come from `lucide-react` with consistent sizing (`h-4 w-4` default).
- Add `"use client"` only to components that need interactivity, state, or effects; keep the rest as server components.
- Fetch through `apiFetch` (`lib/api.ts`) and read workspace state from `WorkspaceProvider` — no raw `fetch` in feature components.
- Give interactive elements accessible names and keep forms on `react-hook-form` + `zod`.
- Make screens self-explaining in plain words: one-line intro per tab/section, tooltips for terms, empty states that say how they get filled (with a link), and a sentence saying what each important action will do.
- Prefer a few named choices (levels, radio cards) over many raw switches or free-text lists; preview real output with the same server code that saves it.
- Keep UI copy and help in an isomorphic `lib/<domain>/explain.ts` with unit tests.

See also: design-system skill.
