import { NextResponse } from "next/server"

import type { ApiEnvelope } from "./api"

export function ok<T>(data: T, init?: number | ResponseInit): NextResponse {
  const responseInit =
    typeof init === "number" ? { status: init } : init ?? { status: 200 }
  return NextResponse.json<ApiEnvelope<T>>(
    { success: true, data },
    responseInit
  )
}

export function fail(error: string, status = 400): NextResponse {
  return NextResponse.json<ApiEnvelope<never>>(
    { success: false, error },
    { status }
  )
}

/** Wrap a route handler so thrown errors become a clean 500 envelope. */
export async function handle<T>(
  fn: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error"
    return fail(message, 500)
  }
}
