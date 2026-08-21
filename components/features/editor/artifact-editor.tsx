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
  MessageCircle,
  Pencil,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { apiFetch, ApiError } from "@/lib/api"
import { metaForType } from "@/lib/artifacts/constants"
import { nameSchema } from "@/lib/artifacts/schemas"
import { applyMentions } from "@/lib/artifacts/mentions"
import { STANDARDS_SPEC } from "@/lib/standards/default-standards"
import { DRAFT_STORAGE_KEY, draftSchema, normalizeDraft } from "@/lib/llm/draft"
import type { ValidationResult } from "@/lib/llm/validation"
import type { Artifact, ArtifactType, Platform } from "@/lib/artifacts/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import {
  MarkdownEditor,
  type MentionItem,
} from "@/components/features/editor/markdown-editor"
import { MarkdownPreview } from "@/components/features/editor/markdown-preview"
import { GlobsInput } from "@/components/features/editor/globs-input"
import { StandardsHints } from "@/components/features/editor/standards-hints"
import type { ProvidersState } from "@/components/features/providers/provider-readiness"
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

const LAST_PROVIDER_KEY = "black-agents:last-provider"
const lastModelKey = (provider: string) => `black-agents:last-model:${provider}`

interface DraftBodyResponse {
  body: string
  extra: { parallel: boolean; alwaysApply: boolean; globs: string[] }
  links: Array<{ to: ArtifactType; toName: string; kind: string }>
}

