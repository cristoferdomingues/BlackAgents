"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Package } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { metaForType } from "@/lib/artifacts/constants"
import type { Artifact } from "@/lib/artifacts/types"
import { validateBundle, type BundleItem, type NormalizedBundle } from "@/lib/llm/bundle"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * Review card for a drafted bundle (agent + skills + rules). The user can edit
 * each item; "Create all" saves them one by one through /api/artifacts.
 * Skills and rules are saved first so the agent's links resolve.
 */
export function BundleCard({ bundle }: { bundle: NormalizedBundle }) {
  const { artifacts, refresh } = useWorkspace()
  const [items, setItems] = React.useState<BundleItem[]>(bundle.items)
  const [saving, setSaving] = React.useState(false)
  const [created, setCreated] = React.useState<string[]>([])
  const report = React.useMemo(
    () => validateBundle({ summary: bundle.summary, items }, existingWithoutCreated(artifacts, created)),
    [artifacts, items, bundle.summary, created]
  )
  const done = created.length === items.length

  function update(index: number, patch: Partial<BundleItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  async function createAll() {
    setSaving(true)
    try {
      for (const item of items) {
        const key = `${item.type}:${item.name}`
        if (created.includes(key)) continue
        await apiFetch<Artifact>("/api/artifacts", {
          method: "POST",
          body: JSON.stringify({
            type: item.type,
            platform: "cursor",
            name: item.name,
            description: item.description,
            body: item.body,
            extra: item.extra,
          }),
        })
        setCreated((prev) => [...prev, key])
      }
      toast.success(`Created ${items.length} artifacts`)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the bundle")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3 text-left" aria-label="Artifact bundle">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">Bundle: {items.length} artifacts</p>
        {report.ok ? (
          <Badge variant="outline" className="gap-1 text-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> Valid
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Fix issues
          </Badge>
        )}
      </div>
      {bundle.summary ? <p className="text-xs text-muted-foreground">{bundle.summary}</p> : null}
      <div className="space-y-2">
        {items.map((item, index) => (
          <BundleItemRow
            key={`${item.type}-${index}`}
            item={item}
            issues={report.items[index]?.issues ?? []}
            created={created.includes(`${item.type}:${item.name}`)}
            onChange={(patch) => update(index, patch)}
            disabled={saving || done}
          />
        ))}
      </div>
      <Button
        size="sm"
        className="w-full"
        onClick={createAll}
        disabled={!report.ok || saving || done}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
        {done ? "All created" : "Create all"}
      </Button>
    </div>
  )
}

/** Items saved by this card must not count as clashes against themselves. */
function existingWithoutCreated(artifacts: Artifact[], created: string[]): Artifact[] {
  return artifacts.filter((a) => !created.includes(`${a.type}:${a.name}`))
}

function BundleItemRow({
  item,
  issues,
  created,
  onChange,
  disabled,
}: {
  item: BundleItem
  issues: { severity: "error" | "warning"; message: string }[]
  created: boolean
  onChange: (patch: Partial<BundleItem>) => void
  disabled: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const meta = metaForType(item.type)
  const Icon = meta.icon
  const id = `${item.type}-${item.name}`
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Icon className={cn("h-4 w-4 shrink-0", meta.colorClass)} />
        <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
        <Badge variant="outline">{meta.label}</Badge>
        {created ? <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Created" /> : null}
        {issues.some((i) => i.severity === "error") ? (
          <AlertTriangle className="h-4 w-4 text-destructive" aria-label="Has errors" />
        ) : null}
      </button>
      {issues.length > 0 ? (
        <ul className="space-y-0.5 px-3 pb-2 text-xs">
          {issues.map((issue) => (
            <li
              key={issue.message}
              className={issue.severity === "error" ? "text-destructive" : "text-muted-foreground"}
            >
              {issue.severity === "error" ? "Error" : "Warning"}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div className="space-y-2 border-t p-3">
          <div className="space-y-1">
            <Label htmlFor={`${id}-name`} className="text-xs">Name</Label>
            <Input
              id={`${id}-name`}
              value={item.name}
              onChange={(e) => onChange({ name: e.target.value })}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-description`} className="text-xs">Description</Label>
            <Input
              id={`${id}-description`}
              value={item.description}
              onChange={(e) => onChange({ description: e.target.value })}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-body`} className="text-xs">Body</Label>
            <Textarea
              id={`${id}-body`}
              value={item.body}
              onChange={(e) => onChange({ body: e.target.value })}
              rows={8}
              className="font-mono text-xs"
              disabled={disabled}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
