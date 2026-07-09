import { ok, fail, handle } from "@/lib/api-response"
import { getProvider, isProviderId } from "@/lib/llm/registry"
import { buildSystemContext } from "@/lib/llm/context"
import { getProviderSecret } from "@/lib/secrets"
import { readConfig } from "@/lib/config"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { extractReferences } from "@/lib/artifacts/graph"
import { extractDraft, stripDraftBlock } from "@/lib/llm/draft"
import { nameSchema, artifactTypeSchema } from "@/lib/artifacts/schemas"
import { ProviderError } from "@/lib/llm/types"
import type { Artifact, ArtifactType } from "@/lib/artifacts/types"

interface DraftBodyRequest {
  type?: string
  name?: string
  description?: string
  provider?: string
  model?: string
}

/**
 * Build the user instruction that steers the assistant to draft a single
 * artifact body from a name + description and cross-link relevant existing
 * workspace artifacts. The system context (standards + registry + the
 * `artifact` draft protocol) is injected separately by buildSystemContext.
 */
function buildInstruction(
  type: ArtifactType,
  name: string,
  description: string
): string {
  return `Draft the body for a new ${type} named "${name}".

Description: ${description}

Requirements:
- Emit exactly one fenced \`artifact\` block with the JSON draft (type "${type}", name "${name}", the given description, and a complete markdown body).
- Follow the authoring standards and required sections for a ${type}.
- Review the "Artifacts in the active workspace" list above and, where it genuinely helps, reference relevant existing artifacts by name using the cross-reference conventions (bold agent names for commands/agents, \`rule-name\` rule, \`skill-name\` skill, "Related rules:", "See also:"). Only link artifacts that actually exist in that list.`
}

/**
 * Assistant-guided artifact body drafting. Mirrors /api/chat: the API key stays
 * server-side, and the standards + workspace registry are injected as system
 * context. Returns the generated markdown body, the type-specific frontmatter
 * flags the assistant inferred, and any existing artifacts the draft links to.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => null)) as DraftBodyRequest | null
    if (!body) return fail("Invalid request body")

    const typeParsed = artifactTypeSchema.safeParse(body.type)
    if (!typeParsed.success) return fail("Unknown artifact type")
    const type = typeParsed.data

    const nameParsed = nameSchema.safeParse(body.name)
    if (!nameParsed.success) {
      return fail(nameParsed.error.issues[0]?.message ?? "Invalid name")
    }
    const name = nameParsed.data

    const description = body.description?.trim() ?? ""
    if (!description) return fail("Description is required")

    if (!body.provider || !isProviderId(body.provider)) {
      return fail("Unknown provider")
    }
    const provider = getProvider(body.provider)
    if (!provider) return fail("Unknown provider")

    const model = body.model?.trim() || provider.models[0]
    if (!model) return fail("A model is required for this provider")

    const secret = await getProviderSecret(provider.id)
    if (provider.requiresBaseUrl && !secret?.baseUrl) {
      return fail(`Configure a base URL for ${provider.label} first`, 412)
    }
    if (!provider.requiresBaseUrl && !secret?.apiKey) {
      return fail(`No API key configured for ${provider.label}`, 412)
    }

    const systemContext = await buildSystemContext()

    let content: string
    try {
      const result = await provider.generate(
        {
          model,
          messages: [
            { role: "user", content: buildInstruction(type, name, description) },
          ],
          systemContext,
        },
        { apiKey: secret?.apiKey ?? "", baseUrl: secret?.baseUrl }
      )
      content = result.content
    } catch (err) {
      if (err instanceof ProviderError) return fail(err.message, err.status)
      throw err
    }

    const draft = extractDraft(content)
    const generatedBody = draft?.body ?? stripDraftBlock(content)
    if (!generatedBody.trim()) {
      return fail("The assistant did not return a usable draft", 502)
    }

    const extra = {
      parallel: draft?.parallel ?? false,
      alwaysApply: draft?.alwaysApply ?? false,
      globs: draft?.globs ?? [],
    }

    const links = await detectLinks(type, name, generatedBody)

    return ok({ body: generatedBody, extra, links })
  })
}

/**
 * Resolve which existing workspace artifacts the generated body links to by
 * running the cross-reference extractor over the workspace plus a synthetic
 * node for the artifact being drafted.
 */
async function detectLinks(
  type: ArtifactType,
  name: string,
  generatedBody: string
) {
  const config = await readConfig()
  if (!config.currentPath) return []

  const existing = await scanWorkspace(config.currentPath)
  // Skip a same-name/type artifact already on disk so the synthetic draft wins.
  const others = existing.filter((a) => !(a.type === type && a.name === name))

  const synthetic: Artifact = {
    name,
    type,
    platform: "cursor",
    description: "",
    frontmatter: {},
    body: generatedBody,
    relativePath: `__draft__/${type}/${name}`,
  }

  return extractReferences([...others, synthetic])
    .filter((ref) => ref.from === type && ref.fromName === name)
    .map((ref) => ({ to: ref.to, toName: ref.toName, kind: ref.kind }))
}
