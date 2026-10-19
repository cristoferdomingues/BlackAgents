import { linkedConceptIds } from "../knowledge/checks"
import type {
  Artifact,
  ArtifactReference,
  ArtifactType,
  GraphData,
  GraphLink,
  GraphNode,
} from "./types"
import { artifactId } from "./types"

/** A knowledge concept drawn on the same graph as artifacts. */
export interface GraphConcept {
  id: string
  title?: string
  body: string
}

/**
 * Extract cross-references between artifacts using the authoring conventions:
 *
 * - Command -> Agent: agent name in **bold** ("invoke the **agent-name** agent")
 * - Agent  -> Rule:   `rule-name` followed by the word "rule"
 * - Agent  -> Skill:  `skill-name` followed by the word "skill"
 * - Rule   -> Rule:   "Related rules: a, b"
 * - Rule   -> Skill:  "See also: x skill"
 *
 * Names are resolved against the actual artifact registry, so a token only
 * becomes an edge when a matching artifact of the expected type exists.
 *
 * Resolution is scope-first: a project artifact matches its own project's
 * entry, then a workspace entry. A workspace artifact only matches workspace
 * entries, and projects never see each other.
 */

const TOKEN = "[a-z0-9][a-z0-9-]*"
const BOLD_RE = new RegExp(`\\*\\*(${TOKEN})\\*\\*`, "g")
const BACKTICK_RULE_RE = new RegExp("`(" + TOKEN + ")`\\s+rules?\\b", "gi")
const BACKTICK_SKILL_RE = new RegExp("`(" + TOKEN + ")`\\s+skill\\b", "gi")
const RELATED_RULES_RE = /related rules:\s*([^\n]+)/gi
const SEE_ALSO_RE = /see also:\s*([^\n]+)/gi

/** Graph node id. Workspace ids stay `type:name`; project ids add `@project`. */
export function nodeRefId(type: ArtifactType, name: string, scope?: string): string {
  const id = artifactId(type, name)
  return scope ? `${id}@${scope}` : id
}

type Registry = Record<ArtifactType, Map<string, Array<string | undefined>>>

function buildRegistry(artifacts: Artifact[]): Registry {
  const registry: Registry = {
    agent: new Map(),
    command: new Map(),
    rule: new Map(),
    skill: new Map(),
  }
  for (const a of artifacts) {
    const scopes = registry[a.type].get(a.name) ?? []
    scopes.push(a.scope?.project)
    registry[a.type].set(a.name, scopes)
  }
  return registry
}

/**
 * Scope the name resolves in, or `null` when it is not visible from `fromScope`.
 * Returns `undefined` for a workspace match.
 */
function resolveScope(
  registry: Registry,
  type: ArtifactType,
  name: string,
  fromScope: string | undefined
): string | undefined | null {
  const scopes = registry[type].get(name)
  if (!scopes) return null
  if (fromScope && scopes.includes(fromScope)) return fromScope
  return scopes.includes(undefined) ? undefined : null
}

function matchAll(re: RegExp, text: string): string[] {
  const out: string[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push(m[1])
  }
  return out
}

function kindFor(
  source: ArtifactType,
  target: ArtifactType
): ArtifactReference["kind"] {
  if (target === "agent") return "command-agent"
  if (target === "rule") return source === "rule" ? "rule-rule" : "agent-rule"
  return source === "rule" ? "rule-skill" : "agent-skill"
}

