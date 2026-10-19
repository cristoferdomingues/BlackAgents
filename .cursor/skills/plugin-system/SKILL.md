---
name: plugin-system
description: >-
  Reference for BlackAgents plugins — bundle layout, the plugin.json manifest
  spec, the install ledger, the install/upgrade/uninstall lifecycle,
  contribution kinds (artifacts, knowledge, workflows, MCP, providers), the code
  seams to touch, the trust model, and phased delivery. Read when designing,
  building, or debugging plugin packaging, or when authoring a plugin bundle.
---

## When to Apply

Read this when you are building or changing anything related to BlackAgents plugins: the `lib/plugins` domain, `/api/plugins` routes, the `/plugins` page, the manifest validator, or the install/uninstall lifecycle. Also read it when authoring a plugin bundle, or when deciding whether a new capability belongs in a plugin, a workspace artifact, or an MCP server.

A **plugin** is a versioned bundle of capabilities that installs into and removes from BlackAgents as one unit. Plugins may contain artifacts (agents, commands, rules, skills), knowledge concepts, workflow templates, MCP servers, and model providers. Plugins may **not** ship executable code — Tier 3 (custom runtime extensions, UI panels, JS/TS entry points) is out of scope.

---

## Bundle layout

A plugin is a folder (distributed as a `.zip`) with this shape:

```
my-plugin/
  plugin.json              # manifest (required, at the bundle root)
  agents/                  # optional: agent .md files
  commands/                # optional: command .md files
  rules/                   # optional: rule .md files
  skills/<name>/SKILL.md   # optional: skill folders
  knowledge/               # optional: OKF concept .md files
  workflows/               # optional: *.workflow.json templates
  mcp.json                 # optional: MCP servers the bundle needs
  providers.json           # optional: model provider definitions
  README.md                # optional: shown on the plugin detail page
```

Rules:

- `plugin.json` must be at the archive root (a single wrapping top-level folder is allowed and stripped).
- Every file a plugin installs must be listed in the manifest — the installer never globs, so there are no surprise capabilities.
- Artifact bodies follow the normal authoring standards and are validated with the existing parsers before install.
- Skill folders must contain `SKILL.md` at their root.

Plugins are installed into `~/.black-agents/plugins/` (global, via `configDir()`) or `<workspace>/.black-agents/plugins/` (project-local). Both locations are outside the app bundle, so plugins survive Electron updates and are trivial to test.

---

## Manifest: `plugin.json`

Validated with zod. Unknown keys are rejected — forward compatibility comes from `manifestVersion`, not leniency.

```json
{
  "manifestVersion": 1,
  "name": "seo-auditor",
  "namespace": "blackagents-labs",
  "version": "1.2.0",
  "description": "Audit pages for SEO issues and draft fixes.",
  "author": "BlackAgents Labs",
  "license": "MIT",
  "minAppVersion": "0.9.0",
  "artifacts": {
    "agents": ["agents/seo-auditor.md"],
    "commands": ["commands/audit-page.md"],
    "rules": ["rules/seo-guardrails.md"],
    "skills": ["skills/seo-checklist"]
  },
  "knowledge": ["knowledge/*.md"],
  "workflows": ["workflows/review.workflow.json"],
  "mcpServers": ["mcp.json"],
  "modelProviders": ["providers.json"]
}
```

Field notes:

- **`namespace` + `name`** form the plugin id (`blackagents-labs/seo-auditor`). Namespaced artifact names prevent collisions; on conflict the installer refuses and reports both claimants.
- **`version`** is semver; install records it in the ledger and upgrade compares it.
- **`minAppVersion`** gates install: refuse bundles that require a newer app.
- **`artifacts`** is an explicit allow-list of paths relative to the bundle root. There is deliberately no `trust` field — trust is granted by the user at install time, never shipped in a bundle.
- **`mcpServers` / `modelProviders`** reference files inside the bundle. If present, install triggers the same trust and approval gates as adding them manually.

### `mcp.json` (bundle-declared servers)

Same shape as entries in `.black-agents/mcp.json`. Secrets are **never** shipped in a bundle: entries may only use `${secret:NAME}` references, and install prompts the user to fill in any unset secret the plugin requires (stored under plugin-namespaced keys in the secret store).

### `providers.json` (bundle-declared providers)

Array of provider definitions compatible with the existing `lib/llm` registry (OpenAI-compatible and Anthropic-compatible endpoints). API keys are secrets, never bundle contents — same `${secret:NAME}` rule.

