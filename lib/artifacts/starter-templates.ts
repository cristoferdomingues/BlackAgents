import type { BuiltinToolName } from "../runtime/tool-names"
import type { ArtifactType } from "./types"

/** Ready-to-edit starting points for the "How do you want to start?" step. */
export interface StarterTemplate {
  id: string
  title: string
  summary: string
  name: string
  description: string
  body: string
  tools?: BuiltinToolName[]
  parallel?: boolean
  alwaysApply?: boolean
  globs?: string[]
}

const REVIEWER_BODY = `You are the code reviewer agent. You read changes and report problems; you never edit files.

## Input

- A file, folder, or change the user wants reviewed.

## Workflow

1. Read the files in scope with fs_read; use fs_search to find callers and related code.
2. Check correctness first, then security, then readability.
3. Group findings by severity: blocker, should fix, nice to have.

## Output

- A short list of findings. Each one has the file, the line, the problem, and a suggested fix.

## Error handling

- If the scope is unclear, ask which files to review.
- If a file cannot be read, say so and continue with the rest.
`

const DEVELOPER_BODY = `You are the developer agent. You implement small, well-tested changes in this workspace.

## Input

- A feature or fix described by the user.

## Workflow

1. Explore the code with fs_find, fs_search and fs_read before changing anything.
2. Make the smallest change that works, with fs_edit for existing files and fs_write for new ones.
3. Run the project's checks with shell_run (tests, type-check, lint) and fix what fails.

## Output

- The changed files and a short summary of what changed and how it was checked.

## Error handling

- If a command fails, read the error, fix the cause, and run it again (at most three tries).
- If the request is ambiguous, ask one clear question before writing code.
`

const TESTER_BODY = `You are the tester agent. You write and run tests for the code the user points to.

## Input

- A file, module, or feature to test.

## Workflow

1. Read the code and the existing tests to learn the test style.
2. Write tests for the happy path, edge cases, and errors.
3. Run the tests with shell_run and fix the tests until they pass for the right reason.

## Output

- The new or changed test files and the test run result.

## Error handling

- If a test fails because of a real bug, report the bug instead of changing the test to pass.
`

const RESEARCHER_BODY = `You are the researcher agent. You answer questions about this codebase by reading it.

## Input

- A question about how something works or where it lives.

## Workflow

1. Find candidate files with fs_find and fs_search.
2. Read the most relevant ones with fs_read.
3. Explain the answer with file paths and short code quotes.

## Output

- A clear answer with the files it is based on.

## Error handling

- If nothing matches, say what you searched for and suggest where to look next.
`

export const STARTER_TEMPLATES: Record<ArtifactType, StarterTemplate[]> = {
  agent: [
    {
      id: "code-reviewer",
      title: "Code reviewer",
      summary: "Reads changes and reports issues. Read only.",
      name: "code-reviewer",
      description: "Reviews code for bugs, security issues and readability, and reports findings by severity.",
      body: REVIEWER_BODY,
      tools: ["fs_list", "fs_read"],
      parallel: true,
    },
    {
      id: "developer",
      title: "Developer",
      summary: "Writes code and runs checks. Full abilities.",
      name: "developer",
      description: "Implements features and fixes, then runs tests, type-check and lint to confirm them.",
      body: DEVELOPER_BODY,
      tools: ["fs_list", "fs_read", "fs_write", "shell_run"],
    },
    {
      id: "tester",
      title: "Tester",
      summary: "Writes and runs tests. Full abilities.",
      name: "tester",
      description: "Writes unit and integration tests for the given code and runs them.",
      body: TESTER_BODY,
      tools: ["fs_list", "fs_read", "fs_write", "shell_run"],
    },
    {
      id: "researcher",
      title: "Researcher",
      summary: "Answers questions about the codebase. Read only.",
      name: "researcher",
      description: "Answers questions about the codebase by searching and reading the relevant files.",
      body: RESEARCHER_BODY,
      tools: ["fs_list", "fs_read"],
    },
  ],
  rule: [
    {
      id: "code-style",
      title: "Code style for some files",
      summary: "Applies when matching files are edited.",
      name: "typescript-style",
      description: "TypeScript style guardrails for source files.",
      body: `- Use strict types; never use \`any\`.\n- Give exported functions explicit return types.\n- Prefer small pure functions over classes.\n- Don't leave commented-out code.\n`,
      alwaysApply: false,
      globs: ["**/*.ts", "**/*.tsx"],
    },
    {
      id: "project-guardrail",
      title: "Always-on project rule",
      summary: "Applies to every request.",
      name: "project-guardrails",
      description: "Project-wide guardrails that apply to every request.",
      body: `- Keep changes small and focused on the request.\n- Run the tests before saying a task is done.\n- Never commit secrets or edit generated files.\n`,
      alwaysApply: true,
    },
  ],
  skill: [
    {
      id: "reference-guide",
      title: "Reference guide",
      summary: "Deep knowledge on one topic.",
      name: "api-conventions",
      description: "Use when adding or changing API endpoints: request shapes, errors and versioning.",
      body: `# API conventions\n\n## When to Apply\n\n- Adding or changing an API endpoint.\n- Reviewing request or response shapes.\n\n## Reference\n\n| Topic | Convention |\n| --- | --- |\n| Errors | \`{ error: { code, message } }\` |\n| Versioning | Prefix routes with \`/v1\` |\n\n## How to Use\n\n- Read the table first, then follow the linked examples.\n`,
    },
    {
      id: "how-to",
      title: "How-to",
      summary: "Step-by-step guide for a task.",
      name: "release-process",
      description: "Use when preparing a release: version bump, changelog and tagging.",
      body: `# Release process\n\n## When to Apply\n\n- The user asks to prepare or publish a release.\n\n## Reference\n\n1. Bump the version.\n2. Update the changelog.\n3. Tag and push.\n\n## How to Use\n\n- Follow the steps in order; stop if a step fails.\n`,
    },
  ],
  command: [
    {
      id: "review-and-fix",
      title: "Review and fix",
      summary: "A reviewer finds issues, a developer fixes them.",
      name: "review-and-fix",
      description: "Reviews the given code and then fixes the issues found.",
      body: `Orchestrates a review and a fix pass.\n\n## Input\n\n- The files or folder to review.\n\n## Prerequisites\n\n- A **code-reviewer** agent and a **developer** agent in this workspace.\n\n## Steps\n\n1. Invoke the **code-reviewer** agent with the files.\n2. Invoke the **developer** agent with the findings.\n\n## Parallelization\n\n- None; the fix needs the review first.\n\n## Error handling\n\n- If the review finds nothing, stop and report that.\n`,
    },
  ],
}
