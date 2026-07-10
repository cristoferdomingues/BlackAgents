---
name: llm-integration
description: Reference for BlackAgents' LLM layer — the provider contract, the registry, server-side credentials, the fenced-JSON draft/validation protocols, and the single-turn agentic loop the assistant endpoints run. Read when adding a provider, building an assistant-backed API route, or changing how model output is parsed.
---

# BlackAgents LLM Integration

## When to Apply

Read this when you touch `lib/llm/**`, `lib/secrets.ts`, or any assistant-backed route (`app/api/chat`, `app/api/artifacts/draft-body`, `app/api/artifacts/validate`). The hard guardrails live in the `llm-security` and `llm-output-safety` rules; this file explains the layer and the recipes. For the surrounding app layers, see the `nextjs-app-patterns` skill.

## The Layer

```
Client (provider/model picker, never a key)
      │ POST { type, name, description, body?, provider, model }
Assistant route (app/api/.../route.ts)
      │ validate → load secret → build system context → generate → parse
lib/llm/registry.ts   getProvider(id) / isProviderId / describeProviders
lib/llm/providers/*   openai · anthropic · custom (OpenAI-compatible)
lib/secrets.ts        ~/.black-agents/secrets.json (0600, server-only)
lib/llm/context.ts    buildSystemContext() — standards + workspace registry + protocol
lib/llm/{draft,validation}.ts   fenced-JSON protocols, parsed with zod
```

Rules of the road:
- Providers are **pure I/O adapters** behind the `LLMProvider` contract — no app knowledge, no disk access.
- Credentials are read **only** in route handlers via `getProviderSecret`; they never reach `lib/artifacts` or the client.
- Model output is **untrusted input**: it is only trusted after `extractDraft` / `extractValidation` validate it against a zod schema.

## Provider Contract (`lib/llm/types.ts`)

`LLMProvider` = `{ id, label, models[], requiresBaseUrl?, generate(request, credentials) }`.

- `LLMGenerateRequest` carries `model`, `messages`, optional `temperature`, and `systemContext` (the standards/registry blob, injected separately from user turns).
- Each provider maps `systemContext` to its own shape: OpenAI/custom prepend a `system` message (`toOpenAIMessages`); Anthropic sends it as the top-level `system` field and forwards only user/assistant turns.
- On any non-2xx upstream response, throw `ProviderError(message, status)` — never return a half-parsed result. Empty content is a `502`.

Adding a provider:
1. Implement `LLMProvider` in `lib/llm/providers/<id>.ts` (reuse `openAICompatibleGenerate` for OpenAI-shaped APIs).
2. Register it in `lib/llm/registry.ts` (`PROVIDERS`, `PROVIDER_LIST`) and extend the `ProviderId` union in `types.ts`.
3. `describeProviders()` exposes a **credential-free** descriptor to the client — never add keys to it.

## Credentials (`lib/secrets.ts`)

- Persisted to `~/.black-agents/secrets.json`, written mode `0600` (and re-`chmod`'d in case the file pre-existed).
- `getProviderSecret(id)` is server-only. The providers route returns only `ProviderStatus` (`configured` + `last4` + `baseUrl`) via `toStatusList` — the raw key never crosses the network back to the client.
- Missing credentials are a **412** (`fail("No API key configured for …", 412)`), not a 400/401 — the request was well-formed, the environment isn't ready.

## System Context (`lib/llm/context.ts`)

`buildSystemContext()` assembles: the persona line + the current authoring standards (`loadStandards()`) + a registry of the active workspace's artifacts (`type/name: description`) + the active protocol block (draft or validation). Keep drafting/validation instructions in the **user** turn (the route's `buildInstruction`) and standing rules in the **system** context.

## The Protocols (agentic contract)

The assistant is steered to answer with a single fenced JSON block; the route parses it. This is the whole "agentic loop" — deliberately **single-turn and bounded**, not an open-ended tool loop.

| Protocol | Fence | Schema | Extractor |
|----------|-------|--------|-----------|
| Draft a new artifact | ` ```artifact ` | `draftSchema` (`lib/llm/draft.ts`) | `extractDraft` → `NormalizedDraft \| null` |
| Review an artifact | ` ```validation ` | `validationResultSchema` (`lib/llm/validation.ts`) | `extractValidation` → `ValidationResult \| null` |

- Extractors return `null` on a missing block or failed `safeParse`. Callers decide the fallback: draft-body falls back to `stripDraftBlock(content)` then `fail(..., 502)` if empty; validate surfaces the raw prose as a single `info` finding rather than failing.
- `body` in a draft is **markdown only, no frontmatter** — the platform adds frontmatter on serialize/export.
- These modules are **isomorphic** (no node imports) so the client and the route parse identically.

## Route Recipe (assistant-backed endpoint)

```ts
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => null)) as XRequest | null
    if (!body) return fail("Invalid request body")

    // 1. Validate the artifact inputs with the shared zod schemas.
    const type = artifactTypeSchema.safeParse(body.type)
    if (!type.success) return fail("Unknown artifact type")
    // ...name (nameSchema), description, body as needed...

    // 2. Resolve + validate the provider and model.
    if (!body.provider || !isProviderId(body.provider)) return fail("Unknown provider")
    const provider = getProvider(body.provider)!
    const model = body.model?.trim() || provider.models[0]
    if (!model) return fail("A model is required for this provider")

    // 3. Load the server-side secret; 412 when the environment isn't ready.
    const secret = await getProviderSecret(provider.id)
    if (provider.requiresBaseUrl && !secret?.baseUrl) return fail("Configure a base URL first", 412)
    if (!provider.requiresBaseUrl && !secret?.apiKey) return fail("No API key configured", 412)

    // 4. Generate, mapping upstream failures to their status.
    let content: string
    try {
      const result = await provider.generate(
        { model, messages: [{ role: "user", content: buildInstruction(...) }], systemContext: await buildSystemContext() },
        { apiKey: secret?.apiKey ?? "", baseUrl: secret?.baseUrl }
      )
      content = result.content
    } catch (err) {
      if (err instanceof ProviderError) return fail(err.message, err.status)
      throw err
    }

    // 5. Parse the protocol block; never trust content directly.
    const parsed = extractDraft(content) // or extractValidation
    return ok(/* only validated, protocol-shaped data */)
  })
}
```

## Link Detection (draft-body)

After a draft is parsed, `detectLinks` runs the **same** `extractReferences` graph extractor over the real workspace plus a synthetic node for the drafted artifact, then keeps only edges originating from the draft. The assistant is told to reference **only artifacts that exist** in the injected registry; link detection is the ground-truth check, not the model's claim. This reuses the exact cross-reference conventions documented in the `nextjs-app-patterns` skill.

## Gotchas

- Don't send `systemContext` as a user message — providers place it differently; use the request field.
- Custom provider has an empty `models[]` and `requiresBaseUrl: true`; a route must fall back to `provider.models[0]` **and** guard the empty case (`fail("A model is required …")`).
- `describeProviders()` is the only provider info the client should ever see. Never widen it.
- Temperature defaults to `0.4` in the providers — keep authoring deterministic-ish; don't crank it per-call without reason.

## How to Use

Reference-only. The persona and workflow live in the **llm-integrator** agent; the guardrails live in the `llm-security` and `llm-output-safety` rules. Use this file to place LLM logic in the right module and copy the route recipe, then hand non-LLM app work to the **feature-developer** agent and coverage to the **tester** agent.

See also: nextjs-app-patterns skill.
