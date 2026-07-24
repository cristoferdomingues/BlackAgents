export function getAvailablePort(host?: string): Promise<number>

export function waitForServer(
  url: string,
  options?: {
    timeoutMs?: number
    intervalMs?: number
  }
): Promise<void>

export function isSafeExternalUrl(value: string): boolean
