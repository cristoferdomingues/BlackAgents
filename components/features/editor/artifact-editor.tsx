"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  ArrowLeft,
  ChevronDown,
  Eye,
  Loader2,
  MessageCircle,
  MoreHorizontal,
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
import { ABILITY_LEVELS, abilityChoiceOf } from "@/lib/artifacts/abilities"
import {
  editorChecks,
  ruleActivationOf,
  suggestName,
  toKebabWhileTyping,
} from "@/lib/artifacts/editor-helpers"
import type { StarterTemplate } from "@/lib/artifacts/starter-templates"
import { builtinToolNameSchema, DEFAULT_AGENT_TOOLS, isBuiltinToolName } from "@/lib/runtime/tool-names"
import { ModelChoiceFields, useSavedTaskModels } from "@/components/features/models/model-choice-fields"
import {
  MODEL_SELECT_VALUES,
  agentModelExtra,
  isTaskSelectValue,
  modelFormFromFrontmatter,
  type ModelSelectValue,
} from "@/components/features/models/model-choice"
import { STANDARDS_SPEC } from "@/lib/standards/default-standards"
import { DRAFT_STORAGE_KEY, draftSchema, normalizeDraft } from "@/lib/llm/draft"
import type { ValidationResult } from "@/lib/llm/validation"
import type { Artifact, ArtifactType, Platform } from "@/lib/artifacts/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { MarkdownEditor, type MentionItem } from "@/components/features/editor/markdown-editor"
import { MarkdownPreview } from "@/components/features/editor/markdown-preview"
import { AbilitiesField } from "@/components/features/editor/abilities-field"
import { RuleActivationField } from "@/components/features/editor/rule-activation-field"
import { EditorSection } from "@/components/features/editor/editor-section"
import { EditorSidePanel } from "@/components/features/editor/editor-side-panel"
import { StartPicker } from "@/components/features/editor/start-picker"
import { TryChatPanel, type TryDraft } from "@/components/features/editor/try-chat-panel"
import { DeleteArtifactDialog, ValidationDialog } from "@/components/features/editor/editor-dialogs"
import { useAssistantProvider } from "@/components/features/editor/use-assistant-provider"
import { SkillTriggerButton } from "@/components/features/skills/skill-trigger"
import { YouTubeSourcesField } from "@/components/features/editor/youtube-sources"
import type { YouTubeDraftSource } from "@/lib/sources/youtube"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const createFormSchema = (isEdit: boolean, type: ArtifactType) =>
  z
    .object({
      name: isEdit ? z.string().trim().min(1, "Name is required").max(80, "Name is too long") : nameSchema,
      description: z.string().trim().min(1, "Description is required"),
      parallel: z.boolean().default(false),
      alwaysApply: z.boolean().default(false),
      globs: z.array(z.string()).default([]),
      tools: z.array(builtinToolNameSchema).default([...DEFAULT_AGENT_TOOLS]),
      mcpServers: z.array(z.string()).default([]),
      modelChoice: z.enum(MODEL_SELECT_VALUES).default("inherit"),
      modelId: z.string().default(""),
      modelAlias: z.string().default(""),
      body: z.string().default(""),
    })
    .superRefine((values, ctx) => {
      if (type !== "agent") return
      if (values.modelChoice !== "openai" && values.modelChoice !== "anthropic" && values.modelChoice !== "custom") {
        return
      }
      if (!values.modelId.trim()) {
        ctx.addIssue({ code: "custom", path: ["modelId"], message: "Choose a model" })
      }
    })

type FormValues = z.infer<ReturnType<typeof createFormSchema>>

interface DraftBodyResponse {
  body: string
  description: string
  extra: { parallel: boolean; alwaysApply: boolean; globs: string[] }
  links: Array<{ to: ArtifactType; toName: string; kind: string }>
}

