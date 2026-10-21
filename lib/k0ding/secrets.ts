/** Files that stay on this computer. The model never receives their text. */
export function isSecretPath(relPath: string): boolean {
  const rel = relPath.replace(/\\/g, "/").replace(/^\.\//, "")
  if (!rel || rel.split("/").includes(".git")) return true
  const base = rel.slice(rel.lastIndexOf("/") + 1)
  if (base === ".npmrc" || base === ".env" || base.startsWith(".env.")) return true
  if (base.endsWith(".pem") || base.endsWith(".key")) return true
  if (base === "id_rsa" || base.startsWith("id_rsa")) return true
  return false
}
