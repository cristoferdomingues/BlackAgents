import { Bot, Workflow, Shield, BookOpen, type LucideIcon } from "lucide-react"

import type { ArtifactType } from "./types"

export interface ArtifactTypeMeta {
  type: ArtifactType
  /** Singular label, capitalized. */
  label: string
  /** Plural label, capitalized. */
  labelPlural: string
  /** Route segment (plural, lowercase). */
  route: string
  icon: LucideIcon
  /** Tailwind text color token (see globals.css --type-*). */
  colorClass: string
  /** Raw HSL string for the graph canvas (resolved at runtime from CSS var). */
  cssVar: string
  description: string
}

export const ARTIFACT_TYPES: Record<ArtifactType, ArtifactTypeMeta> = {
  agent: {
    type: "agent",
    label: "Agent",
    labelPlural: "Agents",
    route: "agents",
    icon: Bot,
    colorClass: "text-agent",
    cssVar: "--type-agent",
    description:
      "Single-responsibility workers with a persona. Know what to do; defer how to rules and skills.",
  },
  command: {
    type: "command",
    label: "Command",
    labelPlural: "Commands",
    route: "commands",
    icon: Workflow,
    colorClass: "text-command",
    cssVar: "--type-command",
    description:
      "Orchestration layer. Sequence agent invocations without implementation detail.",
  },
  rule: {
    type: "rule",
    label: "Rule",
    labelPlural: "Rules",
    route: "rules",
    icon: Shield,
    colorClass: "text-rule",
    cssVar: "--type-rule",
    description:
      "Short, declarative guardrails. One concern per file, auto-applied or glob-triggered.",
  },
  skill: {
    type: "skill",
    label: "Skill",
    labelPlural: "Skills",
    route: "skills",
    icon: BookOpen,
    colorClass: "text-skill",
    cssVar: "--type-skill",
    description:
      "Deep reference packages with optional supporting files. Read on demand.",
  },
}

export const ARTIFACT_TYPE_LIST: ArtifactTypeMeta[] = [
  ARTIFACT_TYPES.agent,
  ARTIFACT_TYPES.command,
  ARTIFACT_TYPES.rule,
  ARTIFACT_TYPES.skill,
]

export function typeFromRoute(route: string): ArtifactType | undefined {
  return ARTIFACT_TYPE_LIST.find((t) => t.route === route)?.type
}

export function metaForType(type: ArtifactType): ArtifactTypeMeta {
  return ARTIFACT_TYPES[type]
}
