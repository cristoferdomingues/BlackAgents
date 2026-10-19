import { z } from "zod"

export const AUDIT_PAGE_SIZE_DEFAULT = 50
export const AUDIT_PAGE_SIZE_MAX = 100

export const auditPageQuerySchema = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(AUDIT_PAGE_SIZE_MAX)
    .default(AUDIT_PAGE_SIZE_DEFAULT),
})

export interface AuditPage<T> {
  events: T[]
  total: number
  offset: number
  limit: number
}

/** Slice a filtered audit list. Offset past the end returns an empty page. */
export function pageAuditEvents<T>(
  events: readonly T[],
  offset: number,
  limit: number
): AuditPage<T> {
  return {
    events: events.slice(offset, offset + limit),
    total: events.length,
    offset,
    limit,
  }
}