---

## Install ledger

Every install writes to `.black-agents/plugins/installed.json` (or the workspace equivalent for project-local plugins):

```json
{
  "plugins": [{
    "id": "blackagents-labs/seo-auditor",
    "version": "1.2.0",
    "installedAt": "2026-10-16T12:00:00Z",
    "artifacts": [
      { "type": "agent", "path": ".black-agents/artifacts/agents/seo-auditor.md", "hash": "sha256:..." },
      { "type": "skill", "path": ".black-agents/artifacts/skills/seo-checklist", "hash": "sha256:..." }
    ],
    "mcpServers": ["seo-mcp"],
    "modelProviders": ["seo-provider"]
  }]
}
```

The ledger is the source of truth for **ownership** and **tamper detection**:

- On uninstall, re-hash each recorded artifact. Unmodified files are removed; a hash mismatch means the user edited it — keep the file, report it as a conflict, and drop it from the ledger entry.
- Removing a skill removes the whole folder; files inside it are not tracked individually.
- The ledger stores only paths and hashes, never bundle contents, so it is safe to commit.

---

## Lifecycle

### Install

1. Receive a `.zip` (upload) and extract it into a temp folder inside the workspace (see the `workspace-filesystem-safety` concept). Never write outside the workspace.
2. Validate `plugin.json` (zod, `manifestVersion: 1`) and confirm every referenced file exists.
3. Validate each artifact with its type parser; validate `mcp.json` / `providers.json` against their schemas.
4. Check `minAppVersion`. Compare id and version against the ledger: same id + same version = no-op; same id + higher version = upgrade path; same id + lower version = refuse.
5. Run the namespace-collision check against existing artifacts (including those of other plugins).
6. Trust gate: for each MCP server, show what it does and require explicit approval (reuse the MCP trust mechanism); do the same for each provider; prompt for any `${secret:NAME}` values the bundle needs.
7. Copy artifacts, merge MCP/provider registrations, and write the ledger.

### Upgrade

Re-run install with the new bundle for the same id. Unchanged artifacts are overwritten; artifacts the user edited are preserved and recorded as conflicts; artifacts removed in the new version are deleted only if unmodified. The ledger version is bumped on success.

### Uninstall (plug out)

1. Load the ledger entry. For each artifact: hash-check, delete if unmodified, keep and report if modified.
2. Remove registered MCP servers and providers **only** if no other installed plugin references them.
3. Drop the ledger entry. Secrets stay in the secret store (they may be shared or reused).

All three operations are idempotent: re-running an uninstall with no ledger entry is a no-op success.

### Disable

A lighter state than uninstall: drop the plugin's contributions from the live registries but keep the files and the ledger entry. On app update, re-validate every plugin and disable incompatible ones with a clear reason instead of failing the boot.

---

## Resolution and precedence

When contributions are merged into the live registries:

- Precedence is **workspace > plugin > builtin** — a user's own artifact always wins, and `lib/artifacts/builtin.ts` stays the lowest tier.
- A collision between two plugins with the same namespaced artifact name is refused at install, not resolved at runtime.
- Never let a plugin shadow a workspace artifact silently; surface the collision in `/plugins`.
- Plugin artifacts are **not** exported to `.cursor/` / `.claude/` by default and must not appear in `/sync` drift — they are not the user's files.

---

## Code seams to touch

| Contribution | Existing seam | Change |
|---|---|---|
| Artifacts | `lib/artifacts/parser.ts` (`scanSource`, `scanWorkspace`), `lib/artifacts/source.ts` | add `scanPlugins()`; merge into `scanWorkspace`; `Artifact` gains `plugin?: string` |
| Knowledge | `lib/knowledge/store.ts` (`listConcepts`) | merge plugin concepts, read-only |
| Workflows | `lib/workflows/store.ts` (`listWorkflows`) | expose plugin templates as starting points, not saved runs |
| MCP servers | `lib/mcp/config.ts`, `lib/mcp/policy.ts` | merge plugin `mcp.json`; default trust `ask`; secrets stay in the secret store |
| Providers | `lib/llm/registry.ts` | `ProviderId` is a union type and the registry a static record — both must become runtime-extensible |
| Tools (later phase) | `lib/runtime/tool-names.ts`, `lib/runtime/tools/index.ts` | `BUILTIN_TOOL_NAMES` is a compile-time tuple feeding a zod enum — keep it for builtins and add a runtime list of enabled plugin tools; `ToolSource` gains \"plugin\" |
| API | `app/api/` | `plugins`, `plugins/:id`, `plugins/validate` — envelope per the `api-response-format` rule |
| UI | `app/plugins/` | list, enable toggle, trust selector, contribution preview, validation errors |

