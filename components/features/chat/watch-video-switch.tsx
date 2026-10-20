"use client"

import * as React from "react"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const STORAGE_KEY = "blackagents.youtube.watch"
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function readWatch(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === "1"
}

function setWatchPreference(next: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
  for (const listener of listeners) listener()
}

/** The "Watch video" choice, kept in localStorage so it stays between visits. */
export function useWatchVideoPreference(): [boolean, (next: boolean) => void] {
  const watch = React.useSyncExternalStore(subscribe, readWatch, () => false)
  return [watch, setWatchPreference]
}

export function WatchVideoSwitch({
  id,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
      <div className="space-y-0.5">
        <Label htmlFor={id}>Watch the video</Label>
        <p className="text-xs text-muted-foreground">
          A video model also looks at the pictures. It is slower and costs more. Set it in Settings → AI →
          Models by task → Video.
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}
