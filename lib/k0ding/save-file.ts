import { writeText } from "@/lib/fs-service"

import { K0dingError } from "./errors"
import { K0DING_LIMITS } from "./limits"
import { resolveExistingInside } from "./paths"
import { readCodeFile } from "./read-file"
import type { FileView } from "./schema"

/** Save a text file the user edited. Refuses the write when the file changed since it was opened. */
export async function saveCodeFile(
  root: string,
  relativePath: string,
  content: string,
  expectedHash: string
): Promise<FileView> {
  if (relativePath.split("/").includes(".git")) throw new K0dingError("Git files are not written")
  if (Buffer.byteLength(content) > K0DING_LIMITS.maxFileBytes) {
    throw new K0dingError("This file is over 1 MB.")
  }
  const current = await readCodeFile(root, relativePath)
  if (current.binary || current.content === null || !current.hash) {
    throw new K0dingError(current.message ?? "This file cannot be edited")
  }
  if (current.hash !== expectedHash) {
    throw new K0dingError("This file changed on disk. Reload it before saving.", 409)
  }
  const abs = await resolveExistingInside(root, relativePath)
  await writeText(abs, content)
  return readCodeFile(root, relativePath)
}
