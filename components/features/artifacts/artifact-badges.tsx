import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import type { Artifact } from "@/lib/artifacts/types"

/** Render the type-specific frontmatter flags as small badges. */
export function ArtifactBadges({ artifact }: { artifact: Artifact }) {
  const fm = artifact.frontmatter
  const badges: ReactNode[] = []

  if (artifact.type === "agent" && fm.parallel) {
    badges.push(
      <Badge key="parallel" variant="secondary">
        parallel
      </Badge>
    )
  }
  if (artifact.type === "rule") {
    if (fm.alwaysApply) {
      badges.push(
        <Badge key="always" variant="secondary">
          always
        </Badge>
      )
    }
    if (Array.isArray(fm.globs) && fm.globs.length > 0) {
      badges.push(
        <Badge key="globs" variant="outline">
          {fm.globs.length} glob{fm.globs.length === 1 ? "" : "s"}
        </Badge>
      )
    }
    if (!fm.alwaysApply && !(Array.isArray(fm.globs) && fm.globs.length)) {
      badges.push(
        <Badge key="manual" variant="outline">
          on-request
        </Badge>
      )
    }
  }
  if (artifact.type === "skill" && artifact.supportingFiles?.length) {
    badges.push(
      <Badge key="files" variant="outline">
        +{artifact.supportingFiles.length} file
        {artifact.supportingFiles.length === 1 ? "" : "s"}
      </Badge>
    )
  }

  if (badges.length === 0) return null
  return <div className="flex flex-wrap gap-1">{badges}</div>
}
