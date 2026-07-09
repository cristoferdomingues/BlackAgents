---
name: testing-patterns
description: Reference for testing BlackAgents — bootstrapping Vitest + Playwright, unit-testing the lib/ domain, integration-testing API routes, mocking the filesystem and LLM provider, and E2E flows. Read when writing or reviewing tests.
---

# BlackAgents Testing Patterns

## When to Apply

Read this when adding or reviewing tests. The definition of done lives in the `testing-required` rule; this file is the *how* — including the initial setup, since the repo has no test runner yet.

## Stack (to introduce)

| Level | Tool | Scope |
|-------|------|-------|
| Unit | Vitest | `lib/artifacts/**`, `lib/standards/**`, `lib/llm/**`, `lib/*.ts` |
| Component | Vitest + `@testing-library/react` + `jsdom` | `components/**` |
| Integration | Vitest (invoke route handlers directly) | `app/api/**/route.ts` |
| E2E | Playwright | full flows against `next dev` |

## Bootstrap

```bash
npm i -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom
npm i -D @playwright/test && npx playwright install
```

Add scripts to `package.json`:

```jsonc
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:e2e": "playwright test"
  }
}
```

Minimal `vitest.config.ts` (uses the same `@/` alias as `tsconfig.json`):

```ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: { environment: "node", globals: true },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
})
```

Use `environment: "jsdom"` per-file (`// @vitest-environment jsdom`) for component tests.

## Unit — the lib/ domain (highest value)

Round-trip and edge cases for the pure functions:

```ts
import { describe, it, expect } from "vitest"
import { serializeArtifact } from "@/lib/artifacts/serializer"
import { parseArtifact } from "@/lib/artifacts/parser"

describe("artifact round-trip", () => {
  it("preserves frontmatter + body for an agent", () => {
    const input = {
      type: "agent", platform: "cursor", name: "demo",
      description: "A demo agent.", body: "## Input\n- x\n", extra: {},
    } as const
    const { content } = serializeArtifact(input)
    expect(content).toContain("name: demo")
    expect(content).toContain("## Input")
  })

  it("omits name for rules (identified by filename)", () => {
    const { content } = serializeArtifact({
      type: "rule", platform: "cursor", name: "no-secrets",
      description: "Guardrail.", body: "- do x\n",
      extra: { alwaysApply: true },
    })
    expect(content).not.toContain("name:")
    expect(content).toContain("alwaysApply: true")
  })
})
```

Cover: `schemas` (kebab-case names, required description), `layout` (path per platform/type, nested skills), `graph` (reference extraction across the five conventions).

## Filesystem mocking

`lib/fs-service.ts` confines I/O with `resolveInWorkspace`. Test against a real **temp dir**, not mocks, so path-traversal rejection is exercised:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

let root: string
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "ba-")) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
```

Assert that a `..` path throws `WorkspaceError`.

## Integration — API routes

Route handlers return the `{ success, data | error }` envelope via `ok` / `fail` / `handle`. Call them directly with a `Request`:

```ts
import { POST } from "@/app/api/artifacts/route"

it("rejects an invalid name with 400", async () => {
  const res = await POST(new Request("http://t/api/artifacts", {
    method: "POST",
    body: JSON.stringify({ type: "agent", platform: "cursor", name: "Bad Name", description: "x", body: "" }),
  }))
  expect(res.status).toBe(400)
  const json = await res.json()
  expect(json.success).toBe(false)
})
```

Assert both the HTTP status and `success` flag. Point the workspace config at a temp dir via `BLACK_AGENTS_CONFIG_DIR`.

## Mocking the LLM provider

For `/api/chat`, `/api/artifacts/draft-body`, and `/api/artifacts/validate`, stub the provider so tests are deterministic and never hit the network or need a key:

```ts
vi.mock("@/lib/llm/registry", async (orig) => ({
  ...(await orig()),
  resolveProvider: () => ({ generate: async () => "```validation\n{\"findings\":[]}\n```" }),
}))
```

Then assert the route parses it via `extractDraft` / `extractValidation`.

## E2E — critical flows

```ts
import { test, expect } from "@playwright/test"

test("create and save an agent", async ({ page }) => {
  await page.goto("/agents/new")
  await page.getByLabel("Name").fill("demo-agent")
  await page.getByLabel("Description").fill("A demo agent.")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("demo-agent")).toBeVisible()
})
```

Keep E2E few and flow-level (create → edit → save, graph renders, export produces files). Use a disposable workspace so runs are isolated.

## Coverage Categories

For each feature confirm: happy path · empty/missing input · invalid input (bad kebab name, missing frontmatter) · error path (filesystem failure, missing credentials → 412) · boundary (very long name, no artifacts in workspace).

## How to Use

Reference-only. The persona and workflow live in the **tester** agent; the definition of done lives in the `testing-required` rule. Use this file to bootstrap the runner and copy the structure for units, API integration, and E2E, then run `npm run test` before declaring a feature done.
