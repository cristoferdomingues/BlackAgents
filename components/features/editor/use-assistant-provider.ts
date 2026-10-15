"use client"

import * as React from "react"

import { apiFetch } from "@/lib/api"
import type { ProvidersState } from "@/components/features/providers/provider-readiness"

const LAST_PROVIDER_KEY = "black-agents:last-provider"
const lastModelKey = (provider: string): string => `black-agents:last-model:${provider}`

export interface ResolvedProviderModel {
  provider: string
  model: string
  label: string
}

export interface AssistantProvider {
  loaded: boolean
  hasProvider: boolean
  /** The provider + model the assistant actions use, or null when none is verified. */
  resolve: () => ResolvedProviderModel | null
}

/** Picks the verified provider and model for the editor's assistant actions. */
export function useAssistantProvider(): AssistantProvider {
  const [providers, setProviders] = React.useState<ProvidersState | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    let active = true
    apiFetch<ProvidersState>("/api/providers")
      .then((data) => active && setProviders(data))
      .catch(() => {
        // Providers are optional; the assistant actions just stay disabled.
      })
      .finally(() => active && setLoaded(true))
    return () => {
      active = false
    }
  }, [])

  const usable = React.useMemo(
    () => providers?.status.filter((s) => s.verificationStatus === "valid").map((s) => s.id) ?? [],
    [providers]
  )

  const resolve = React.useCallback((): ResolvedProviderModel | null => {
    if (!providers || usable.length === 0) return null
    const last = window.localStorage.getItem(LAST_PROVIDER_KEY)
    // Prefer durable secrets defaults — Electron uses a fresh loopback origin
    // each launch, so localStorage alone does not survive restarts.
    const provider =
      (providers.defaults.provider && usable.includes(providers.defaults.provider)
        ? providers.defaults.provider
        : null) ??
      (last && usable.includes(last) ? last : null) ??
      usable[0]
    const descriptor = providers.providers.find((p) => p.id === provider)
    const lastModel = window.localStorage.getItem(lastModelKey(provider))
    const defaultModel = providers.defaults.provider === provider ? providers.defaults.model : undefined
    return {
      provider,
      model: defaultModel || lastModel || descriptor?.models[0] || "",
      label: descriptor?.label ?? provider,
    }
  }, [providers, usable])

  return { loaded, hasProvider: usable.length > 0, resolve }
}
