"use client"

import { ArrowRight, FolderOpen } from "lucide-react"

import { useWorkspaceDialogs } from "@/components/features/workspace/workspace-dialogs"
import { Button } from "@/components/ui/button"

export function NoWorkspace({ message }: { message?: string }) {
  const { openCreate, openExisting } = useWorkspaceDialogs()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FolderOpen className="h-6 w-6" />
      </div>
      <h1 className="text-xl font-semibold">No workspace selected</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {message ?? "Create a new agent workspace or open an existing project folder."}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={openCreate}>
          Create workspace
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={openExisting}>
          Open existing folder
        </Button>
      </div>
    </div>
  )
}
