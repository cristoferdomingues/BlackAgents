"use client"

import * as React from "react"

/** Tick every `intervalMs` while `enabled` so elapsed timers stay fresh. */
export function useNow(intervalMs = 1_000, enabled = true): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, enabled])
  return now
}
