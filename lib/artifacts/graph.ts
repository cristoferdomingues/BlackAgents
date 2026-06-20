import type {
  Artifact,
  ArtifactReference,
  ArtifactType,
  GraphData,
  GraphLink,
  GraphNode,
} from "./types"
import { artifactId } from "./types"

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
 */

const TOKEN = "[a-z0-9][a-z0-9-]*"
const BOLD_RE = new RegExp(`\\*\\*(${TOKEN})\\*\\*`, "g")
const BACKTICK_RULE_RE = new RegExp("`(" + TOKEN + ")`\\s+rules?\\b", "gi")
const BACKTICK_SKILL_RE = new RegExp("`(" + TOKEN + ")`\\s+skill\\b", "gi")
const RELATED_RULES_RE = /related rules:\s*([^\n]+)/gi
const SEE_ALSO_RE = /see also:\s*([^\n]+)/gi

function buildRegistry(artifacts: Artifact[]): Record<ArtifactType, Set<string>> {
  const registry: Record<ArtifactType, Set<string>> = {
    agent: new Set(),
    command: new Set(),
    rule: new Set(),
    skill: new Set(),
  }
  for (const a of artifacts) registry[a.type].add(a.name)
  return registry
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
    if (!registry[targetType].has(toName)) return
    if (from.type === targetType && from.name === toName) return
    const key = `${from.type}:${from.name}->${targetType}:${toName}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({
      from: from.type,
      fromName: from.name,
      to: targetType,
      toName,
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

export function buildGraph(artifacts: Artifact[]): GraphData {
  const references = extractReferences(artifacts)

  const nodes: Record<string, GraphNode> = {}
  for (const a of artifacts) {
    const id = artifactId(a.type, a.name)
    nodes[id] = { id, name: a.name, type: a.type, degree: 0 }
  }

  const links: GraphLink[] = []
  for (const ref of references) {
    const source = artifactId(ref.from, ref.fromName)
    const target = artifactId(ref.to, ref.toName)
    if (!nodes[source] || !nodes[target]) continue
    nodes[source].degree += 1
    nodes[target].degree += 1
    links.push({ source, target, kind: ref.kind })
  }

  return { nodes: Object.values(nodes), links }
}