const DESCRIPTION_HINT: Record<ArtifactType, string> = {
  agent: "One sentence: what this agent does. The assistant uses it to pick the agent.",
  rule: "One sentence: what this rule protects.",
  skill: "Say when to use it, e.g. “Use when writing migrations …”. This is how the skill is found.",
  command: "One sentence: what this command gets done.",
}

const BODY_COPY: Record<ArtifactType, { title: string; description: string; placeholder: string }> = {
  agent: {
    title: "Instructions",
    description: "Who the agent is and how it works. Type @ to link a rule or skill.",
    placeholder: "Write the agent's instructions in Markdown… Type @ to link another artifact.",
  },
  rule: {
    title: "The rule",
    description: "Short do / don't lines. Keep it under 40 lines.",
    placeholder: "- Do X.\n- Don't Y.",
  },
  skill: {
    title: "Knowledge",
    description: "The reference material, examples and steps. Type @ to link other artifacts.",
    placeholder: "Write the skill in Markdown… Type @ to link another artifact.",
  },
  command: {
    title: "Steps",
    description: "Which agents run, in what order. Type @ to link an agent.",
    placeholder: "Write the command steps in Markdown… Type @ to link an agent.",
  },
}

function emptyValues(type: ArtifactType, isEdit: boolean): FormValues {
  return {
    name: "",
    description: "",
    parallel: false,
    alwaysApply: false,
    globs: [],
    tools: [...DEFAULT_AGENT_TOOLS],
    mcpServers: [],
    modelChoice: "inherit",
    modelId: "",
    modelAlias: "",
    body: isEdit ? "" : STANDARDS_SPEC[type].bodyTemplate("agent-name"),
  }
}

/** A name not used yet by another artifact of this type ("reviewer", "reviewer-2", …). */
function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return base
}

type Phase = "checking" | "start" | "edit"

