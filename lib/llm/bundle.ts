import { z } from "zod"

import { extractReferences } from "../artifacts/graph"
import type { Artifact, ArtifactType } from "../artifacts/types"
import { checkArtifactStandards, hasErrors, type StandardsIssue } from "../standards/checks"

/**
 * The "bundle" draft protocol: one fenced ```bundle block with an agent plus
 * the skills and rules it needs. Isomorphic. Nothing is written until the user
 * reviews the bundle and saves each item through /api/artifacts.
 */

export const BUNDLE_FENCE = "bundle"
export const MAX_BUNDLE_SKILLS = 3
export const MAX_BUNDLE_RULES = 3

const kebab = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "name must be kebab-case")

const itemBase = {
  name: kebab,
  description: z.string().trim().min(1),
  body: z.string().min(1),
}

export const bundleSchema = z.object({
  summary: z.string().optional(),
  agent: z
    .object({
      ...itemBase,
      parallel: z.boolean().optional(),
      tools: z.array(z.string()).optional(),
      mcpServers: z.array(z.string()).optional(),
    })
    .optional(),
  skills: z.array(z.object(itemBase)).max(MAX_BUNDLE_SKILLS).default([]),
  rules: z
    .array(
      z.object({
        ...itemBase,
        alwaysApply: z.boolean().optional(),
        globs: z.array(z.string()).optional(),
      })
    )
    .max(MAX_BUNDLE_RULES)
    .default([]),
})
export type ArtifactBundle = z.infer<typeof bundleSchema>

export interface BundleItem {
  type: Extract<ArtifactType, "agent" | "skill" | "rule">
  name: string
  description: string
  body: string
  extra: {
    parallel?: boolean
    alwaysApply?: boolean
    globs?: string[]
    tools?: string[]
    mcpServers?: string[]
  }
}

export interface NormalizedBundle {
  summary: string
  items: BundleItem[]
}

export function normalizeBundle(bundle: ArtifactBundle): NormalizedBundle {
  const items: BundleItem[] = []
  for (const skill of bundle.skills) {
    items.push({ type: "skill", name: skill.name, description: skill.description, body: skill.body, extra: {} })
  }
  for (const rule of bundle.rules) {
    items.push({
      type: "rule",
      name: rule.name,
      description: rule.description,
      body: rule.body,
      extra: { alwaysApply: rule.alwaysApply, globs: rule.globs },
    })
  }
  if (bundle.agent) {
    const a = bundle.agent
    items.push({
      type: "agent",
      name: a.name,
      description: a.description,
      body: a.body,
      extra: { parallel: a.parallel, tools: a.tools, mcpServers: a.mcpServers },
    })
  }
  return { summary: bundle.summary ?? "", items }
}

function fenceRe(flags: string, capture: boolean): RegExp {
  const inner = capture ? "([\\s\\S]*?)" : "[\\s\\S]*?"
  return new RegExp("```" + BUNDLE_FENCE + "\\s*\\n" + inner + "\\n```", flags)
}

/** First valid bundle in a reply, or null (missing block or failed parse). */
export function extractBundle(text: string): NormalizedBundle | null {
  const match = text.match(fenceRe("i", true))
  if (!match) return null
  try {
    const parsed = bundleSchema.safeParse(JSON.parse(match[1]) as unknown)
    if (!parsed.success) return null
    const normalized = normalizeBundle(parsed.data)
    return normalized.items.length > 0 ? normalized : null
  } catch {
    return null
  }
}

export function stripBundleBlock(text: string): string {
  return text.replace(fenceRe("gi", false), "").trim()
}

export interface BundleItemReport {
  type: BundleItem["type"]
  name: string
  issues: StandardsIssue[]
}

export interface BundleReport {
  ok: boolean
  items: BundleItemReport[]
}

/** Build a user turn that asks the assistant to repair its current bundle. */
export function buildBundleFixRequest(
  bundle: NormalizedBundle,
  report: BundleReport
): string {
  const findings = report.items.flatMap((item) =>
    item.issues.map(
      (issue) => `- ${item.type}/${item.name} — ${issue.severity}: ${issue.message}`
    )
  )
  const payload: ArtifactBundle = {
    summary: bundle.summary || undefined,
    agent: bundle.items
      .filter((item) => item.type === "agent")
      .map((item) => ({
        name: item.name,
        description: item.description,
        body: item.body,
        parallel: item.extra.parallel,
        tools: item.extra.tools,
        mcpServers: item.extra.mcpServers,
      }))[0],
    skills: bundle.items
      .filter((item) => item.type === "skill")
      .map((item) => ({
        name: item.name,
        description: item.description,
        body: item.body,
      })),
    rules: bundle.items
      .filter((item) => item.type === "rule")
      .map((item) => ({
        name: item.name,
        description: item.description,
        body: item.body,
        alwaysApply: item.extra.alwaysApply,
        globs: item.extra.globs,
      })),
  }

  return `Fix every validation issue in this artifact bundle.

Validation issues:
${findings.join("\n")}

Current bundle:

\`\`\`${BUNDLE_FENCE}
${JSON.stringify(payload, null, 2)}
\`\`\`

Return the complete corrected bundle in exactly one \`\`\`${BUNDLE_FENCE}\` JSON block. Keep valid content unchanged. Do not only explain the fixes.`
}

function asArtifact(item: BundleItem): Artifact {
  return {
    type: item.type,
    name: item.name,
    platform: "cursor",
    description: item.description,
    frontmatter: {},
    body: item.body,
    relativePath: "",
  }
}

/**
 * Standards checks per item, name clashes (inside the bundle and with the
 * workspace), and links: the agent must reference every skill and rule in
 * the bundle, using the same graph conventions as the rest of the app.
 */
export function validateBundle(bundle: NormalizedBundle, existing: Artifact[]): BundleReport {
  const reports: BundleItemReport[] = bundle.items.map((item) => ({
    type: item.type,
    name: item.name,
    issues: checkArtifactStandards(item),
  }))
  const seen = new Set<string>()
  bundle.items.forEach((item, index) => {
    const key = `${item.type}:${item.name}`
    if (seen.has(key)) {
      reports[index].issues.push({ severity: "error", message: "Duplicate name inside the bundle" })
    }
    seen.add(key)
    if (existing.some((a) => a.type === item.type && a.name === item.name)) {
      reports[index].issues.push({
        severity: "error",
        message: `A ${item.type} named "${item.name}" already exists`,
      })
    }
  })

  const agentIndex = bundle.items.findIndex((i) => i.type === "agent")
  if (agentIndex >= 0) {
    const agent = bundle.items[agentIndex]
    const graph = [...existing, ...bundle.items.map(asArtifact)]
    const refs = extractReferences(graph).filter(
      (r) => r.from === "agent" && r.fromName === agent.name
    )
    for (const item of bundle.items) {
      if (item.type === "agent") continue
      const linked = refs.some((r) => r.to === item.type && r.toName === item.name)
      if (!linked) {
        reports[agentIndex].issues.push({
          severity: "error",
          message: `Agent body must reference \`${item.name}\` ${item.type}`,
        })
      }
    }
  }
  return { ok: !reports.some((r) => hasErrors(r.issues)), items: reports }
}
