import { z } from "zod"

import { nameSchema } from "@/lib/artifacts/schemas"

import { DEFAULT_BROWSER_PROFILE } from "../constants"

/** One replayable browser action (usually a Playwright MCP tool call). */
export const browserFlowStepSchema = z.object({
  id: z.string().trim().min(1).max(80),
  /** Playwright MCP tool name, e.g. browser_navigate, browser_click. */
  tool: z.string().trim().min(1).max(100),
  args: z.record(z.unknown()).default({}),
  /** Optional human note shown in the skill / UI. */
  note: z.string().trim().max(500).optional(),
})
export type BrowserFlowStep = z.infer<typeof browserFlowStepSchema>

export const browserFlowSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).default(""),
  version: z.literal(1).default(1),
  profile: z.string().trim().min(1).max(64).default(DEFAULT_BROWSER_PROFILE),
  /** Optional first URL (also stored as a navigate step when recorded). */
  startUrl: z.string().url().optional(),
  steps: z.array(browserFlowStepSchema).max(200).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type BrowserFlow = z.infer<typeof browserFlowSchema>

export const browserFlowInputSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).optional(),
  profile: z.string().trim().min(1).max(64).optional(),
  startUrl: z.string().url().optional(),
  steps: z.array(browserFlowStepSchema).max(200),
})
export type BrowserFlowInput = z.infer<typeof browserFlowInputSchema>
