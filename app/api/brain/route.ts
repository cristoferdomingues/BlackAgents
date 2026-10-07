import { ok, handle } from "@/lib/api-response"
import { listAgentBrains, listProposals, readNotes } from "@/lib/brain/store"
import type { BrainOverview } from "@/lib/brain/types"
import { readConfig } from "@/lib/config"

/** Inbox proposals plus every brain's approved notes. */
export async function GET() {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return ok<BrainOverview>({ proposals: [], workspaceNotes: [], agents: [] })
    const [proposals, workspaceNotes, agents] = await Promise.all([
      listProposals(currentPath),
      readNotes(currentPath),
      listAgentBrains(currentPath),
    ])
    return ok<BrainOverview>({ proposals, workspaceNotes, agents })
  })
}
