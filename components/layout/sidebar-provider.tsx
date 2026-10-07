"use client"

import * as React from "react"

const STORAGE_KEY = "black-agents.sidebar-open"

interface SidebarContextValue {
  open: boolean
  toggle: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

const listeners = new Set<() => void>()

/** In-tab override when storage is blocked. `null` means "read storage". */
let memoryOpen: boolean | null = null

function readOpen(): boolean {
  if (memoryOpen !== null) return memoryOpen
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "closed"
  } catch {
    return true
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function getServerSnapshot(): boolean {
  return true
}

const DESKTOP_QUERY = "(min-width: 768px)"

function subscribeDesktop(listener: () => void): () => void {
  const media = window.matchMedia(DESKTOP_QUERY)
  media.addEventListener("change", listener)
  return () => media.removeEventListener("change", listener)
}

function readDesktop(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches
}

function toggleSidebar(): void {
  const next = !readOpen()
  memoryOpen = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "open" : "closed")
  } catch {
    // This tab still follows memoryOpen when storage is blocked.
  }
  emit()
}

export function SidebarProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const open = React.useSyncExternalStore(subscribe, readOpen, getServerSnapshot)
  const value = React.useMemo(() => ({ open, toggle: toggleSidebar }), [open])

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar(): SidebarContextValue {
  const value = React.useContext(SidebarContext)
  const isDesktop = React.useSyncExternalStore(
    subscribeDesktop,
    readDesktop,
    getServerSnapshot
  )
  if (!value) {
    throw new Error("useSidebar must be used inside SidebarProvider")
  }
  return {
    open: isDesktop ? value.open : true,
    toggle: value.toggle,
  }
}
