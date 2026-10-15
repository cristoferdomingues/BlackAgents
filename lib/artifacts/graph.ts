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

export function buildGraph(artifacts: Artifact[], concepts: GraphConcept[] = []): GraphData {
  const references = extractReferences(artifacts)
  const registry = buildRegistry(artifacts)
  const conceptIds = new Set(concepts.map((concept) => concept.id))

  const nodes: Record<string, GraphNode> = {}
  for (const a of artifacts) {
    const id = artifactId(a.type, a.name)
    nodes[id] = { id, name: a.name, type: a.type, degree: 0 }
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
    connect(artifactId(ref.from, ref.fromName), artifactId(ref.to, ref.toName), ref.kind)
  }

  for (const concept of concepts) {
    const source = `concept:${concept.id}`
    for (const target of linkedConceptIds(concept.id, concept.body)) {
      if (conceptIds.has(target)) connect(source, `concept:${target}`, "concept-concept")
    }
    for (const token of matchAll(BOLD_RE, concept.body)) {
      if (registry.agent.has(token)) connect(source, artifactId("agent", token), "concept-artifact")
    }
    for (const token of matchAll(BACKTICK_RULE_RE, concept.body)) {
      if (registry.rule.has(token)) connect(source, artifactId("rule", token), "concept-artifact")
    }
    for (const token of matchAll(BACKTICK_SKILL_RE, concept.body)) {
      if (registry.skill.has(token)) connect(source, artifactId("skill", token), "concept-artifact")
    }
  }

  for (const artifact of artifacts) {
    const source = artifactId(artifact.type, artifact.name)
    for (const target of linkedConceptIds("", artifact.body)) {
      if (conceptIds.has(target)) connect(source, `concept:${target}`, "artifact-concept")
    }
  }

  return { nodes: Object.values(nodes), links }
}