function severityClass(severity: "error" | "warning" | "info"): string {
  switch (severity) {
    case "error":
      return "text-destructive"
    case "warning":
      return "text-amber-500"
    default:
      return "text-muted-foreground"
  }
}

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
  const { workspace, loading: wsLoading, refresh, artifacts } = useWorkspace()
  const isEdit = Boolean(name)

  // Artifacts the user can @-mention in the body — everything in the workspace
  // except the one being edited (so it can't reference itself).
  const mentions = React.useMemo<MentionItem[]>(
    () =>
      artifacts
        .filter((a) => !(a.type === type && a.name === name))
        .map((a) => ({
          type: a.type,
          name: a.name,
          description: a.description,
        })),
    [artifacts, type, name]
  )

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

  // React Hook Form intentionally exposes subscription-based watch values.
  // eslint-disable-next-line react-hooks/incompatible-library
  const body = form.watch("body")
  const nameValue = form.watch("name")
  const descriptionValue = form.watch("description")

  const [providers, setProviders] = React.useState<ProvidersState | null>(null)
  const [providersLoaded, setProvidersLoaded] = React.useState(false)
  const [generating, setGenerating] = React.useState(false)
  const [validating, setValidating] = React.useState(false)
  const [validation, setValidation] = React.useState<ValidationResult | null>(
    null
  )
  const [validateOpen, setValidateOpen] = React.useState(false)

  // Load the provider catalog + redacted status to decide whether the assistant
  // actions (draft in create, validate in both) are available.
  React.useEffect(() => {
    let active = true
    apiFetch<ProvidersState>("/api/providers")
      .then((data) => active && setProviders(data))
      .catch(() => {
        // Providers are optional; the assistant actions just stay disabled.
      })
      .finally(() => active && setProvidersLoaded(true))
    return () => {
      active = false
    }
  }, [])

  const usableProviderIds = React.useMemo(() => {
    if (!providers) return [] as string[]
    return providers.status
      .filter((s) => s.verificationStatus === "valid")
      .map((s) => s.id)
  }, [providers])

  const hasProvider = usableProviderIds.length > 0
  const detailsValid =
    hasProvider &&
    nameSchema.safeParse(nameValue).success &&
    (descriptionValue?.trim().length ?? 0) > 0
  const canDraft = detailsValid
  const canValidate = detailsValid && (body?.trim().length ?? 0) > 0

  function resolveProviderModel(): { provider: string; model: string } | null {
    if (!providers || usableProviderIds.length === 0) return null
    const last =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_PROVIDER_KEY)
        : null
    // Prefer durable secrets defaults — Electron uses a fresh loopback origin
    // each launch, so localStorage alone does not survive restarts.
    const provider =
      (providers.defaults.provider &&
      usableProviderIds.includes(providers.defaults.provider)
        ? providers.defaults.provider
        : null) ??
      (last && usableProviderIds.includes(last) ? last : null) ??
      usableProviderIds[0]
    const descriptor = providers.providers.find((p) => p.id === provider)
    const lastModel =
      typeof window !== "undefined"
        ? window.localStorage.getItem(lastModelKey(provider))
        : null
    const defaultModel =
      providers.defaults.provider === provider
        ? providers.defaults.model
        : undefined
    const model = defaultModel || lastModel || descriptor?.models[0] || ""
    return { provider, model }
  }

  async function onDraft() {
    const resolved = resolveProviderModel()
    if (!resolved) return
    if (!resolved.model) {
      const label =
        providers?.providers.find((p) => p.id === resolved.provider)?.label ??
        resolved.provider
      toast.error(
        `Pick a model for ${label} in the Assistant first, then try again`
      )
      return
    }
    setGenerating(true)
    try {
      const res = await apiFetch<DraftBodyResponse>("/api/artifacts/draft-body", {
        method: "POST",
        body: JSON.stringify({
          type,
          name: form.getValues("name"),
          description: form.getValues("description"),
          provider: resolved.provider,
          model: resolved.model,
        }),
      })
      form.setValue("body", res.body, { shouldDirty: true })
      if (type === "agent") form.setValue("parallel", res.extra.parallel)
      if (type === "rule") {
        form.setValue("alwaysApply", res.extra.alwaysApply)
        if (res.extra.globs.length > 0) form.setValue("globs", res.extra.globs)
      }
      if (res.links.length > 0) {
        const linked = res.links.map((l) => `${l.to}/${l.toName}`).join(", ")
        toast.success(`Body drafted — linked: ${linked}`)
      } else {
        toast.success("Body drafted by the assistant — review and edit")
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not draft the body"
      )
    } finally {
      setGenerating(false)
    }
  }

  async function onValidate() {
    const resolved = resolveProviderModel()
    if (!resolved) return
    if (!resolved.model) {
      const label =
        providers?.providers.find((p) => p.id === resolved.provider)?.label ??
        resolved.provider
      toast.error(
        `Pick a model for ${label} in the Assistant first, then try again`
      )
      return
    }
    setValidating(true)
    try {
      const res = await apiFetch<ValidationResult>("/api/artifacts/validate", {
        method: "POST",
        body: JSON.stringify({
          type,
          name: form.getValues("name"),
          description: form.getValues("description"),
          body: form.getValues("body"),
          extra: {
            parallel: form.getValues("parallel"),
            alwaysApply: form.getValues("alwaysApply"),
            globs: form.getValues("globs"),
          },
          provider: resolved.provider,
          model: resolved.model,
        }),
      })
      setValidation(res)
      setValidateOpen(true)
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not validate the artifact"
      )
    } finally {
      setValidating(false)
    }
  }

  // Chat → editor handoff: when the assistant proposes an artifact, the chat
  // stashes it in sessionStorage and routes to /<type>/new. Consume it once.
  React.useEffect(() => {
    if (isEdit) return
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return
    sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    try {
      const parsed = draftSchema.safeParse(JSON.parse(raw))
      if (!parsed.success || parsed.data.type !== type) return
      const draft = normalizeDraft(parsed.data)
      form.reset({
        name: draft.name,
        description: draft.description,
        parallel: draft.parallel,
        alwaysApply: draft.alwaysApply,
        globs: draft.globs,
        body: draft.body,
      })
      toast.success("Draft loaded from the assistant — review and save")
    } catch {
      // ignore malformed drafts
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, type])

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
      body: applyMentions(values.body),
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
      <div className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-3">
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isEdit && type === "agent" ? (
            hasProvider ? (
              <Button asChild type="button" variant="outline" size="sm">
                <Link href={`/chat?agent=${encodeURIComponent(name ?? "")}`}>
                  <MessageCircle className="h-4 w-4" />
                  Chat with this agent
                </Link>
              </Button>
            ) : providersLoaded ? (
              <Button asChild type="button" variant="outline" size="sm">
                <Link
                  href="/providers"
                  title="Verify an AI provider to chat with this agent"
                >
                  Verify provider to chat
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking chat
              </Button>
            )
          ) : null}
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
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDraft}
              disabled={!canDraft || generating}
              title={
                !hasProvider
                  ? "Verify an AI provider to enable assistant drafting"
                  : !canDraft
                    ? "Enter a valid name and description first"
                    : "Draft the body from the name and description"
              }
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Draft with assistant
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onValidate}
            disabled={!canValidate || validating}
            title={
              !hasProvider
                ? "Verify an AI provider to enable assistant validation"
                : !canValidate
                  ? "A valid name, description and body are required to validate"
                  : "Review this artifact against the authoring standards"
            }
          >
            {validating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Validate with assistant
          </Button>
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
                    placeholder="Write the artifact body in Markdown… Type @ to link another artifact."
                    mentions={mentions}
                  />
                ) : (
                  <MarkdownPreview content={applyMentions(field.value)} />
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

      <Dialog open={validateOpen} onOpenChange={setValidateOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assistant review</DialogTitle>
            <DialogDescription>
              {validation?.summary
                ? validation.summary
                : "The assistant reviewed this artifact against the authoring standards. Findings are suggestions — nothing was changed."}
            </DialogDescription>
          </DialogHeader>
          {validation && validation.findings.length > 0 ? (
            <ul className="space-y-3">
              {validation.findings.map((f, i) => (
                <li key={i} className="rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-[11px] font-semibold uppercase tracking-wide",
                        severityClass(f.severity)
                      )}
                    >
                      {f.severity}
                    </span>
                    {f.section ? (
                      <span className="text-xs text-muted-foreground">
                        · {f.section}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm">{f.message}</p>
                  {f.suggestion ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Suggestion: {f.suggestion}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No issues found — the artifact looks consistent with the
              standards.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setValidateOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}
