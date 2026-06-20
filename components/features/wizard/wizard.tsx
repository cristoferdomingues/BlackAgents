"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { apiFetch, ApiError } from "@/lib/api"
import { ARTIFACT_TYPE_LIST, metaForType } from "@/lib/artifacts/constants"
import { nameSchema } from "@/lib/artifacts/schemas"
import { STANDARDS_SPEC } from "@/lib/standards/default-standards"
import type { ArtifactType } from "@/lib/artifacts/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { MarkdownEditor } from "@/components/features/editor/markdown-editor"
import { GlobsInput } from "@/components/features/editor/globs-input"
import { StandardsHints } from "@/components/features/editor/standards-hints"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const STEPS = ["Type", "Details", "Body", "Review"] as const

export function Wizard({ initialType }: { initialType?: ArtifactType }) {
  const router = useRouter()
  const { workspace, loading: wsLoading, refresh } = useWorkspace()

  const [step, setStep] = React.useState(initialType ? 1 : 0)
  const [type, setType] = React.useState<ArtifactType | null>(
    initialType ?? null
  )
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [parallel, setParallel] = React.useState(false)
  const [alwaysApply, setAlwaysApply] = React.useState(false)
  const [globs, setGlobs] = React.useState<string[]>([])
  const [body, setBody] = React.useState("")
  const [bodyTouched, setBodyTouched] = React.useState(false)
  const [creating, setCreating] = React.useState(false)

  const nameError =
    name.length > 0 && !nameSchema.safeParse(name).success
      ? "Use kebab-case (lowercase, digits, single hyphens)"
      : null

  function chooseType(t: ArtifactType) {
    setType(t)
    if (!bodyTouched) setBody(STANDARDS_SPEC[t].bodyTemplate(name || "agent-name"))
    setStep(1)
  }

  function goToBody() {
    if (type && !bodyTouched) {
      setBody(STANDARDS_SPEC[type].bodyTemplate(name || "agent-name"))
    }
    setStep(2)
  }

  async function create() {
    if (!type) return
    setCreating(true)
    try {
      await apiFetch("/api/artifacts", {
        method: "POST",
        body: JSON.stringify({
          type,
          platform: "cursor",
          name,
          description,
          body,
          extra: { parallel, alwaysApply, globs },
        }),
      })
      await refresh()
      toast.success(`${metaForType(type).label} "${name}" created`)
      router.push(`/${metaForType(type).route}/${name}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create")
      setCreating(false)
    }
  }

  if (!workspace && !wsLoading) {
    return <NoWorkspace message="Select a workspace before creating artifacts." />
  }

  const canDetails = type !== null
  const canBody = canDetails && name.length > 0 && !nameError && description.trim()

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" />
          Guided creation
        </h1>
        <p className="text-sm text-muted-foreground">
          Create a new artifact step by step, aligned with the authoring
          standards.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium",
                  i < step && "border-primary bg-primary text-primary-foreground",
                  i === step && "border-primary text-primary",
                  i > step && "border-border text-muted-foreground"
                )}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-sm",
                  i === step ? "font-medium" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 ? (
              <div className="h-px flex-1 bg-border" />
            ) : null}
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      {step === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {ARTIFACT_TYPE_LIST.map((meta) => {
            const Icon = meta.icon
            return (
              <Card
                key={meta.type}
                role="button"
                tabIndex={0}
                onClick={() => chooseType(meta.type)}
                onKeyDown={(e) => e.key === "Enter" && chooseType(meta.type)}
                className="cursor-pointer transition-colors hover:border-primary/60"
              >
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Icon className={cn("h-5 w-5", meta.colorClass)} />
                  </div>
                  <div>
                    <p className="font-medium">{meta.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {meta.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : null}

      {step === 1 && type ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wiz-name">Name</Label>
              <Input
                id="wiz-name"
                placeholder="kebab-case-name"
                spellCheck={false}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {nameError ? (
                <p className="text-xs text-destructive">{nameError}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="wiz-desc">Description</Label>
              <Textarea
                id="wiz-desc"
                rows={2}
                placeholder="One-line summary."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            {type === "agent" ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label htmlFor="wiz-parallel">Parallel</Label>
                <Switch
                  id="wiz-parallel"
                  checked={parallel}
                  onCheckedChange={setParallel}
                />
              </div>
            ) : null}
            {type === "rule" ? (
              <>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <Label htmlFor="wiz-always">Always apply</Label>
                  <Switch
                    id="wiz-always"
                    checked={alwaysApply}
                    onCheckedChange={setAlwaysApply}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Globs</Label>
                  <GlobsInput value={globs} onChange={setGlobs} />
                </div>
              </>
            ) : null}
          </div>
          <div className="lg:border-l lg:pl-6">
            <StandardsHints type={type} body={body} />
          </div>
        </div>
      ) : null}

      {step === 2 && type ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-2">
            <Label>Body</Label>
            <MarkdownEditor
              value={body}
              onChange={(v) => {
                setBody(v)
                setBodyTouched(true)
              }}
            />
          </div>
          <div className="lg:border-l lg:pl-6">
            <StandardsHints
              type={type}
              body={body}
              onInsertTemplate={() => {
                setBody(STANDARDS_SPEC[type].bodyTemplate(name || "agent-name"))
                setBodyTouched(true)
              }}
            />
          </div>
        </div>
      ) : null}

      {step === 3 && type ? (
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <Row label="Type">
              <Badge variant="secondary">{metaForType(type).label}</Badge>
            </Row>
            <Row label="Name">
              <code>{name}</code>
            </Row>
            <Row label="Description">{description}</Row>
            {type === "agent" && parallel ? (
              <Row label="Parallel">yes</Row>
            ) : null}
            {type === "rule" ? (
              <Row label="Activation">
                {alwaysApply
                  ? "always"
                  : globs.length
                    ? `${globs.length} glob(s)`
                    : "on-request"}
              </Row>
            ) : null}
            <Row label="Body">
              <span className="text-muted-foreground">
                {body.trim().split("\n").length} lines
              </span>
            </Row>
          </CardContent>
        </Card>
      ) : null}

      {/* Nav */}
      <div className="flex items-center justify-between border-t pt-4">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || creating}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        {step === 0 ? (
          <span className="text-sm text-muted-foreground">
            Select an artifact type to begin
          </span>
        ) : step === 1 ? (
          <Button onClick={goToBody} disabled={!canBody}>
            Next
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : step === 2 ? (
          <Button onClick={() => setStep(3)} disabled={!canBody}>
            Review
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={create} disabled={creating || !canBody}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Create {type ? metaForType(type).label : ""}
          </Button>
        )}
      </div>
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}
