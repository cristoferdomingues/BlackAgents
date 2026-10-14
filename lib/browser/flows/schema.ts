import { z } from "zod"

import { nameSchema } from "@/lib/artifacts/schemas"

import { DEFAULT_BROWSER_PROFILE } from "../constants"

/** How a step is interpreted during replay. */
export const browserFlowStepKindSchema = z.enum(["action", "assert", "extract"])
export type BrowserFlowStepKind = z.infer<typeof browserFlowStepKindSchema>

/** Post-condition checked after a snapshot (assert / extract). */
export const browserFlowExpectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text_includes"),
    value: z.string().trim().min(1).max(500),
  }),
])
export type BrowserFlowExpect = z.infer<typeof browserFlowExpectSchema>

/** One replayable browser action (usually a Playwright MCP tool call). */
export const browserFlowStepSchema = z.object({
  id: z.string().trim().min(1).max(80),
  /** Playwright MCP tool name, e.g. browser_navigate, browser_click. */
  tool: z.string().trim().min(1).max(100),
  args: z.record(z.unknown()).default({}),
  /** Optional human note shown in the skill / UI. */
  note: z.string().trim().max(500).optional(),
  /** Natural-language goal used for self-heal and cache keys. */
  intent: z.string().trim().max(500).optional(),
  kind: browserFlowStepKindSchema.default("action"),
  /** Checked against a page snapshot for assert / extract steps. */
  expect: browserFlowExpectSchema.optional(),
  /** Pause before running the step (ms). */
  waitForMs: z.number().int().min(0).max(60_000).optional(),
  /** Pause after a successful action step (ms). */
  settleMs: z.number().int().min(0).max(10_000).optional(),
})
export type BrowserFlowStep = z.infer<typeof browserFlowStepSchema>

export const browserFlowSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).default(""),
  /** v1 = legacy action-only; v2 = intent / assert / settle fields. */
  version: z.union([z.literal(1), z.literal(2)]).default(2),
  profile: z.string().trim().min(1).max(64).default(DEFAULT_BROWSER_PROFILE),
  /** Optional first URL (also stored as a navigate step when recorded). */
  startUrl: z.string().url().optional(),
  steps: z.array(browserFlowStepSchema).max(200).default([]),
  /**
   * The flow was already tested. When true, its saved steps and
   * `browser_run_flow` run without an approval card.
   */
  autoAccept: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type BrowserFlow = z.infer<typeof browserFlowSchema>

export const browserFlowInputSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).optional(),
  profile: z.string().trim().min(1).max(64).optional(),
  startUrl: z.string().url().optional(),
  autoAccept: z.boolean().optional(),
  steps: z.array(browserFlowStepSchema).max(200),
})
/** Accepts omit of defaulted step fields (`kind`, etc.). */
export type BrowserFlowInput = z.input<typeof browserFlowInputSchema>
