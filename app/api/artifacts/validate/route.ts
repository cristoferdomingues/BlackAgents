import { ok, fail, handle } from "@/lib/api-response"
import { getProvider, isProviderId } from "@/lib/llm/registry"
import { buildSystemContext } from "@/lib/llm/context"
import {
  CredentialStateError,
  getVerifiedCredentials,
  markInvalidOnAuthFailure,
} from "@/lib/llm/credentials"
import { artifactTypeSchema, nameSchema } from "@/lib/artifacts/schemas"
import {
  VALIDATION_FENCE,
  extractValidation,
  type ValidationResult,
} from "@/lib/llm/validation"
import { ProviderError } from "@/lib/llm/types"
import type { ArtifactType } from "@/lib/artifacts/types"

interface ValidateRequest {
  type?: string
  name?: string
  description?: string
  body?: string
  extra?: {
    parallel?: boolean
    alwaysApply?: boolean
    globs?: string[]
  }
  provider?: string
  model?: string
}

/** A compact, human-readable rendering of the artifact under review. */
function renderArtifact(
  type: ArtifactType,
  name: string,
  description: string,
  body: string,
  extra: ValidateRequest["extra"]
): string {
  const flags: string[] = []
  if (type === "agent" && extra?.parallel) flags.push("parallel: true")
  if (type === "rule" && extra?.alwaysApply) flags.push("alwaysApply: true")
  if (type === "rule" && extra?.globs && extra.globs.length > 0) {
    flags.push(`globs: ${extra.globs.join(", ")}`)
  }
  const flagLine = flags.length > 0 ? `\nFlags: ${flags.join("; ")}` : ""
  return `Type: ${type}\nName: ${name}\nDescription: ${description}${flagLine}\n\nBody:\n${body}`
}

function buildInstruction(
  type: ArtifactType,
  name: string,
  description: string,
  body: string,
  extra: ValidateRequest["extra"]
): string {
  return `Review the following ${type} against the authoring standards and the artifacts already in the workspace. Do NOT rewrite it — only report findings.

${renderArtifact(type, name, description, body, extra)}

Check for:
- Missing or weak required sections for a ${type}.
- Anti-patterns for this type (e.g. an agent embedding rule-level conventions, a rule that should be a skill, a command containing domain logic).
- Wrong artifact type or scope creep (doing multiple unrelated things).
- Cross-reference issues: it should reference existing artifacts by name using the conventions, and must not reference artifacts that do not exist in the workspace list above.
- Description quality (it is also the assistant's discovery trigger).

Respond with a single fenced \`${VALIDATION_FENCE}\` block containing JSON of this shape:

\`\`\`${VALIDATION_FENCE}
{
  "summary": "one-line overall assessment",
  "findings": [
    { "severity": "error" | "warning" | "info", "section": "optional aspect", "message": "what is wrong", "suggestion": "optional concrete fix" }
  ]
}
\`\`\`

Order findings by severity (error first). If the artifact is already consistent with the standards, return an empty "findings" array and say so in "summary". Emit at most one block and no prose outside it.`
}

/**
 * Assistant-guided validation. Reads the artifact from the request, injects the
 * standards + workspace registry as system context, and returns a read-only
 * findings report. The API key stays server-side, exactly like /api/chat.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => null)) as ValidateRequest | null
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

    const artifactBody = body.body ?? ""
    if (!artifactBody.trim()) return fail("There is no body to validate")

    if (!body.provider || !isProviderId(body.provider)) {
      return fail("Unknown provider")
    }
    const provider = getProvider(body.provider)
    if (!provider) return fail("Unknown provider")

    const model = body.model?.trim() || provider.models[0]
    if (!model) return fail("A model is required for this provider")

    let verified: Awaited<ReturnType<typeof getVerifiedCredentials>>
    try {
      verified = await getVerifiedCredentials(provider)
    } catch (error) {
      if (error instanceof CredentialStateError) {
        return fail(error.message, error.status)
      }
      throw error
    }

    const systemContext = await buildSystemContext()

    let content: string
    try {
      const result = await provider.generate(
        {
          model,
          messages: [
            {
              role: "user",
              content: buildInstruction(
                type,
                name,
                description,
                artifactBody,
                body.extra
              ),
            },
          ],
          systemContext,
        },
        verified.credentials
      )
      content = result.content
    } catch (err) {
      if (err instanceof ProviderError) {
        await markInvalidOnAuthFailure(provider, err, verified.secret)
        return fail(err.message, err.status)
      }
      throw err
    }

    const parsed = extractValidation(content)
    const response: ValidationResult = parsed ?? {
      // The model ignored the protocol — surface its prose as a single note
      // rather than failing the request.
      summary: undefined,
      findings: [{ severity: "info", message: content.trim() }],
    }

    return ok(response)
  })
}