export function extractReferences(
  artifacts: Artifact[]
): ArtifactReference[] {
  const registry = buildRegistry(artifacts)
  const refs: ArtifactReference[] = []
  const seen = new Set<string>()

  function add(
    from: Artifact,
    targetType: ArtifactType,
    toName: string
  ) {
    const fromScope = from.scope?.project
    const toScope = resolveScope(registry, targetType, toName, fromScope)
    if (toScope === null) return
    if (from.type === targetType && from.name === toName && fromScope === toScope) return
    const key = `${nodeRefId(from.type, from.name, fromScope)}->${nodeRefId(targetType, toName, toScope)}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({
      from: from.type,
      fromName: from.name,
      ...(fromScope ? { fromScope } : {}),
      to: targetType,
      toName,
      ...(toScope ? { toScope } : {}),
      kind: kindFor(from.type, targetType),
    })
  }

  for (const artifact of artifacts) {
    const body = artifact.body

    // Agents/commands invoke agents by **bold** name.
    for (const token of matchAll(BOLD_RE, body)) {
      add(artifact, "agent", token)
    }

    // `name` rule / `name` skill.
    for (const token of matchAll(BACKTICK_RULE_RE, body)) {
      add(artifact, "rule", token)
    }
    for (const token of matchAll(BACKTICK_SKILL_RE, body)) {
      add(artifact, "skill", token)
    }

    // Related rules: a, b, c
    for (const line of matchAll(RELATED_RULES_RE, body)) {
      for (const token of line.split(/[,;]/)) {
        const name = token.trim().replace(/[`*.]/g, "")
        if (name) add(artifact, "rule", name)
      }
    }

    // See also: x skill, y skill
    for (const line of matchAll(SEE_ALSO_RE, body)) {
      for (const token of matchAll(new RegExp(`(${TOKEN})`, "g"), line)) {
        add(artifact, "skill", token)
      }
    }
  }

  return refs
}

export function buildGraph(artifacts: Artifact[], concepts: GraphConcept[] = []): GraphData {
  const references = extractReferences(artifacts)
  const registry = buildRegistry(artifacts)
  const conceptIds = new Set(concepts.map((concept) => concept.id))

  const nodes: Record<string, GraphNode> = {}
  for (const a of artifacts) {
    const scope = a.scope?.project
    const id = nodeRefId(a.type, a.name, scope)
    nodes[id] = { id, name: a.name, type: a.type, ...(scope ? { scope } : {}), degree: 0 }
  }
  for (const concept of concepts) {
    const id = `concept:${concept.id}`
    const name = concept.title?.trim() || concept.id.split("/").at(-1) || concept.id
    nodes[id] = { id, name, type: "concept", degree: 0 }
  }

  const links: GraphLink[] = []
  const seen = new Set<string>()
  function connect(source: string, target: string, kind: GraphLink["kind"]): void {
    if (!nodes[source] || !nodes[target] || source === target) return
    const key = `${source}->${target}:${kind}`
    if (seen.has(key)) return
    seen.add(key)
    nodes[source].degree += 1
    nodes[target].degree += 1
    links.push({ source, target, kind })
  }

  for (const ref of references) {
    connect(
      nodeRefId(ref.from, ref.fromName, ref.fromScope),
      nodeRefId(ref.to, ref.toName, ref.toScope),
      ref.kind
    )
  }

  const conceptLinks: Array<[RegExp, ArtifactType]> = [
    [BOLD_RE, "agent"],
    [BACKTICK_RULE_RE, "rule"],
    [BACKTICK_SKILL_RE, "skill"],
  ]
  for (const concept of concepts) {
    const source = `concept:${concept.id}`
    for (const target of linkedConceptIds(concept.id, concept.body)) {
      if (conceptIds.has(target)) connect(source, `concept:${target}`, "concept-concept")
    }
    for (const [re, type] of conceptLinks) {
      for (const token of matchAll(re, concept.body)) {
        const scope = resolveScope(registry, type, token, undefined)
        if (scope !== null) connect(source, nodeRefId(type, token, scope), "concept-artifact")
      }
    }
  }

  for (const artifact of artifacts) {
    const source = nodeRefId(artifact.type, artifact.name, artifact.scope?.project)
    for (const target of linkedConceptIds("", artifact.body)) {
      if (conceptIds.has(target)) connect(source, `concept:${target}`, "artifact-concept")
    }
  }

  return { nodes: Object.values(nodes), links }
}
