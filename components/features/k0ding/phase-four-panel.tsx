"use client"

import * as React from "react"
import { BookOpen, Save, Sparkles, Unplug } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { apiFetch, ApiError } from "@/lib/api"
import type { Artifact } from "@/lib/artifacts/types"
import type { ArtifactDraft } from "@/lib/llm/draft"
import { DRAFT_STORAGE_KEY } from "@/lib/llm/draft"
import { WORKFLOW_DRAFT_STORAGE_KEY } from "@/lib/llm/workflow-draft"
import type { Workflow } from "@/lib/workflows/schema"
import type { CodeRoot, CodingSessionView, GuidancePick } from "@/lib/k0ding/schema"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

interface McpCandidate {
  detected: boolean
  packageManager: "npm" | "pnpm" | "yarn" | "bun"
  scripts: string[]
  existingServer: boolean
}

interface PhaseFourPanelProps {
  root: CodeRoot
  session: CodingSessionView | null
  artifacts: Artifact[]
  guidance: GuidancePick[]
  onGuidance: (items: GuidancePick[]) => void
}

export function PhaseFourPanel(props: PhaseFourPanelProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="w-full">
          <Sparkles className="h-4 w-4" />
          Project tools
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>K0ding project tools</DialogTitle>
          <DialogDescription>Add project notes, guidance, an MCP server, or save this work for later.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="notes">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="guidance">Guidance</TabsTrigger>
            <TabsTrigger value="mcp">MCP</TabsTrigger>
            <TabsTrigger value="save">Save as</TabsTrigger>
          </TabsList>
          <TabsContent value="notes"><NotesTab rootId={props.root.id} /></TabsContent>
          <TabsContent value="guidance">
            <GuidanceTab artifacts={props.artifacts} selected={props.guidance} onChange={props.onGuidance} />
          </TabsContent>
          <TabsContent value="mcp"><McpTab root={props.root} /></TabsContent>
          <TabsContent value="save"><SaveAsTab session={props.session} artifacts={props.artifacts} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function NotesTab({ rootId }: { rootId: string }): React.ReactElement {
  const [content, setContent] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    apiFetch<{ content: string }>(`/api/k0ding/roots/${rootId}/notes`)
      .then((data) => {
        if (!cancelled) setContent(data.content)
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(err instanceof ApiError ? err.message : "Could not load notes")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [rootId])

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await apiFetch(`/api/k0ding/roots/${rootId}/notes`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      })
      toast.success("Project notes saved")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save notes")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 pt-3">
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0" />
        These notes are sent to the model each turn. They are saved in BlackAgents, outside the code folder.
      </div>
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        disabled={loading}
        rows={12}
        maxLength={20_000}
        placeholder={"# Stack\n\n# Useful commands\n\n# Folder roles"}
        aria-label="Project notes"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{content.length.toLocaleString()} / 20,000</span>
        <Button type="button" onClick={() => void save()} disabled={loading || saving}>
          <Save className="h-4 w-4" />
          Save notes
        </Button>
      </div>
    </div>
  )
}

