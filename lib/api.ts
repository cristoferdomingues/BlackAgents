/** Shared response envelope returned by every /api route. */
export interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

export class ApiError extends Error {}

/** Typed fetch wrapper for client components. Throws ApiError on failure. */
export async function apiFetch<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  let body: ApiEnvelope<T> | null = null
  try {
    body = (await res.json()) as ApiEnvelope<T>
  } catch {
    throw new ApiError(`Invalid response from ${input} (${res.status})`)
  }

  if (!res.ok || !body.success) {
    throw new ApiError(body?.error ?? `Request failed (${res.status})`)
  }

  return body.data as T
}
