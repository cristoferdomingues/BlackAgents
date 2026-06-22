import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

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
}

const DEFAULT_SECRETS: SecretsFile = { providers: {} }

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
    const parsed = JSON.parse(raw) as Partial<SecretsFile>
    return { providers: parsed.providers ?? {}, defaults: parsed.defaults }
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
    return {
      id,
      configured: Boolean(secret?.apiKey),
      last4: secret?.apiKey ? secret.apiKey.slice(-4) : undefined,
      baseUrl: secret?.baseUrl,
    }
  })
}
