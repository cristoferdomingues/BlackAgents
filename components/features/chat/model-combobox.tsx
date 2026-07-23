"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { filterModels } from "@/lib/llm/list-models"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface ModelComboboxProps {
  value: string
  onChange: (model: string) => void
  models: string[]
  loading?: boolean
  className?: string
  disabled?: boolean
}

/**
 * Free-text model id input with a dropdown of known/validated models.
 * Any id can be typed; the chevron lists provider models to pick from.
 */
export function ModelCombobox({
  value,
  onChange,
  models,
  loading = false,
  className,
  disabled = false,
}: ModelComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const filtered = filterModels(models, query)
  const hasSuggestions = models.length > 0 || loading

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setQuery("")
  }

  return (
    <div className={cn("flex w-64", className)}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="model id"
        aria-label="Model"
        disabled={disabled}
        className={cn(hasSuggestions && "rounded-r-none")}
        autoComplete="off"
        spellCheck={false}
      />
      {hasSuggestions ? (
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              className="shrink-0 rounded-l-none border-l-0"
              aria-label="Choose model"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin opacity-70" />
              ) : (
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 p-0">
            <div className="p-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter models…"
                aria-label="Filter models"
                autoComplete="off"
                spellCheck={false}
                // Keep focus in the filter; don't dismiss the menu on key events.
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {loading
                ? "Loading models…"
                : `${filtered.length} of ${models.length}`}
            </DropdownMenuLabel>
            <div className="max-h-64 overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {loading
                    ? "Fetching from provider…"
                    : models.length === 0
                      ? "No models listed — type an id above"
                      : "No matching models"}
                </p>
              ) : (
                filtered.map((m) => (
                  <DropdownMenuItem
                    key={m}
                    onSelect={() => {
                      onChange(m)
                      setOpen(false)
                    }}
                    className="justify-between gap-2"
                  >
                    <span className="truncate font-mono text-xs">{m}</span>
                    {m === value ? (
                      <Check className="h-4 w-4 shrink-0" />
                    ) : null}
                  </DropdownMenuItem>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
