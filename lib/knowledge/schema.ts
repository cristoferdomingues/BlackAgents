import { z } from "zod"

/**
 * OKF v0.2 concept frontmatter (SPEC.md, pinned). A bundle that declares any
 * other `okf_version` is refused. v0.1 leftovers (`timestamp`, `# Citations`)
 * are accepted only as explicit fallbacks, each one reported as a warning.
 */

export const OKF_VERSION = "0.2"

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export class OkfVersionError extends Error {
  readonly declared: string

  constructor(declared: string) {
    super(`This bundle says OKF ${declared}. BlackAgents only reads OKF ${OKF_VERSION}.`)
    this.name = "OkfVersionError"
    this.declared = declared
  }
}

/** Refuse every declared version except 0.2. A missing version is allowed. */
export function assertOkfVersion(declared: string | undefined): void {
  if (declared !== undefined && declared !== OKF_VERSION) throw new OkfVersionError(declared)
}

/** Read `okf_version` from a bundle-root index. Numbers like 0.2 become "0.2". */
export function declaredVersion(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string") return value.trim()
  return String(value)
}

export interface OkfWindow {
  from: string
  to: string
}

export interface OkfSource {
  resource: string
  id?: string
  title?: string
  author?: string
  usage_count?: number
  last_modified?: string
  usage_window?: OkfWindow
}

export interface OkfActorEvent {
  by: string
  at: string
}

export interface OkfParameter {
  name: string
  type: string
  required?: boolean
}

export interface OkfConceptFrontmatter {
  type: string
  title?: string
  description?: string
  resource?: string
  tags?: string[]
  sources?: OkfSource[]
  usage_window?: OkfWindow
  generated?: { by: string; at?: string }
  verified?: OkfActorEvent[]
  status?: "draft" | "stable" | "deprecated"
  stale_after?: string
  runtime?: string
  parameters?: OkfParameter[]
  computation?: string
  executor?: { resource: string; receipt?: string[] }
  attester?: { resource: string }
  /** Producer keys this schema does not own. Kept for a later round trip. */
  extra: Record<string, unknown>
}

export interface OkfWarning {
  code: "v0.1-timestamp" | "v0.1-citations"
  message: string
}

export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed"

const KNOWN_KEYS = new Set([
  "type",
  "title",
  "description",
  "resource",
  "tags",
  "sources",
  "usage_window",
  "generated",
  "verified",
  "status",
  "stale_after",
  "runtime",
  "parameters",
  "computation",
  "executor",
  "attester",
  "timestamp",
])

function asIso(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().replace(/\.\d{3}Z$/, "Z")
  }
  if (typeof value === "string" && ISO_DATE_TIME.test(value.trim())) return value.trim()
  return undefined
}

const isoDateTime = z.preprocess(
  (value) => asIso(value) ?? value,
  z.string().refine((value) => asIso(value) !== undefined, "must be an ISO 8601 datetime")
)

const windowSchema = z.object({ from: isoDateTime, to: isoDateTime })

const sourceSchema = z.object({
  resource: z.string().trim().min(1, "source resource is required"),
  id: z.string().trim().min(1).optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  usage_count: z.number().nonnegative().optional(),
  last_modified: isoDateTime.optional(),
  usage_window: windowSchema.optional(),
})

const parameterSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  required: z.boolean().optional(),
})

const frontmatterSchema = z
  .object({
    type: z.string().trim().min(1, "type is required"),
    title: z.string().optional(),
    description: z.string().optional(),
    resource: z.string().optional(),
    tags: z.array(z.string()).optional(),
    sources: z.array(sourceSchema).optional(),
    usage_window: windowSchema.optional(),
    generated: z
      .object({
        by: z.string().trim().min(1, "generated.by is required"),
        at: isoDateTime.optional(),
      })
      .optional(),
    verified: z
      .preprocess(
        (value) => (value && typeof value === "object" && !Array.isArray(value) ? [value] : value),
        z.array(z.object({ by: z.string().trim().min(1), at: isoDateTime })).optional()
      ),
    status: z.enum(["draft", "stable", "deprecated"]).optional(),
    stale_after: isoDateTime.optional(),
    runtime: z.string().trim().min(1).optional(),
    parameters: z.array(parameterSchema).optional(),
    computation: z.string().optional(),
    executor: z
      .object({
        resource: z.string().trim().min(1),
        receipt: z.array(z.string()).optional(),
      })
      .optional(),
    attester: z.object({ resource: z.string().trim().min(1) }).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.type === "Attested Computation" && !value.runtime) {
      ctx.addIssue({ code: "custom", path: ["runtime"], message: "runtime is required for Attested Computation" })
    }
  })

