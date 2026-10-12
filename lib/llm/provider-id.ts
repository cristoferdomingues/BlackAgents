import { z } from "zod"

import type { ProviderId } from "./types"

/**
 * Provider id check with no dependency on model routing. Settings imports this
 * so the browser bundle can use model-ref without pulling in node:fs.
 */
export const providerIdSchema = z.enum(["openai", "anthropic", "custom"], {
  errorMap: (issue, ctx) => {
    if (issue.code === "invalid_enum_value") {
      return { message: `Unknown provider "${String(ctx.data)}"` }
    }
    return { message: ctx.defaultError }
  },
})

export function isProviderId(value: string): value is ProviderId {
  return providerIdSchema.safeParse(value).success
}
