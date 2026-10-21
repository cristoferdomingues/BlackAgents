import { pathExists, readBytes, readText, statFile } from "@/lib/fs-service"

import { K0dingError } from "./errors"
import { K0DING_LIMITS } from "./limits"
import { resolveExistingInside, sha256 } from "./paths"
import type { FileView } from "./schema"
import { isSecretPath } from "./secrets"

export function looksBinary(bytes: Buffer): boolean {
  const end = Math.min(bytes.length, 8_192)
  for (let i = 0; i < end; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

/** Read one file for the viewer. Secret files are returned; the model path refuses them. */
export async function readCodeFile(root: string, relativePath: string): Promise<FileView> {
  const abs = await resolveExistingInside(root, relativePath)
  if (!(await pathExists(abs))) throw new K0dingError("File not found", 404)
  const stat = await statFile(abs)
  if (stat.isDirectory) throw new K0dingError("That path is a folder", 400)
  if (!stat.isFile) throw new K0dingError("That path is not a file", 400)
  const secret = isSecretPath(relativePath)
  if (stat.size > K0DING_LIMITS.maxFileBytes) {
    return {
      path: relativePath,
      content: null,
      hash: null,
      bytes: stat.size,
      binary: false,
      secret,
      truncated: true,
      message: "This file is over 1 MB. K0ding does not open it.",
    }
  }
  const bytes = await readBytes(abs)
  if (looksBinary(bytes)) {
    return {
      path: relativePath,
      content: null,
      hash: sha256(bytes),
      bytes: bytes.length,
      binary: true,
      secret,
      truncated: false,
      message: "This file is not text.",
    }
  }
  const content = await readText(abs)
  return {
    path: relativePath,
    content,
    hash: sha256(content),
    bytes: bytes.length,
    binary: false,
    secret,
    truncated: false,
  }
}

/** Text the model may see. Secret files and huge files are refused. */
export async function readForModel(
  root: string,
  relativePath: string,
  range?: { startLine?: number; endLine?: number }
): Promise<{ text: string; hash: string; truncated: boolean }> {
  if (isSecretPath(relativePath)) {
    throw new K0dingError("That file is secret and is not sent to the model")
  }
  const file = await readCodeFile(root, relativePath)
  if (file.binary || file.content === null || !file.hash) {
    throw new K0dingError(file.message ?? "That file cannot be read")
  }
  const lines = file.content.split("\n")
  const start = Math.max(1, range?.startLine ?? 1)
  const end = Math.min(lines.length, range?.endLine ?? lines.length)
  const sliced = range?.startLine || range?.endLine ? lines.slice(start - 1, end).join("\n") : file.content
  if (sliced.length <= K0DING_LIMITS.maxToolReadChars) {
    return { text: sliced, hash: file.hash, truncated: false }
  }
  return {
    text: `${sliced.slice(0, K0DING_LIMITS.maxToolReadChars)}\n\n[truncated: file is longer than ${K0DING_LIMITS.maxToolReadChars} characters. Read a line range.]`,
    hash: file.hash,
    truncated: true,
  }
}