interface Citation {
  resource: string
  title?: string
}

/** v0.1 `# Citations` bullets. Stop at the next heading. */
function legacyCitations(body: string): Citation[] {
  const match = body.match(/^# Citations[ \t]*$/m)
  if (!match || match.index === undefined) return []
  const out: Citation[] = []
  for (const line of body.slice(match.index + match[0].length).split(/\r?\n/)) {
    if (/^#{1,6} /.test(line)) break
    const linked = line.match(/^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)/)
    if (linked) {
      out.push({ title: linked[1], resource: linked[2].trim() })
      continue
    }
    const bare = line.match(/^\s*[-*]\s+(\S+)/)
    if (bare) out.push({ resource: bare[1] })
  }
  return out
}

function extraKeys(data: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value
  }
  return extra
}

export interface NormalizedFrontmatter {
  frontmatter: OkfConceptFrontmatter
  warnings: OkfWarning[]
}

/**
 * Validate one concept's frontmatter. v0.1 `timestamp` and `# Citations` are
 * copied into the v0.2 fields and reported; they never pass through silently.
 */
export function normalizeFrontmatter(data: Record<string, unknown>, body: string): NormalizedFrontmatter | { error: string } {
  const warnings: OkfWarning[] = []
  const draft: Record<string, unknown> = { ...data }

  if (draft.generated === undefined && draft.timestamp !== undefined) {
    const at = asIso(draft.timestamp)
    if (!at) return { error: 'v0.1 "timestamp" is not an ISO 8601 datetime' }
    draft.generated = { by: "process:okf-v0.1", at }
    delete draft.timestamp
    warnings.push({
      code: "v0.1-timestamp",
      message: 'v0.1 field "timestamp" was read as generated.at. OKF 0.2 uses generated.at.',
    })
  } else if (draft.timestamp !== undefined) {
    delete draft.timestamp
    warnings.push({
      code: "v0.1-timestamp",
      message: 'v0.1 field "timestamp" was ignored because generated is already set.',
    })
  }

  const parsed = frontmatterSchema.safeParse(draft)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path.join(".")
    const message = issue?.message ?? "Invalid frontmatter"
    if (message === "Required") return { error: `${field ?? "field"} is required` }
    const named = !field || message.startsWith(field) ? message : `${field}: ${message}`
    return { error: named }
  }

  const value = parsed.data
  const frontmatter: OkfConceptFrontmatter = {
    type: value.type,
    title: value.title,
    description: value.description,
    resource: value.resource,
    tags: value.tags,
    sources: value.sources,
    usage_window: value.usage_window,
    generated: value.generated,
    verified: value.verified,
    status: value.status,
    stale_after: value.stale_after,
    runtime: value.runtime,
    parameters: value.parameters,
    computation: value.computation,
    executor: value.executor,
    attester: value.attester,
    extra: extraKeys(draft),
  }
  if (!frontmatter.sources?.length) {
    const citations = legacyCitations(body)
    if (citations.length > 0) {
      frontmatter.sources = citations
      warnings.push({
        code: "v0.1-citations",
        message: 'v0.1 "# Citations" list was read as sources. OKF 0.2 keeps sources in frontmatter.',
      })
    }
  }
  if (frontmatter.sources?.length === 0) delete frontmatter.sources
  return { frontmatter, warnings }
}

/** No verified key → unverified. A `human:` actor → human-reviewed. */
export function trustTier(verified: OkfActorEvent[] | undefined): TrustTier {
  if (!verified || verified.length === 0) return "unverified"
  return verified.some((event) => event.by.startsWith("human:")) ? "human-reviewed" : "machine-confirmed"
}

/** Stale when `now` is at or after `stale_after`. No date means not stale. */
export function isStale(staleAfter: string | undefined, now: Date): boolean {
  if (!staleAfter) return false
  return now.getTime() >= new Date(staleAfter).getTime()
}
