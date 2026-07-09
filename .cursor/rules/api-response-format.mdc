---
description: Standard response envelope for BlackAgents API routes.
alwaysApply: false
globs: app/api/**
---

- Every API route returns the `ApiEnvelope`: `{ success: true, data }` or `{ success: false, error }`.
- Build responses with the helpers in `lib/api-response.ts` — `ok(data)`, `fail(message, status)` — never a bare `NextResponse.json`.
- Wrap handler bodies in `handle()` so thrown errors become a clean `500` envelope instead of leaking stack traces.
- Validate the request body with `zod` and return `fail(..., 400)` on invalid input.
- Missing or unconfigured credentials return **412**; keep API keys server-side and never echo them back.
- Do filesystem work only through `lib/fs-service.ts` (`resolveInWorkspace`) so paths stay inside the workspace.

Related rules: typescript-strict. See also: nextjs-app-patterns skill.
