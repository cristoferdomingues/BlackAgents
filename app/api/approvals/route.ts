import { ok, handle } from "@/lib/api-response"
import { listPendingApprovals } from "@/lib/runtime/approvals"

/** Tool calls (chat or workflow runs) waiting for the user. */
export async function GET() {
  return handle(async () => ok({ approvals: listPendingApprovals() }))
}
