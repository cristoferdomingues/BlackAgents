"use client"

import * as React from "react"
import { Eye, Loader2, Pencil, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { apiFetch, ApiError } from "@/lib/api"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { MarkdownEditor } from "@/components/features/editor/markdown-editor"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface StandardsDoc {
  content: string
  custom: boolean
}

export function StandardsPage() {
  const { workspace, loading: wsLoading } = useWorkspace()
  const [doc, setDoc] = React.useState<StandardsDoc | null>(null)
  const [content, setContent] = React.useState("")
  const [tab, setTab] = React.useState<"edit" | "preview">("preview")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<StandardsDoc>("/api/standards")
      setDoc(data)
      setContent(data.content)
    } catch {
      setDoc(null)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (workspace) void load()
  }, [workspace, load])

  if (!workspace && !wsLoading) {
    return <NoWorkspace message="Select a workspace to view its authoring standards." />
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading standards…
      </div>
    )
  }

  async function save() {
    setSaving(true)
    try {
      const data = await apiFetch<StandardsDoc>("/api/standards", {
        method: "PUT",
        body: JSON.stringify({ content }),
      })
      setDoc(data)
      toast.success("Standards saved to this workspace")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    setSaving(true)
    try {
      const data = await apiFetch<StandardsDoc>("/api/standards", {
        method: "DELETE",
      })
      setDoc(data)
      setContent(data.content)
      toast.success("Reset to the built-in standards")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not reset")
    } finally {
      setSaving(false)
    }
  }

  const dirty = doc ? content !== doc.content : false

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            Authoring standards
            <Badge variant={doc?.custom ? "default" : "secondary"}>
              {doc?.custom ? "Workspace override" : "Built-in default"}
            </Badge>
          </h1>
          <p className="text-xs text-muted-foreground">
            The baseline that guides artifact creation. Stored at{" "}
            <code>.black-agents/standards.md</code> when customized.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          {doc?.custom ? (
            <Button variant="outline" size="sm" onClick={reset} disabled={saving}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          ) : null}
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto p-6">
        {tab === "edit" ? (
          <MarkdownEditor value={content} onChange={setContent} />
        ) : (
          <div className="prose-ba rounded-md border p-6">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