Plugin tools (when built) are namespaced `<plugin>__<tool>`, the same trick `mcpToolName` uses for MCP servers.

---

## Trust and approvals

Plugin contributions are **untrusted input**, exactly like model output:

- A bundle never auto-grants trust; every MCP server and provider passes the same approval gates as a manual addition.
- A plugin tool declares a `risk`; `exec` always asks. Trust levels map as in `lib/mcp/policy.ts`: `trusted → read`, `ask → write`, `risky → exec`.
- `allowWrites` must **not** auto-approve a plugin `write` tool unless that plugin is `trusted`. This is a deliberate change in `lib/runtime/approval-policy.ts`.
- A plugin rule is never `alwaysApply` on install; the user opts in.
- Plugin artifact bodies are prompt content, not instructions to the runtime.

---

## API surface

All routes follow the standard response envelope (`api-response-format` rule) and zod-validate their input.

| Route | Method | Purpose |
|---|---|---|
| `/api/plugins` | GET | List installed plugins from the ledger (id, version, artifact counts, conflicts) |
| `/api/plugins` | POST | Install from an uploaded `.zip`; body carries approvals and secrets |
| `/api/plugins/validate` | POST | Dry-run validation of a bundle without installing |
| `/api/plugins/:id` | GET | Detail: manifest, README, per-artifact status (unmodified/modified) |
| `/api/plugins/:id` | PATCH | Upgrade with a new bundle |
| `/api/plugins/:id` | DELETE | Uninstall; returns a report of removed vs. kept files |

Errors must distinguish: invalid manifest, version conflict, namespace collision, missing secret, unapproved MCP server, minAppVersion mismatch.

---

## UI surface

A `/plugins` page with:

- **Installed list**: id, version, artifact counts, and edited-artifact conflicts called out prominently.
- **Install**: drop a `.zip` → preview screen showing exactly what will be installed (artifacts, MCP servers with their trust prompts, providers, required secrets) → confirm.
- **Detail**: README, contents, per-artifact modified badges, a disable toggle, an upgrade button, and an uninstall button that surfaces the conflict report.

Use the `design-system` skill for components and states. Uninstalling a plugin with edited artifacts requires an explicit choice per file (delete anyway / keep).

---

## Phased delivery

1. **Declarative core** — manifest, discovery, validation, install ledger, artifacts + knowledge + workflows, enable/disable/uninstall, `/plugins` UI. No new execution surface.
2. **MCP + provider contributions** — plugin `mcp.json` / `providers.json`, trust prompts, `${secret:NAME}` refs, runtime-extensible provider registry.
3. **Tool contributions** (future) — declarative tool definitions that map onto existing builtins or MCP calls.
4. **Code plugins** (out of scope) — providers and custom tools from `index.mjs` behind an explicit permission prompt.

---

## Guardrails and non-goals

- Plugins are data, not code. A bundle that ships executable JS/TS is refused at validation.
- The only network fetch during install is the bundle download itself; a manifest may not reference remote files.
- All filesystem access stays inside the workspace (see the `workspace-filesystem-safety` concept).
- Treat a bundle like LLM-adjacent input: validate everything, reject unknown keys, never eval.
- Do not cache the plugin registry across requests — plugin counts are small, and a stale registry is worse than a few extra `stat` calls.

---

## How to Use

- **Building the feature**: read the `nextjs-app-patterns` skill for the layered architecture (`lib/plugins` domain → `/api/plugins` routes → `/plugins` page), the `api-response-format` rule for envelopes, the `typescript-strict` rule for the zod schemas, and the `testing-patterns` skill for unit-testing the validator and lifecycle against a mocked filesystem. The `testing-required` rule applies.
- **Authoring a bundle**: follow the layout and manifest spec above; every artifact inside must satisfy the authoring standards.
- **Deciding scope**: if a capability needs code execution, it does not belong in a plugin — see the out-of-scope notes.
- **Related concepts**: `artifacts/authoring-standards`, `architecture/mcp-servers`, `architecture/llm-integration`, `architecture/workspace-filesystem-safety`.
