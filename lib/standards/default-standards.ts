import type { ArtifactType } from "../artifacts/types"

/**
 * The authoring-standards baseline. Two complementary representations:
 *
 * - `STANDARDS_SPEC` — a structured spec used by the editor/wizard to render
 *   field hints, required-section checks, and body templates.
 * - `DEFAULT_STANDARDS_MD` — the human-editable reference document shown on the
 *   Standards page and fed to the LLM as generation context.
 */

export interface TypeSpec {
  /** Section headings expected in the body (used for soft validation). */
  requiredSections: string[]
  /** Common mistakes surfaced as guidance in the editor. */
  antiPatterns: string[]
  /** Short note describing the frontmatter for this type. */
  frontmatterNote: string
  /** Starter body scaffold for a brand-new artifact. */
  bodyTemplate: (name: string) => string
}

export const STANDARDS_SPEC: Record<ArtifactType, TypeSpec> = {
  agent: {
    requiredSections: ["Input", "Workflow", "Output", "Error handling"],
    antiPatterns: [
      "Embedding domain conventions that belong in a rule",
      "Containing deep reference material that belongs in a skill",
      "Missing an error-handling section",
      "Doing multiple unrelated things in one agent",
    ],
    frontmatterNote:
      "Agents are single-responsibility workers with a persona. Add `parallel` for review workers that can run concurrently.",
    bodyTemplate: (name) =>
      `You are the ${name} agent. <one-line persona describing what you do>.

## Input

- What this agent receives from the caller.

## Workflow

1. First step.
2. Second step.

## Output

- The single artifact or result this agent produces.

## Error handling

- What to do when things fail.
`,
  },
  command: {
    requiredSections: [
      "Input",
      "Prerequisites",
      "Steps",
      "Parallelization",
      "Error handling",
    ],
    antiPatterns: [
      "Embedding implementation details that belong in an agent",
      "Fetching data directly instead of invoking an agent",
      "Missing the early-return / skip-if-exists check",
      "Hardcoding domain knowledge that belongs in a rule or skill",
    ],
    frontmatterNote:
      "Commands are the orchestration layer. They sequence agents and never contain domain logic.",
    bodyTemplate: () =>
      `Orchestrates <goal>. Check for the output file first and stop early if it already exists.

## Input

- What the user provides (e.g. a ticket key).

## Prerequisites

- Config files, connections, or prior setup required.

## Steps

1. Invoke the **agent-name** agent with <inputs>.
2. Invoke the **another-agent** agent with <inputs>.

## Parallelization

- Which steps can run concurrently.

## Error handling

- Blocking vs non-blocking failures.
`,
  },
  rule: {
    requiredSections: [],
    antiPatterns: [
      "Teaching things modern LLMs already know",
      "Multi-page reference material (move it to a skill)",
      "Step-by-step procedures (those belong in an agent or skill)",
      "Code examples beyond a one-liner (use a skill)",
    ],
    frontmatterNote:
      "Rules are short guardrails (~30 lines). Use `alwaysApply` for global rules, or `globs` to activate on matching files.",
    bodyTemplate: () =>
      `# Short, declarative guardrail

Direct do / don't guidance. Keep it under ~30 lines.

- Do X.
- Don't Y.

Related rules:
See also: <name> skill
`,
  },
  skill: {
    requiredSections: ["When to Apply"],
    antiPatterns: [
      "Short constraints that fit in a rule",
      "Orchestration logic that belongs in a command",
      "Procedural task workflows that belong in an agent",
    ],
    frontmatterNote:
      "Skills are deep reference packages. The description should include trigger conditions so the assistant knows when to load it.",
    bodyTemplate: (name) =>
      `# ${name}

## When to Apply

- Trigger conditions for reading this skill.

## Reference

Comprehensive material — tables, examples, or pointers to supporting files.

## How to Use

- How to navigate the supporting files in this skill's directory.
`,
  },
}

export const DEFAULT_STANDARDS_MD = `# Authoring Standards

Canonical reference for authoring artifacts in this workspace. Each artifact type has a distinct purpose and structure. Putting content in the wrong type leads to bloated agents, thin rules, or commands that do too much.

The guiding principle: **commands wire, agents execute, rules constrain, skills educate.**

## Commands

**Purpose:** Orchestration layer. Sequence agent invocations without getting into implementation details. Commands are the "wiring diagram."

**Frontmatter:** \`name\`, \`description\`.

**Required sections:** Input, Prerequisites, Steps, Parallelization, Error handling.

**Conventions:**

- Idempotency: define the output path and skip the work if it already exists.
- Reference agents by name in bold prose ("invoke the **agent-name** agent"), never by file path.
- Commands delegate to agents; they don't contain domain logic.

## Agents

**Purpose:** Single-responsibility workers with a persona. Know *what* needs to get done but defer *how* to rules and skills.

**Frontmatter:** \`name\`, \`description\`, optional \`parallel\`.

**Structure:** persona opening, Input, Workflow, Output (one artifact), Error handling.

**Conventions:**

- Reference rules and skills by name for domain knowledge.
- Each agent does one thing. If it's doing two unrelated things, split it.

## Rules

**Purpose:** Short, declarative guardrails. One concern per file. Auto-applied or triggered by globs.

**Frontmatter:** \`description\`, \`alwaysApply\`, optional \`globs\`.

**What belongs in a rule:** project-specific conventions the assistant wouldn't know, short constraints, pointers to skills for depth.

**What does NOT belong:** things LLMs already know, multi-page reference material, step-by-step procedures, code examples beyond a one-liner.

## Skills

**Purpose:** Deep reference packages with optional supporting files. Read on demand when the task matches the description.

**Frontmatter:** \`name\`, \`description\` (include trigger conditions).

**Structure:** "When to Apply" section, reference content, "How to Use" for navigating supporting files.

## Decision Guide: Rule or Skill?

- Fits in ~30 lines, mostly "do X / don't do Y" → write a **Rule**.
- Needs examples, reference tables, or supporting files → write a **Skill**.
- A rule exists and needs depth → create a companion skill and point to it.
- Not sure → start as a rule; extract depth into a skill if it grows.

## Cross-Reference Conventions

- Commands reference agents by name in bold: "invoke the **agent-name** agent".
- Agents reference rules and skills by name in backticks: "Read the \\\`rule-name\\\` rule".
- Rules cross-reference at the bottom: "Related rules: X, Y. See also: Z skill".
- All names match filenames (kebab-case, no extension).
`
