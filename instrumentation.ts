export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.BLACK_AGENTS_DISABLE_RUNNER) return
  const { startWorkflowRunner } = await import("@/lib/workflows/boot")
  await startWorkflowRunner()
}
