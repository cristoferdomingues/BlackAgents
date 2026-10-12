/** Client-safe model list filter. Kept out of the server model fetcher. */
export function filterModels(models: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter((m) => m.toLowerCase().includes(q))
}
