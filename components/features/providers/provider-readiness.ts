"use client"

import * as React from "react"

import { apiFetch } from "@/lib/api"

export type VerificationStatus = "valid" | "invalid" | "unverified"

export interface ProviderDescriptor {
  id: string
  label: string
  models: string[]
  requiresBaseUrl: boolean
}

export interface ProviderStatus {
  id: string
  configured: boolean
  verificationStatus: VerificationStatus
  checkedAt?: string
  last4?: string
  baseUrl?: string
}

export interface ProvidersState {
  providers: ProviderDescriptor[]
  status: ProviderStatus[]
  defaults: { provider?: string; model?: string }
}

export function isProviderVerified(
  state: ProvidersState | null,
  providerId: string
): boolean {
  return (
    state?.status.find((status) => status.id === providerId)
      ?.verificationStatus === "valid"
  )
}

export function useProviderReadiness(enabled = true): {
  providers: ProvidersState | null
  loading: boolean
  error: string | null
  hasVerifiedProvider: boolean
  reload: () => Promise<void>
} {
  const [providers, setProviders] = React.useState<ProvidersState | null>(null)
  const [loading, setLoading] = React.useState(enabled)
  const [error, setError] = React.useState<string | null>(null)

  const reload = React.useCallback(async (): Promise<void> => {
    if (!enabled) return
    await Promise.resolve()
    setLoading(true)
    setError(null)
    try {
      setProviders(await apiFetch<ProvidersState>("/api/providers"))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load providers")
    } finally {
      setLoading(false)
    }
  }, [enabled])

  React.useEffect(() => {
    queueMicrotask(() => void reload())
  }, [reload])

  const hasVerifiedProvider = Boolean(
    providers?.status.some(
      (status) => status.verificationStatus === "valid"
    )
  )

  return { providers, loading, error, hasVerifiedProvider, reload }
}
