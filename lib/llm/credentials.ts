import {
  getProviderSecret,
  setProviderVerification,
  type ProviderSecret,
} from "@/lib/secrets"

import { ProviderError, type LLMCredentials, type LLMProvider } from "./types"

export class CredentialStateError extends Error {
  readonly status = 412
}

/** Load credentials only when their latest live verification succeeded. */
export async function getVerifiedCredentials(
  provider: LLMProvider
): Promise<{ credentials: LLMCredentials; secret: ProviderSecret }> {
  const secret = await getProviderSecret(provider.id)
  if (!secret) {
    throw new CredentialStateError(
      provider.requiresBaseUrl
        ? `Configure a base URL for ${provider.label} first`
        : `No API key configured for ${provider.label}`
    )
  }
  if (provider.requiresBaseUrl && !secret.baseUrl) {
    throw new CredentialStateError(
      `Configure a base URL for ${provider.label} first`
    )
  }
  if (!provider.requiresBaseUrl && !secret.apiKey) {
    throw new CredentialStateError(`No API key configured for ${provider.label}`)
  }
  if (secret.verification?.status !== "valid") {
    throw new CredentialStateError(
      `Verify the stored credentials for ${provider.label} before using it`
    )
  }

  return {
    credentials: { apiKey: secret.apiKey, baseUrl: secret.baseUrl },
    secret,
  }
}

/**
 * Authentication failures revoke the verified state. Other upstream failures
 * do not imply that the credential itself is bad.
 */
export async function markInvalidOnAuthFailure(
  provider: LLMProvider,
  error: ProviderError,
  secret: ProviderSecret
): Promise<void> {
  if (error.status !== 401 && error.status !== 403) return
  await setProviderVerification(
    provider.id,
    { status: "invalid", checkedAt: new Date().toISOString() },
    secret
  )
}
