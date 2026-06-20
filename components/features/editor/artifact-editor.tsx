"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  ArrowLeft,
  Eye,
  Loader2,
  Pencil,
  Save,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { apiFetch, ApiError } from "@/lib/api"
import { metaForType } from "@/lib/artifacts/constants"
import { nameSchema } from "@/lib/artifacts/schemas"
import { STANDARDS_SPEC } from "@/lib/standards/default-standards"
import type { Artifact, ArtifactType, Platform } from "@/lib/artifacts/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { MarkdownEditor } from "@/components/features/editor/markdown-editor"
import { MarkdownPreview } from "@/components/features/editor/markdown-preview"
import { GlobsInput } from "@/components/features/editor/globs-input"
import { StandardsHints } from "@/components/features/editor/standards-hints"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const formSchema = z.object({
  name: nameSchema,
  description: z.string().trim().min(1, "Description is required"),
  parallel: z.boolean(),
  alwaysApply: z.boolean(),
  globs: z.array(z.string()),
  body: z.string(),
})

type FormValues = z.infer<typeof formSchema>

export function ArtifactEditor({
  type,
  name,
}: {
  type: ArtifactType
  name?: string
}) {
  const meta = metaForType(type)
  const Icon = meta.icon
  const router = useRouter()
  const { workspace, loading: wsLoading, refresh } = useWorkspace()
  const isEdit = Boolean(name)

  const [loading, setLoading] = React.useState(isEdit)
  const [notFound, setNotFound] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [tab, setTab] = React.useState<"edit" | "preview">("edit")
  const platformRef = React.useRef<Platform>("cursor")

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      parallel: false,
      alwaysApply: false,
      globs: [],
      body: isEdit ? "" : STANDARDS_SPEC[type].bodyTemplate("agent-name"),
    },
  })

  const body = form.watch("body")

  React.useEffect(() => {
    if (!isEdit || !workspace) return
    let active = true
    setLoading(true)
    apiFetch<Artifact>(`/api/artifacts/${type}/${name}`)
      .then((artifact) => {
        if (!active) return
        platformRef.current = artifact.platform
        const fm = artifact.frontmatter
        form.reset({
          name: artifact.name,
          description: artifact.description,
          parallel: Boolean(fm.parallel),
          alwaysApply: Boolean(fm.alwaysApply),
          globs: Array.isArray(fm.globs) ? (fm.globs as string[]) : [],
          body: artifact.body,
        })
      })
      .catch(() => active && setNotFound(true))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, name, type, workspace])

  if (!workspace && !wsLoading) {
    return <NoWorkspace message={`Select a workspace to edit ${meta.labelPlural.toLowerCase()}.`} />
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          {meta.label} <code>{name}</code> was not found.
        </p>
        <Button asChild variant="link" className="px-0">
          <Link href={`/${meta.route}`}>Back to {meta.labelPlural}</Link>
        </Button>
      </div>
    )
  }

  async function onSubmit(values: FormValues) {
    setSaving(true)
    const payload = {
      type,
      platform: platformRef.current,
      name: values.name,
      description: values.description,
      body: values.body,
      extra: {
        parallel: values.parallel,
        alwaysApply: values.alwaysApply,
        globs: values.globs,
      },
    }
    try {
      if (isEdit) {
        await apiFetch(`/api/artifacts/${type}/${name}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        })
      } else {
        await apiFetch("/api/artifacts", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      }
      await refresh()
      toast.success(`${meta.label} "${values.name}" saved`)
      router.push(`/${meta.route}/${values.name}`)
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : `Could not save ${meta.label}`
      )
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    setDeleting(true)
    try {
      await apiFetch(`/api/artifacts/${type}/${name}`, { method: "DELETE" })
      await refresh()
      toast.success(`${meta.label} "${name}" deleted`)
      router.push(`/${meta.route}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete")
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" type="button">
            <Link href={`/${meta.route}`} aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Icon className={cn("h-5 w-5 shrink-0", meta.colorClass)} />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {isEdit ? name : `New ${meta.label}`}
            </h1>
            {isEdit ? (
              <p className="truncate text-xs text-muted-foreground">
                {meta.route} · {meta.label}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ) : null}
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="kebab-case-name"
                spellCheck={false}
                {...form.register("name")}
              />
              {form.formState.errors.name ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.name.message}
                </p>
              ) : null}
            </div>

            {type === "agent" ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <Label htmlFor="parallel">Parallel</Label>
                  <p className="text-xs text-muted-foreground">
                    Runs concurrently with sibling agents
                  </p>
                </div>
                <Controller
                  control={form.control}
                  name="parallel"
                  render={({ field }) => (
                    <Switch
                      id="parallel"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>
            ) : null}

            {type === "rule" ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <Label htmlFor="alwaysApply">Always apply</Label>
                  <p className="text-xs text-muted-foreground">
                    Inject on every request
                  </p>
                </div>
                <Controller
                  control={form.control}
                  name="alwaysApply"
                  render={({ field }) => (
                    <Switch
                      id="alwaysApply"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={2}
              placeholder="One-line summary (also used as the assistant's discovery trigger)."
              {...form.register("description")}
            />
            {form.formState.errors.description ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.description.message}
              </p>
            ) : null}
          </div>

          {type === "rule" ? (
            <div className="space-y-2">
              <Label>Globs</Label>
              <p className="text-xs text-muted-foreground">
                Activate this rule when matching files are edited (leave empty
                for always/on-request).
              </p>
              <Controller
                control={form.control}
                name="globs"
                render={({ field }) => (
                  <GlobsInput value={field.value} onChange={field.onChange} />
                )}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Body</Label>
              <Tabs
                value={tab}
                onValueChange={(v) => setTab(v as "edit" | "preview")}
              >
                <TabsList className="h-8">
                  <TabsTrigger value="edit" className="text-xs">
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </TabsTrigger>
                  <TabsTrigger value="preview" className="text-xs">
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Controller
              control={form.control}
              name="body"
              render={({ field }) =>
                tab === "edit" ? (
                  <MarkdownEditor
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Write the artifact body in Markdown…"
                  />
                ) : (
                  <MarkdownPreview content={field.value} />
                )
              }
            />
          </div>
        </div>

        <div className="lg:border-l lg:pl-6">
          <StandardsHints
            type={type}
            body={body}
            onInsertTemplate={
              isEdit
                ? undefined
                : () =>
                    form.setValue(
                      "body",
                      STANDARDS_SPEC[type].bodyTemplate(
                        form.getValues("name") || "agent-name"
                      )
                    )
            }
          />
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {meta.label.toLowerCase()}?</DialogTitle>
            <DialogDescription>
              This permanently removes <code>{name}</code> from disk. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}
