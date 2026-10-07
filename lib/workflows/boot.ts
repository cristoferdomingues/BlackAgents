import { getRunner } from "./runner"

/** Server start: recover interrupted runs and start the scheduler. Never throws. */
export async function startWorkflowRunner(): Promise<void> {
  try {
    await getRunner().start()
  } catch (err) {
    console.error("[workflows] runner failed to start:", err instanceof Error ? err.message : err)
  }
}
