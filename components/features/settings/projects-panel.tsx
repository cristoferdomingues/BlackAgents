"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Boxes, CircleCheck, Loader2, Plus, Save, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { apiFetch, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ProjectScope } from "@/lib/artifacts/projects"
import {
  ACTION,
  EMPTY,
  INHERITS_HELP,
  inheritsSummary,
  INVALID_HELP,
  INVALID_TITLE,
  PROJECTS_INTRO,
  PROJECTS_WHERE,
  SCOPE_TOKENS,
  suggestProjectId,
} from "@/lib/artifacts/projects-explain"
import { projectIdSchema, type ScopeToken } from "@/lib/artifacts/schemas"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name").max(80),
  id: projectIdSchema,
  description: z.string().trim().max(300),
})
type CreateValues = z.infer<typeof createSchema>

/** Settings card: create projects, choose what they inherit, open or delete them. */
export function ProjectsPanel(): React.ReactElement {
  const { workspace, projects, invalidProjects, project, setActiveProject, refreshProjects, refresh } =
    useWorkspace()
  const [inherits, setInherits] = React.useState<ScopeToken[]>([])
  const [creating, setCreating] = React.useState(false)
  const [idTouched, setIdTouched] = React.useState(false)
  const [deleting, setDeleting] = React.useState<ProjectScope | null>(null)

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", id: "", description: "" },
  })

  if (!workspace) {
    return (
      <Card id="projects">
        <CardHeader>
          <CardTitle className="text-base">Projects</CardTitle>
          <CardDescription>Create or open a workspace first. Projects live inside a workspace.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  async function onCreate(values: CreateValues): Promise<void> {
    setCreating(true)
    try {
      await apiFetch<ProjectScope>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          id: values.id,
          name: values.name,
          ...(values.description ? { description: values.description } : {}),
          inherits,
        }),
      })
      toast.success(`Created project ${values.name}`)
      form.reset()
      setInherits([])
      setIdTouched(false)
      await refreshProjects()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the project")
    } finally {
      setCreating(false)
    }
  }

  async function onDelete(target: ProjectScope): Promise<void> {
    try {
      if (project?.id === target.id) await setActiveProject(null)
      await apiFetch(`/api/projects/${encodeURIComponent(target.id)}`, { method: "DELETE" })
      toast.success(`Deleted project ${target.name}`)
      await refreshProjects()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the project")
    } finally {
      setDeleting(null)
    }
  }

  const errors = form.formState.errors

  return (
    <Card id="projects" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="h-4 w-4 text-primary" aria-hidden />
          Projects in {workspace.name}
        </CardTitle>
        <CardDescription>
          {PROJECTS_INTRO} {PROJECTS_WHERE}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {projects.length === 0 ? (
          <div className="space-y-1 rounded-lg border border-dashed px-4 py-6 text-center">
            <p className="text-sm font-medium">{EMPTY.title}</p>
            <p className="text-sm text-muted-foreground">{EMPTY.text}</p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Projects">
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                active={project?.id === p.id}
                onOpen={() => void setActiveProject(p.id)}
                onDelete={() => setDeleting(p)}
                onSaved={async () => {
                  await refreshProjects()
                  if (project?.id === p.id) await refresh()
                }}
              />
            ))}
          </ul>
        )}

        {invalidProjects.length > 0 ? (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <TriangleAlert className="h-4 w-4 text-destructive" aria-hidden />
              {INVALID_TITLE}
            </p>
            <p className="text-xs text-muted-foreground">{INVALID_HELP}</p>
            <ul className="space-y-1 text-xs">
              {invalidProjects.map((p) => (
                <li key={p.folder}>
                  <code>{p.folder}</code>: {p.error}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form
          onSubmit={form.handleSubmit(onCreate)}
          className="space-y-4 rounded-lg border p-4"
          aria-labelledby="new-project-title"
        >
          <p id="new-project-title" className="text-sm font-medium">
            New project
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                placeholder="MyHealthCare"
                aria-invalid={Boolean(errors.name)}
                {...form.register("name", {
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                    if (!idTouched) {
                      form.setValue("id", suggestProjectId(e.target.value), { shouldValidate: false })
                    }
                  },
                })}
              />
              {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-id">Folder id</Label>
              <Input
                id="project-id"
                placeholder="myhealthcare"
                aria-invalid={Boolean(errors.id)}
                aria-describedby="project-id-help"
                {...form.register("id", {
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                    setIdTouched(true)
                    form.setValue("id", suggestProjectId(e.target.value))
                  },
                })}
              />
              <p id="project-id-help" className="text-xs text-muted-foreground">
                Lowercase words with dashes. It becomes the folder name and cannot change later.
              </p>
              {errors.id ? <p className="text-xs text-destructive">{errors.id.message}</p> : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-description">Description (optional)</Label>
            <Input id="project-description" placeholder="Personal health tracking" {...form.register("description")} />
          </div>
          <InheritsPicker value={inherits} onChange={setInherits} idPrefix="new" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{ACTION.create}</p>
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create project
            </Button>
          </div>
        </form>
      </CardContent>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              {ACTION.remove} Folder: <code>.black-agents/projects/{deleting?.id}/</code>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleting && void onDelete(deleting)}
            >
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ProjectRow({
  project,
  active,
  onOpen,
  onDelete,
  onSaved,
}: {
  project: ProjectScope
  active: boolean
  onOpen: () => void
  onDelete: () => void
  onSaved: () => Promise<void>
}): React.ReactElement {
  const [inherits, setInherits] = React.useState<ScopeToken[]>(project.inherits)
  const [saving, setSaving] = React.useState(false)
  const dirty =
    inherits.length !== project.inherits.length || inherits.some((t) => !project.inherits.includes(t))

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await apiFetch<ProjectScope>(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ inherits }),
      })
      toast.success(`Saved ${project.name}`)
      await onSaved()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the project")
    } finally {
      setSaving(false)
    }
  }

  return (
    <li
      className={cn(
        "space-y-3 rounded-md border px-3 py-3",
        active ? "border-primary/40 bg-primary/5" : "border-border"
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        {active ? (
          <CircleCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        ) : (
          <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{project.name}</p>
            {active ? (
              <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                Active
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            .black-agents/projects/{project.id}/ · {inheritsSummary(project.inherits)}
          </p>
        </div>
        {!active ? (
          <Button type="button" variant="outline" size="sm" title={ACTION.activate} onClick={onOpen}>
            Open
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${project.name}`}
          title={ACTION.remove}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <InheritsPicker value={inherits} onChange={setInherits} idPrefix={project.id} />
      {dirty ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{ACTION.save}</p>
          <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>
      ) : null}
    </li>
  )
}

function InheritsPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: ScopeToken[]
  onChange: (next: ScopeToken[]) => void
  idPrefix: string
}): React.ReactElement {
  const labelId = `${idPrefix}-inherits-label`
  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-sm font-medium">
        Shared from the workspace
      </p>
      <p className="text-xs text-muted-foreground">{INHERITS_HELP}</p>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {SCOPE_TOKENS.map((t) => {
          const on = value.includes(t.token)
          return (
            <Tooltip key={t.token}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  className="h-7 px-2.5 text-xs"
                  aria-pressed={on}
                  onClick={() => onChange(on ? value.filter((x) => x !== t.token) : [...value, t.token])}
                >
                  {t.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.help}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
