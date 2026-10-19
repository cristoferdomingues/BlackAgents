import { loadProjectScope } from "./projects"
import { projectIdSchema } from "./schemas"

/**
 * `?scope=<project-id>` handling for the artifact API routes.
 * Scope is always an explicit request parameter — never guessed server-side —
 * and it fails closed: an id that does not load as a project scope is rejected
 * before any scan or write happens.
 */

export type ScopeParamResult =
  | { ok: true; scope: string | undefined }
  | { ok: false; error: string; status: number }

/** Validate the raw `scope` query value (kebab id or absent). */
export function parseScopeParam(value: string | null): ScopeParamResult {
  if (value === null || value === "") return { ok: true, scope: undefined }
  const parsed = projectIdSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: `Invalid project id: ${value}`, status: 400 }
  }
  return { ok: true, scope: parsed.data }
}

/**
 * Read and validate `?scope=` from a request URL. A scope that fails to load
 * (missing/invalid manifest, id mismatch…) is a 404 — never a silent
 * fall-back to the workspace scope.
 */
export async function resolveScopeParam(
  root: string,
  url: string
): Promise<ScopeParamResult> {
  const parsed = parseScopeParam(new URL(url).searchParams.get("scope"))
  if (!parsed.ok || !parsed.scope) return parsed
  const loaded = await loadProjectScope(root, parsed.scope)
  if (!loaded.ok) {
    return {
      ok: false,
      error: `Project "${parsed.scope}" is not available: ${loaded.error}`,
      status: 404,
    }
  }
  return parsed
}