export function ArtifactEditor({ type, name }: { type: ArtifactType; name?: string }): React.ReactElement {
  const meta = metaForType(type)
  const Icon = meta.icon
  const router = useRouter()
  const { workspace, loading: wsLoading, refresh, artifacts } = useWorkspace()
  const isEdit = Boolean(name)
  const assistant = useAssistantProvider()

  // Everything the user can @-mention, except the artifact being edited.
  const mentions = React.useMemo<MentionItem[]>(
    () =>
      artifacts
        .filter((a) => !(a.type === type && a.name === name))
        .map((a) => ({ type: a.type, name: a.name, description: a.description })),
    [artifacts, type, name]
  )
  const takenNames = React.useMemo(
    () => new Set(artifacts.filter((a) => a.type === type).map((a) => a.name)),
    [artifacts, type]
  )

  const [phase, setPhase] = React.useState<Phase>(isEdit ? "edit" : "checking")
  const [loading, setLoading] = React.useState(isEdit)
  const [notFound, setNotFound] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [tab, setTab] = React.useState<"edit" | "preview">("edit")
  const [generating, setGenerating] = React.useState(false)
  const [validating, setValidating] = React.useState(false)
  const [validation, setValidation] = React.useState<ValidationResult | null>(null)
  const [validateOpen, setValidateOpen] = React.useState(false)
  const [youtubeSources, setYoutubeSources] = React.useState<YouTubeDraftSource[]>([])
  const [tryOpen, setTryOpen] = React.useState(false)
  const platformRef = React.useRef<Platform>("cursor")

  const schema = React.useMemo(() => createFormSchema(isEdit, type), [isEdit, type])
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues(type, isEdit),
  })

  // React Hook Form intentionally exposes subscription-based watch values.
  // eslint-disable-next-line react-hooks/incompatible-library
  const values = form.watch()
  const taskModels = useSavedTaskModels(type === "agent" && isTaskSelectValue(values.modelChoice))
  const dirty = form.formState.isDirty

  const isNameValid = isEdit ? Boolean(values.name?.trim()) : nameSchema.safeParse(values.name).success
  const hasDescription = (values.description?.trim().length ?? 0) > 0
  const canDraftFromVideos = type === "skill" && !isEdit && youtubeSources.length > 0
  const canDraft = assistant.hasProvider && isNameValid && (hasDescription || canDraftFromVideos)
  const canValidate =
    assistant.hasProvider && isNameValid && hasDescription && (values.body?.trim().length ?? 0) > 0
  const canTry =
    assistant.hasProvider && nameSchema.safeParse(values.name).success && hasDescription

  function resolveWithModel(): ReturnType<typeof assistant.resolve> {
    const resolved = assistant.resolve()
    if (!resolved) return null
    if (!resolved.model) {
      toast.error(`Pick a model for ${resolved.label} in the Assistant first, then try again`)
      return null
    }
    return resolved
  }

  function buildPayload(v: FormValues): TryDraft {
    return {
      type,
      platform: platformRef.current,
      name: v.name,
      description: v.description,
      body: applyMentions(v.body),
      extra: {
        parallel: v.parallel,
        alwaysApply: v.alwaysApply,
        globs: v.globs,
        ...(type === "agent" ? { tools: v.tools, mcpServers: v.mcpServers, ...agentModelExtra(v) } : {}),
      },
    }
  }

  async function draftBody(input: { name: string; description: string }): Promise<boolean> {
    const resolved = resolveWithModel()
    if (!resolved) return false
    setGenerating(true)
    try {
      const sources = type === "skill" && !isEdit ? youtubeSources : []
      const res = await apiFetch<DraftBodyResponse>("/api/artifacts/draft-body", {
        method: "POST",
        body: JSON.stringify({
          type,
          name: input.name,
          description: input.description,
          provider: resolved.provider,
          model: resolved.model,
          ...(sources.length > 0 ? { sources } : {}),
        }),
      })
      form.setValue("body", res.body, { shouldDirty: true })
      if (res.description && !form.getValues("description").trim()) {
        form.setValue("description", res.description, { shouldDirty: true })
      }
      if (type === "agent") form.setValue("parallel", res.extra.parallel, { shouldDirty: true })
      if (type === "rule") {
        form.setValue("alwaysApply", res.extra.alwaysApply, { shouldDirty: true })
        if (res.extra.globs.length > 0) form.setValue("globs", res.extra.globs, { shouldDirty: true })
      }
      if (res.links.length > 0) {
        toast.success(`Drafted — linked: ${res.links.map((l) => `${l.to}/${l.toName}`).join(", ")}`)
      } else {
        toast.success(sources.length > 0 ? "Drafted from the videos — review and edit" : "Drafted — review and edit")
      }
      return true
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not draft the body")
      return false
    } finally {
      setGenerating(false)
    }
  }

  function onDraft(): void {
    void draftBody({ name: form.getValues("name"), description: form.getValues("description") })
  }

  async function onDescribe(text: string): Promise<void> {
    const description = text.trim().replace(/\s+/g, " ")
    const suggested = freeName(suggestName(description) || `new-${type}`, takenNames)
    form.reset({ ...emptyValues(type, false), name: suggested, description })
    form.setValue("name", suggested, { shouldDirty: true })
    await draftBody({ name: suggested, description })
    setPhase("edit")
  }

  function onTemplate(template: StarterTemplate): void {
    const next: FormValues = {
      ...emptyValues(type, false),
      name: freeName(template.name, takenNames),
      description: template.description,
      body: template.body,
      tools: template.tools ? [...template.tools] : [...DEFAULT_AGENT_TOOLS],
      parallel: Boolean(template.parallel),
      alwaysApply: Boolean(template.alwaysApply),
      globs: template.globs ? [...template.globs] : [],
    }
    form.reset(emptyValues(type, false))
    for (const [key, value] of Object.entries(next) as Array<[keyof FormValues, FormValues[keyof FormValues]]>) {
      form.setValue(key, value, { shouldDirty: true })
    }
    setPhase("edit")
  }

  function onBlank(): void {
    form.reset(emptyValues(type, false))
    setPhase("edit")
  }

  async function onValidate(): Promise<void> {
    const resolved = resolveWithModel()
    if (!resolved) return
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
      toast.error(err instanceof ApiError ? err.message : "Could not validate the artifact")
    } finally {
      setValidating(false)
    }
  }

  // Chat → editor handoff: the chat stashes a proposed artifact in sessionStorage
  // and routes to /<type>/new. Consume it once and skip the start step.
  React.useEffect(() => {
    if (isEdit) return
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) {
      // A second effect run (Strict Mode) must not undo a draft already consumed.
      setPhase((current) => (current === "edit" ? current : "start"))
      return
    }
    sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    try {
      const parsed = draftSchema.safeParse(JSON.parse(raw))
      if (!parsed.success || parsed.data.type !== type) {
        setPhase("start")
        return
      }
      const draft = normalizeDraft(parsed.data)
      form.reset({
        ...emptyValues(type, false),
        name: draft.name,
        description: draft.description,
        parallel: draft.parallel,
        alwaysApply: draft.alwaysApply,
        globs: draft.globs,
        body: draft.body,
      })
      setPhase("edit")
      toast.success("Draft loaded from the assistant — review and save")
    } catch {
      setPhase("start")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, type])

  React.useEffect(() => {
    if (!isEdit || !workspace) return
    let active = true
    setLoading(true)
    apiFetch<Artifact>(`/api/artifacts/${type}/${encodeURIComponent(name ?? "")}`)
      .then((artifact) => {
        if (!active) return
        platformRef.current = artifact.platform
        const fm = artifact.frontmatter
        const modelFields = modelFormFromFrontmatter(fm.model, fm.provider)
        const loaded: FormValues = {
          name: artifact.name,
          description: artifact.description || artifact.name,
          parallel: Boolean(fm.parallel),
          alwaysApply: Boolean(fm.alwaysApply),
          globs: Array.isArray(fm.globs) ? (fm.globs as string[]) : [],
          tools: Array.isArray(fm.tools) ? fm.tools.filter(isBuiltinToolName) : [...DEFAULT_AGENT_TOOLS],
          mcpServers: Array.isArray(fm.mcpServers)
            ? fm.mcpServers.filter((s): s is string => typeof s === "string")
            : [],
          modelChoice: modelFields.modelChoice,
          modelId: modelFields.modelId,
          modelAlias: modelFields.modelAlias,
          body: artifact.body,
        }
        const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY)
        if (raw) {
          try {
            const parsed = draftSchema.safeParse(JSON.parse(raw))
            if (parsed.success && parsed.data.type === type && parsed.data.name === artifact.name) {
              sessionStorage.removeItem(DRAFT_STORAGE_KEY)
              const draft = normalizeDraft(parsed.data)
              loaded.description = draft.description
              loaded.body = draft.body
              loaded.parallel = draft.parallel
              loaded.alwaysApply = draft.alwaysApply
              loaded.globs = draft.globs
              toast.success("Update loaded from the assistant — review and save")
            }
          } catch {
            // Ignore a malformed handoff and keep the saved artifact.
          }
        }
        form.reset(loaded)
      })
      .catch(() => active && setNotFound(true))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, name, type, workspace])

  const onInvalid = React.useCallback((errors: Record<string, { message?: string }>) => {
    const first = Object.values(errors).find((e) => Boolean(e?.message))
    toast.error(first?.message ?? "Please check the form fields before saving")
  }, [])

  const onSubmit = React.useCallback(
    async (submitted: FormValues) => {
      setSaving(true)
      const payload = {
        type,
        platform: platformRef.current,
        name: submitted.name,
        description: submitted.description,
        body: applyMentions(submitted.body),
        extra: {
          parallel: submitted.parallel,
          alwaysApply: submitted.alwaysApply,
          globs: submitted.globs,
          ...(type === "agent"
            ? { tools: submitted.tools, mcpServers: submitted.mcpServers, ...agentModelExtra(submitted) }
            : {}),
        },
      }
      try {
        if (isEdit) {
          await apiFetch(`/api/artifacts/${type}/${encodeURIComponent(name ?? "")}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        } else {
          await apiFetch("/api/artifacts", { method: "POST", body: JSON.stringify(payload) })
        }
        await refresh()
        form.reset(submitted)
        toast.success(`${meta.label} "${submitted.name}" saved`)
        if (submitted.name !== name) {
          router.push(`/${meta.route}/${encodeURIComponent(submitted.name)}`)
        }
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : `Could not save ${meta.label}`)
      } finally {
        setSaving(false)
      }
    },
    [form, isEdit, meta.label, meta.route, name, refresh, router, type]
  )

  const triggerSubmit = React.useCallback(() => {
    void form.handleSubmit(onSubmit, onInvalid)()
  }, [form, onSubmit, onInvalid])

  React.useEffect(() => {
    if (phase !== "edit") return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        triggerSubmit()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [phase, triggerSubmit])

  React.useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  if (!workspace && !wsLoading) {
    return <NoWorkspace message={`Select a workspace to edit ${meta.labelPlural.toLowerCase()}.`} />
  }

  if (loading || phase === "checking") {
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

  if (phase === "start") {
    return (
      <StartPicker
        type={type}
        hasProvider={assistant.hasProvider}
        providerLoaded={assistant.loaded}
        drafting={generating}
        onDescribe={(text) => void onDescribe(text)}
        onTemplate={onTemplate}
        onBlank={onBlank}
      />
    )
  }

  async function onDelete(): Promise<void> {
    setDeleting(true)
    try {
      await apiFetch(`/api/artifacts/${type}/${encodeURIComponent(name ?? "")}`, { method: "DELETE" })
      await refresh()
      toast.success(`${meta.label} "${name}" deleted`)
      router.push(`/${meta.route}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete")
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  const checks = editorChecks({
    type,
    name: values.name ?? "",
    description: values.description ?? "",
    body: values.body ?? "",
  })
  const facts = factsFor(type, values)
  const draft = buildPayload(values)
  const tryHint = !assistant.hasProvider
    ? "Verify an AI provider to try it."
    : !canTry
      ? "Add a kebab-case name and a description to try it."
      : "Chat with your unsaved changes."
  const bodyCopy = BODY_COPY[type]
  let step = 0
  const nextStep = (): number => ++step

  const draftButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onDraft}
      disabled={!canDraft || generating}
      title={
        !assistant.hasProvider
          ? "Verify an AI provider to enable assistant drafting"
          : !canDraft
            ? canDraftFromVideos
              ? "Enter a valid name first"
              : "Enter a valid name and description first"
            : canDraftFromVideos
              ? "Draft the body from the YouTube videos"
              : "Draft the body from the name and description"
      }
    >
      {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      Draft with assistant
    </Button>
  )

  return (
    <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" type="button">
            <Link href={`/${meta.route}`} aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Icon className={cn("h-5 w-5 shrink-0", meta.colorClass)} />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{isEdit ? name : `New ${meta.label}`}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {isEdit ? `${meta.label} · ${meta.route}` : "Not saved yet"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? (
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex" role="status">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Unsaved changes
            </span>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" aria-label="More actions">
                {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                <span className="hidden sm:inline">More</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem disabled={!canValidate || validating} onSelect={() => void onValidate()}>
                <ShieldCheck className="h-4 w-4" />
                Validate with assistant
              </DropdownMenuItem>
              {isEdit && type === "agent" ? (
                assistant.hasProvider ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/chat?agent=${encodeURIComponent(name ?? "")}`}>
                      <MessageCircle className="h-4 w-4" />
                      Chat with this agent
                    </Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem asChild>
                    <Link href="/providers">
                      <MessageCircle className="h-4 w-4" />
                      Verify provider to chat
                    </Link>
                  </DropdownMenuItem>
                )
              ) : null}
              {isEdit ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="submit" size="sm" disabled={saving} title="Save (⌘S)">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>
      </header>

      <div className="relative flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-10">
            <EditorSection
              id="section-identity"
              step={nextStep()}
              title="Identity"
              description={`The name and a short description of this ${meta.label.toLowerCase()}.`}
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="kebab-case-name"
                    spellCheck={false}
                    autoComplete="off"
                    {...form.register("name", {
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                        if (isEdit) return
                        const next = toKebabWhileTyping(e.target.value)
                        if (next !== e.target.value) form.setValue("name", next, { shouldDirty: true })
                      },
                    })}
                  />
                  {form.formState.errors.name ? (
                    <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Lowercase words with hyphens. It is also the file name.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="description">Description</Label>
                    {type === "skill" ? (
                      <SkillTriggerButton name={values.name ?? ""} description={values.description ?? ""} />
                    ) : null}
                  </div>
                  <Textarea
                    id="description"
                    rows={2}
                    placeholder={DESCRIPTION_HINT[type]}
                    {...form.register("description")}
                  />
                  {form.formState.errors.description ? (
                    <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{DESCRIPTION_HINT[type]}</p>
                  )}
                </div>
              </div>
            </EditorSection>

            {type === "rule" ? (
              <EditorSection
                id="section-activation"
                step={nextStep()}
                title="When does it apply?"
                description="Choose when the assistant adds this rule."
              >
                <RuleActivationField
                  alwaysApply={values.alwaysApply}
                  globs={values.globs}
                  onChange={(next) => {
                    form.setValue("alwaysApply", next.alwaysApply, { shouldDirty: true })
                    form.setValue("globs", next.globs, { shouldDirty: true })
                  }}
                />
              </EditorSection>
            ) : null}

            {type === "skill" && !isEdit ? (
              <EditorSection
                id="section-sources"
                step={nextStep()}
                title="Sources"
                description="Optional: YouTube videos the assistant learns from when it drafts."
              >
                <YouTubeSourcesField onReadyChange={setYoutubeSources} />
              </EditorSection>
            ) : null}

            <EditorSection
              id="section-body"
              step={nextStep()}
              title={bodyCopy.title}
              description={bodyCopy.description}
              actions={
                <>
                  {!isEdit ? draftButton : null}
                  <Tabs value={tab} onValueChange={(v) => setTab(v as "edit" | "preview")}>
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
                </>
              }
            >
              <Controller
                control={form.control}
                name="body"
                render={({ field }) =>
                  tab === "edit" ? (
                    <MarkdownEditor
                      value={field.value}
                      onChange={field.onChange}
                      onSave={triggerSubmit}
                      placeholder={bodyCopy.placeholder}
                      mentions={mentions}
                    />
                  ) : (
                    <MarkdownPreview content={applyMentions(field.value)} />
                  )
                }
              />
            </EditorSection>

            {type === "agent" ? (
              <EditorSection
                id="section-abilities"
                step={nextStep()}
                title="Abilities"
                description="What this agent may do in chats and workflows. Risky actions always ask you first."
              >
                <AbilitiesField
                  tools={values.tools}
                  mcpServers={values.mcpServers}
                  onToolsChange={(tools) => form.setValue("tools", tools, { shouldDirty: true })}
                  onMcpServersChange={(servers) => form.setValue("mcpServers", servers, { shouldDirty: true })}
                />
              </EditorSection>
            ) : null}

            {type === "agent" ? (
              <EditorSection
                id="section-model"
                step={nextStep()}
                title="Model"
                description="Chats with this agent and workflow steps that use it run on this model."
              >
                <div className="space-y-2">
                  <ModelChoiceFields
                    idPrefix="agent-model"
                    selectLabel="Model provider"
                    modelLabel="Agent model"
                    value={values.modelChoice}
                    model={values.modelId}
                    taskChoices={taskModels.choices}
                    onValueChange={(next: ModelSelectValue) => {
                      form.setValue("modelChoice", next, { shouldDirty: true })
                      form.setValue("modelAlias", "", { shouldDirty: true })
                      if (next === "inherit" || isTaskSelectValue(next)) {
                        form.setValue("modelId", "", { shouldDirty: true })
                      }
                    }}
                    onModelChange={(next) => form.setValue("modelId", next, { shouldDirty: true })}
                  />
                  {form.formState.errors.modelId ? (
                    <p className="text-xs text-destructive">{form.formState.errors.modelId.message}</p>
                  ) : null}
                </div>
              </EditorSection>
            ) : null}

            {type === "agent" ? (
              <details className="group rounded-lg border">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
                  Advanced
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="flex items-center justify-between gap-4 border-t px-4 py-3">
                  <div>
                    <Label htmlFor="parallel">Parallel</Label>
                    <p className="text-xs text-muted-foreground">
                      Can run at the same time as other agents in a workflow step.
                    </p>
                  </div>
                  <Controller
                    control={form.control}
                    name="parallel"
                    render={({ field }) => (
                      <Switch id="parallel" checked={field.value} onCheckedChange={field.onChange} />
                    )}
                  />
                </div>
              </details>
            ) : null}
          </div>

          <aside
            aria-label="Summary"
            className={cn(
              "lg:sticky lg:top-6 lg:self-start",
              !tryOpen && "lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto"
            )}
          >
            {tryOpen ? (
              <div className="lg:h-[calc(100vh-10rem)]">
                <TryChatPanel
                  type={type}
                  name={values.name ?? ""}
                  getDraft={() => buildPayload(form.getValues())}
                  resolveProvider={assistant.resolve}
                  onClose={() => setTryOpen(false)}
                />
              </div>
            ) : (
              <EditorSidePanel
                type={type}
                name={values.name ?? ""}
                description={values.description ?? ""}
                facts={facts}
                checks={checks}
                draft={draft}
                originalName={isEdit ? name : undefined}
                canTry={canTry}
                tryHint={tryHint}
                onTry={() => setTryOpen(true)}
                onInsertTemplate={() =>
                  form.setValue("body", STANDARDS_SPEC[type].bodyTemplate(form.getValues("name") || "agent-name"), {
                    shouldDirty: true,
                  })
                }
              />
            )}
          </aside>
        </div>
      </div>

      <DeleteArtifactDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        label={meta.label}
        name={name ?? ""}
        deleting={deleting}
        onDelete={() => void onDelete()}
      />
      <ValidationDialog open={validateOpen} onOpenChange={setValidateOpen} validation={validation} />
    </form>
  )
}

function factsFor(type: ArtifactType, v: FormValues): string[] {
  if (type === "agent") {
    const choice = abilityChoiceOf(v.tools)
    const facts = [choice === "custom" ? "Custom tools" : ABILITY_LEVELS[choice].label]
    facts.push(v.modelChoice === "inherit" ? "Default model" : v.modelId.trim() || v.modelAlias.trim() || "Task model")
    if (v.mcpServers.length > 0) facts.push(`${v.mcpServers.length} MCP server${v.mcpServers.length === 1 ? "" : "s"}`)
    if (v.parallel) facts.push("Parallel")
    return facts
  }
  if (type === "rule") {
    const activation = ruleActivationOf(v.alwaysApply, v.globs)
    if (activation === "always") return ["Always applies"]
    if (activation === "files") return [`${v.globs.length} file pattern${v.globs.length === 1 ? "" : "s"}`]
    return ["On request"]
  }
  return []
}
