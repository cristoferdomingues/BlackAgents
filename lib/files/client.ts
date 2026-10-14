import { MAX_WORKSPACE_FILE_BYTES, type WorkspaceFile } from "./schema"
import { apiFetch } from "@/lib/api"
import { formatBytes } from "@/lib/chat/attachments"

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(new Error("Could not read the file"))
    reader.readAsDataURL(file)
  })
}

export async function uploadWorkspaceFile(
  file: File,
  options: { name?: string; description?: string; overwrite?: boolean } = {}
): Promise<WorkspaceFile> {
  if (file.size === 0) {
    throw new Error(`"${file.name}" is empty`)
  }
  if (file.size > MAX_WORKSPACE_FILE_BYTES) {
    throw new Error(`"${file.name}" is too big (max ${formatBytes(MAX_WORKSPACE_FILE_BYTES)})`)
  }
  const dataUrl = await readAsDataUrl(file)
  const comma = dataUrl.indexOf(",")
  const data = comma === -1 ? "" : dataUrl.slice(comma + 1)
  if (!data) {
    throw new Error(`Could not read "${file.name}"`)
  }
  const res = await apiFetch<{ file: WorkspaceFile }>("/api/files", {
    method: "POST",
    body: JSON.stringify({
      name: options.name,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      data,
      description: options.description,
      overwrite: options.overwrite,
    }),
  })
  return res.file
}
