import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

import type { ProviderId } from "./llm/types"

/**
 * Local secrets persisted to ~/.black-agents/secrets.json.
 *
 * Server-only: imported exclusively by route handlers. API keys never cross the
 * network boundary back to the client — the providers route returns only a
 * redacted status (configured + last4). The file is written with 0600 perms.
 *
 * This lives in a separate file from config.ts so the workspace config can be
 * synced/inspected freely while the secrets file stays private.
 */

export interface ProviderSecret {
  apiKey: string
  /** Custom (OpenAI-compatible) provider only: the base URL of the endpoint. */
  baseUrl?: string
  /** Server-maintained result of the most recent live verification. */
  verification?: ProviderVerification
}

export type VerificationStatus = "valid" | "invalid" | "unverified"

export interface ProviderVerification {
  status: VerificationStatus
  /** ISO-8601 timestamp; absent for legacy/unverified credentials. */
  checkedAt?: string
}

export interface SecretsDefaults {
  provider?: ProviderId
  model?: string
}

export interface SecretsFile {
  providers: Partial<Record<ProviderId, ProviderSecret>>
  defaults?: SecretsDefaults
}

/** Redacted view safe to send to the client. */
export interface ProviderStatus {
  id: ProviderId
  configured: boolean
  /** Last 4 characters of the stored key, for recognition only. */
  last4?: string
  baseUrl?: string
  verificationStatus: VerificationStatus
  checkedAt?: string
}

const verificationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unverified"), checkedAt: z.string().datetime().optional() }),
  z.object({ status: z.literal("valid"), checkedAt: z.string().datetime() }),
  z.object({ status: z.literal("invalid"), checkedAt: z.string().datetime() }),
])

const providerSecretSchema = z.object({
  apiKey: z.string().default(""),
  baseUrl: z.string().optional(),
  verification: verificationSchema.optional(),
})

const secretsFileSchema = z.object({
  providers: z
    .object({
      openai: providerSecretSchema.optional(),
      anthropic: providerSecretSchema.optional(),
      custom: providerSecretSchema.optional(),
    })
    .default({}),
  defaults: z
    .object({
      provider: z.enum(["openai", "anthropic", "custom"]).optional(),
      model: z.string().optional(),
    })
    .optional(),
})

function expandHome(p: string): string {
  if (p === "~") return os.homedir()
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2))
  return p
}

function configDir(): string {
  const override = process.env.BLACK_AGENTS_CONFIG_DIR
  return override ? expandHome(override) : path.join(os.homedir(), ".black-agents")
}

function secretsFile(): string {
  return path.join(configDir(), "secrets.json")
}

export async function readSecrets(): Promise<SecretsFile> {
  try {
    const raw = await fs.readFile(secretsFile(), "utf8")
    const parsed = secretsFileSchema.safeParse(JSON.parse(raw) as unknown)
    if (!parsed.success) return { providers: {}, defaults: undefined }
    return parsed.data
  } catch {
    return { providers: {}, defaults: undefined }
  }
}

async function writeSecrets(secrets: SecretsFile): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true })
  await fs.writeFile(secretsFile(), JSON.stringify(secrets, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  })
  // mkdir/writeFile honor the umask; force-tighten in case the file pre-existed.
  await fs.chmod(secretsFile(), 0o600).catch(() => {})
}

export async function setProviderSecret(
  id: ProviderId,
  secret: ProviderSecret
): Promise<SecretsFile> {
  const secrets = await readSecrets()
  secrets.providers[id] = secret
  await writeSecrets(secrets)
  return secrets
}

function sameCredentials(
  current: ProviderSecret,
  expected: ProviderSecret
): boolean {
  return current.apiKey === expected.apiKey && current.baseUrl === expected.baseUrl
}

/**
 * Update only verification metadata. When expected credentials are supplied,
 * avoid invalidating a newer credential after an in-flight request completes.
 */
export async function setProviderVerification(
  id: ProviderId,
  verification: ProviderVerification,
  expected?: ProviderSecret
): Promise<SecretsFile> {
  const secrets = await readSecrets()
  const current = secrets.providers[id]
  if (!current || (expected && !sameCredentials(current, expected))) return secrets
  secrets.providers[id] = { ...current, verification }
  await writeSecrets(secrets)
  return secrets
}

export async function removeProviderSecret(id: ProviderId): Promise<SecretsFile> {
  const secrets = await readSecrets()
  delete secrets.providers[id]
  if (secrets.defaults?.provider === id) {
    secrets.defaults = { ...secrets.defaults, provider: undefined }
  }
  await writeSecrets(secrets)
  return secrets
}

export async function setDefaults(defaults: SecretsDefaults): Promise<SecretsFile> {
  const secrets = await readSecrets()
  secrets.defaults = { ...secrets.defaults, ...defaults }
  await writeSecrets(secrets)
  return secrets
}

export async function getProviderSecret(
  id: ProviderId
): Promise<ProviderSecret | undefined> {
  const secrets = await readSecrets()
  return secrets.providers[id]
}

/** Redact a secrets file into a client-safe status list. */
export function toStatusList(
  secrets: SecretsFile,
  allIds: ProviderId[]
): ProviderStatus[] {
  return allIds.map((id) => {
    const secret = secrets.providers[id]
    const verification = secret?.verification ?? { status: "unverified" as const }
    return {
      id,
      configured: id === "custom" ? Boolean(secret?.baseUrl) : Boolean(secret?.apiKey),
      last4: secret?.apiKey ? secret.apiKey.slice(-4) : undefined,
      baseUrl: secret?.baseUrl,
      verificationStatus: verification.status,
      checkedAt: verification.checkedAt,
    }
  })
}
