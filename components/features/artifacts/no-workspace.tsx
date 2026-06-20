"use client"

import Link from "next/link"
import { ArrowRight, FolderOpen } from "lucide-react"

import { Button } from "@/components/ui/button"

export function NoWorkspace({ message }: { message?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FolderOpen className="h-6 w-6" />
      </div>
      <h1 className="text-xl font-semibold">No workspace selected</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {message ?? "Select a project folder to manage its artifacts."}
      </p>
      <Button asChild className="mt-6">
        <Link href="/settings">
          Select a workspace
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  )
}