function GuidanceTab({
  artifacts,
  selected,
  onChange,
}: {
  artifacts: Artifact[]
  selected: GuidancePick[]
  onChange: (items: GuidancePick[]) => void
}): React.ReactElement {
  const choices = artifacts.filter((item) => item.type === "agent" || item.type === "rule" || item.type === "skill")
  const always = choices.filter((item) => item.type === "rule" && item.frontmatter.alwaysApply === true)

  function toggle(artifact: Artifact): void {
    const key = `${artifact.type}:${artifact.name}`
    const exists = selected.some((item) => `${item.type}:${item.name}` === key)
    onChange(exists ? selected.filter((item) => `${item.type}:${item.name}` !== key) : [...selected, { type: artifact.type as GuidancePick["type"], name: artifact.name }])
  }

  return (
    <div className="space-y-3 pt-3">
      <p className="text-sm text-muted-foreground">Choose agents, rules, or skills to guide this coding session. Always rules are added by the server.</p>
      {always.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {always.map((item) => <Badge key={`always:${item.name}`} variant="secondary">{item.name} · Always</Badge>)}
        </div>
      ) : null}
      <div className="max-h-72 space-y-1 overflow-y-auto rounded border p-2">
        {choices.length === 0 ? <p className="p-2 text-sm text-muted-foreground">Create an agent, rule, or skill first.</p> : null}
        {choices.map((item) => {
          const active = selected.some((entry) => entry.type === item.type && entry.name === item.name)
          return (
            <button
              key={`${item.type}:${item.name}`}
              type="button"
              className={`flex w-full items-start justify-between rounded px-2 py-2 text-left text-sm ${active ? "bg-accent" : "hover:bg-accent/60"}`}
              onClick={() => toggle(item)}
            >
              <span><span className="font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{item.description || `Workspace ${item.type}`}</span></span>
              <Badge variant={active ? "default" : "outline"}>{item.type}</Badge>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function McpTab({ root }: { root: CodeRoot }): React.ReactElement {
  const [candidate, setCandidate] = React.useState<McpCandidate | null>(null)
  const [script, setScript] = React.useState("")
  const [name, setName] = React.useState(root.id)
  const [busy, setBusy] = React.useState(false)
  const [tools, setTools] = React.useState<string[]>([])

  React.useEffect(() => {
    let cancelled = false
    apiFetch<McpCandidate>(`/api/k0ding/roots/${root.id}/mcp`)
      .then((data) => {
        if (cancelled) return
        setCandidate(data)
        setScript(data.scripts.find((item) => ["mcp", "start", "serve"].includes(item)) ?? data.scripts[0] ?? "")
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(err instanceof ApiError ? err.message : "Could not inspect this project")
      })
    return () => {
      cancelled = true
    }
  }, [root.id])

  async function connect(): Promise<void> {
    if (!script) return
    setBusy(true)
    try {
      const result = await apiFetch<{ name: string; tools: Array<{ name: string }> }>(`/api/k0ding/roots/${root.id}/mcp`, {
        method: "POST",
        body: JSON.stringify({ name, script }),
      })
      setTools(result.tools.map((tool) => tool.name))
      toast.success(`MCP server saved with ${result.tools.length} tools`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "The MCP server did not connect")
    } finally {
      setBusy(false)
    }
  }

  if (!candidate) return <p className="pt-3 text-sm text-muted-foreground">Checking package.json…</p>
  if (!candidate.detected) return <p className="pt-3 text-sm text-muted-foreground">This project does not use @modelcontextprotocol/sdk.</p>
  return (
    <div className="space-y-3 pt-3">
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <Unplug className="mt-0.5 h-4 w-4 shrink-0" />
        Test a package script as an MCP server. It is saved only after it connects. Tool calls use trust “ask”.
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="mcp-name">Server name</Label><Input id="mcp-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
        <div className="space-y-1">
          <Label>Package script</Label>
          <Select value={script} onValueChange={setScript}>
            <SelectTrigger aria-label="Package script"><SelectValue placeholder="Choose a script" /></SelectTrigger>
            <SelectContent>{candidate.scripts.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <p className="rounded bg-muted p-2 font-mono text-xs">{candidate.packageManager} · {root.path} · {script}</p>
      {candidate.existingServer ? (
        <p className="text-xs text-muted-foreground">A server with this code-folder name already exists. Saving the same name replaces it after the new test passes.</p>
      ) : null}
      <Button type="button" disabled={busy || !name.trim() || !script} onClick={() => void connect()}>Test and save</Button>
      {tools.length > 0 ? <div><p className="text-sm font-medium">Tools</p><div className="mt-1 flex flex-wrap gap-1">{tools.map((tool) => <Badge key={tool} variant="secondary">{tool}</Badge>)}</div></div> : null}
    </div>
  )
}

function SaveAsTab({ session, artifacts }: { session: CodingSessionView | null; artifacts: Artifact[] }): React.ReactElement {
  const router = useRouter()
  const [kind, setKind] = React.useState<"skill" | "workflow">("skill")
  const [name, setName] = React.useState("")
  const agents = artifacts.filter((item) => item.type === "agent")
  const [agent, setAgent] = React.useState(agents[0]?.name ?? "")

  async function createDraft(): Promise<void> {
    if (!session) return
    try {
      const result = await apiFetch<{ kind: "skill"; draft: ArtifactDraft } | { kind: "workflow"; workflow: Workflow }>(
        `/api/k0ding/sessions/${session.id}/draft`,
        { method: "POST", body: JSON.stringify(kind === "skill" ? { kind, name } : { kind, name, agent }) }
      )
      if (result.kind === "skill") {
        sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(result.draft))
        router.push("/skills/new")
      } else {
        sessionStorage.setItem(WORKFLOW_DRAFT_STORAGE_KEY, JSON.stringify(result.workflow))
        router.push("/workflows/new")
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create the draft")
    }
  }

  return (
    <div className="space-y-3 pt-3">
      <p className="text-sm text-muted-foreground">Create a draft from this session. You review and save it on the next page. Code and tool output are not copied.</p>
      {!session ? <p className="rounded border p-3 text-sm text-muted-foreground">Start a K0ding session first.</p> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Kind</Label><Select value={kind} onValueChange={(value) => setKind(value as "skill" | "workflow")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="skill">Skill</SelectItem><SelectItem value="workflow">Workflow</SelectItem></SelectContent></Select></div>
            <div className="space-y-1"><Label htmlFor="draft-name">Name</Label><Input id="draft-name" value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} placeholder="fix-typescript-errors" /></div>
          </div>
          {kind === "workflow" ? <div className="space-y-1"><Label>Agent</Label><Select value={agent} onValueChange={setAgent}><SelectTrigger><SelectValue placeholder="Choose an agent" /></SelectTrigger><SelectContent>{agents.map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select></div> : null}
          <Button type="button" onClick={() => void createDraft()} disabled={!name || (kind === "workflow" && !agent)}>Create draft</Button>
        </>
      )}
    </div>
  )
}
