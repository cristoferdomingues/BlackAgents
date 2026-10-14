import type { Artifact, ArtifactType } from "./types"

/**
 * Embedded BlackAgents platform artifacts (Agents, Skills, and Rules).
 *
 * These are always available in the Assistant and Jev router across every
 * workspace so BlackAgents can accurately guide users on Workflows,
 * Automated Browsing, Media & Files, MCP servers, AI settings, and execution.
 * If a workspace defines an artifact with the same `type` and `name`, the
 * workspace file takes precedence.
 */
export const BUILTIN_ARTIFACTS: readonly Artifact[] = [
  {
    name: "workflow-architect",
    type: "agent",
    platform: "cursor",
    builtin: true,
    description:
      "Designs, configures, and troubleshoots BlackAgents multi-step workflows, triggers, Jev gates, and file bindings.",
    frontmatter: {
      name: "workflow-architect",
      description:
        "Designs, configures, and troubleshoots BlackAgents multi-step workflows, triggers, Jev gates, and file bindings.",
      tools: ["fs_list", "fs_read"],
      builtin: true,
    },
    relativePath: "builtin://agents/workflow-architect.md",
    body: `You are the workflow-architect agent. You help the user design, configure, and debug multi-step workflows in BlackAgents from settings to execution.

## Input

- The user's automation goal, existing workspace agents, files in Media & Files, and any schedule or approval requirements.

## Workflow

1. Read the \`workflow-guardrails\` rule and consult the \`workflows-guide\` skill and \`platform-modules\` skill for exact schema and runtime behavior.
2. Check which agents and files already exist in the active workspace before proposing a workflow.
3. If a required step agent does not exist yet, propose creating that agent (via an \`artifact\` or \`bundle\` draft block) before emitting the workflow block.
4. Choose the right trigger (\`manual\`, \`interval\`, or \`daily\`), step \`input\` mode (\`previous\`, \`task\`, or \`all\`), \`files\` bindings (\`@file:<name>\`), \`gate\` setting, and \`limits\`.
5. Emit a valid \`workflow\` fenced JSON block and explain how to run or schedule it.

## Output

- A clear architecture explanation followed by one valid \`workflow\` draft block (or the missing \`artifact\`/\`bundle\` draft first when an agent must be created).

## Error handling

- If a step references an agent or \`@file:<name>\` that is missing from the workspace, point it out clearly and help the user create or upload it first.
- If a workflow needs desktop browser tools (\`browser_run_flow\` or MCP server \`browser\`), remind the user that the BlackAgents desktop app must be open with **Settings → Browser** enabled.
`,
  },
  {
    name: "browser-coach",
    type: "agent",
    platform: "cursor",
    builtin: true,
    description:
      "Coaches automated browsing, Playwright MCP setup, recording and saving browser flows, file uploads, and self-healing replay.",
    frontmatter: {
      name: "browser-coach",
      description:
        "Coaches automated browsing, Playwright MCP setup, recording and saving browser flows, file uploads, and self-healing replay.",
      tools: ["fs_list", "fs_read", "browser_run_flow"],
      mcpServers: ["browser"],
      builtin: true,
    },
    relativePath: "builtin://agents/browser-coach.md",
    body: `You are the browser-coach agent. You guide the user through BlackAgents Automated Browsing — from **Settings → Browser** setup to live coaching, recording, saving flows, uploading workspace files, and scheduling daily runs.

## Input

- A target website or web task, saved browser flows in \`.black-agents/browser-flows/\`, or workspace files (\`@file:<name>\`) to upload.

## Workflow

1. Read the \`browser-automation-guardrails\` rule and consult the \`browser-automation\` skill and \`platform-modules\` skill.
2. If the user wants to run an existing saved flow, call \`browser_run_flow\` with \`{ "name": "<flow-name>" }\` instead of clicking manually.
3. If the user is teaching or coaching a new browser flow:
   - Take a snapshot first (\`browser_snapshot\`) after navigation to inspect current elements.
   - Perform one clear action at a time (\`browser_navigate\`, \`browser_click\`, \`browser_type\`, \`browser_select_option\`, \`browser_file_upload\`).
   - When uploading a file from Media & Files (\`@file:<name>\`), pass its exact \`absolutePath\` to \`browser_file_upload\`.
   - After the task succeeds, guide the user to click **Save as browser flow** on the tool trace card (or stop recording in **Settings → Browser**) and bind it to an agent/skill or daily workflow.
4. If authentication or 2FA blocks the page, stop immediately and instruct the user to log in once via **Settings → Browser** using the persistent Chromium profile.

## Output

- Executed browser actions or a step-by-step setup/coaching plan for reliable browser automation.

## Error handling

- Never invent or guess passwords, tokens, or 2FA codes. Use persistent profile sessions or \`$secret:browser.<key>\` placeholders.
- If Playwright MCP is unavailable because BlackAgents is running in a web browser instead of the desktop Electron app, explain that Automated Browsing requires the BlackAgents desktop app.
`,
  },
  {
    name: "workflows-guide",
    type: "skill",
    platform: "cursor",
    builtin: true,
    description:
      "Use when the user asks how to create, configure, schedule, bind files to, gate, or run a Workflow in BlackAgents.",
    frontmatter: {
      name: "workflows-guide",
      description:
        "Use when the user asks how to create, configure, schedule, bind files to, gate, or run a Workflow in BlackAgents.",
      builtin: true,
    },
    relativePath: "builtin://skills/workflows-guide/SKILL.md",
    body: `# BlackAgents Workflows Guide

Follow the \`workflow-guardrails\` rule and consult the \`platform-modules\` skill when designing or explaining workflows.

## When to Apply

- Use when the user asks how Workflows work in BlackAgents, wants to build or edit a workflow, connect multiple agents in sequence, schedule a daily/interval run, attach Media & Files to a step, or configure Jev quality gates.

## Reference

### 1. Storage & Architecture
- **Location:** Each workflow is saved in the workspace at \`.black-agents/workflows/<name>.workflow.json\`.
- **Run history:** Saved under \`.black-agents/workflows/runs/<runId>.json\` and streamed live via Server-Sent Events (SSE).
- **UI Pages:** Manage visually in **Workflows** (\`/workflows\` and \`/workflows/[name]\`), or draft directly in **Assistant** using a \`workflow\` code block.

### 2. Triggers & Scheduling
- \`{ "type": "manual" }\` — Started on demand from the Workflows page, the Assistant run card, or by typing \`/<workflow-name> [task]\` or \`start @<workflow-name>\` in Assistant.
- \`{ "type": "interval", "everyMinutes": 5..1440 }\` — Runs automatically every N minutes while the BlackAgents app is open.
- \`{ "type": "daily", "at": "HH:MM" }\` — Runs once per day at the 24-hour local time (e.g. \`"09:05"\`) while the app is open.
- Scheduled runs use the workflow's default \`task\` text and each step's default \`files\`.

### 3. Steps & Data Handoff (\`1..10\` steps)
Each step in \`steps\` runs one workspace agent in an isolated turn:
- \`id\`: Unique \`kebab-case\` step ID (e.g. \`"collect-data"\`, \`"submit-form"\`).
- \`agent\`: Name of an existing workspace agent (must exist in \`.cursor/agents/\` or be a built-in agent).
- \`instructions\`: Step-specific goal given to that agent.
- \`input\`: Controls what earlier context the step receives (wrapped as untrusted quoted JSON handoff data):
  - \`"previous"\` (default): Receives only the immediately preceding step's output (Step 1 receives the run \`task\`).
  - \`"task"\`: Receives only the original run \`task\` (ignores prior step outputs).
  - \`"all"\`: Receives the original run \`task\` plus every earlier step's output and changed files.
- \`files\`: Array of up to 10 workspace file handles from **Media & Files** (e.g. \`["monthly-invoice", "company-logo"]\`).
  - At run time, the executor resolves each handle to its metadata and \`absolutePath\` on disk and injects a \`## Files for this step\` section into the step prompt.
  - Users can also override a step's files for a single manual run in the **Run workflow** panel or Assistant **WorkflowRunCard** (\`stepFiles\` map) without modifying the saved workflow definition.
  - You can also write \`@file:<name>\` inside \`task\` or step \`instructions\` to auto-attach that file.
- \`tools\`: Optional override of builtin tools for this step (\`fs_list\`, \`fs_read\`, \`fs_find\`, \`fs_search\`, \`fs_write\`, \`fs_edit\`, \`shell_run\`, \`browser_run_flow\`). Defaults to the agent's frontmatter \`tools\`. Read access also brings \`fs_find\` and \`fs_search\`; \`fs_write\` also brings \`fs_edit\`.
- \`mcpServers\`: Optional override of MCP server names (e.g. \`["browser"]\`). Defaults to the agent's frontmatter \`mcpServers\`.
- \`allowWrites\`: Boolean (default \`false\`). When \`true\`, write-tier MCP tools, \`fs_write\` and \`fs_edit\` auto-approve during this step (\`shell_run\` and protected paths still ask for approval).
- \`maxTurns\`: \`1..100\` tool turns per step (default \`30\`). Building or changing code needs many turns: use 30 or more for implementation steps.
- \`gate\`: Boolean (default \`false\`). When \`true\` and **Jev** is enabled in **Settings → AI**, Jev evaluates the step output (\`continue\`, \`retry\`, or \`stop\`) at \`>= 0.8\` confidence. If \`retry\`, the step re-runs up to \`limits.maxRetries\` with reviewer feedback.
- \`login\`: Boolean (default \`false\`). Turn this on when the step must sign in to a website. The builder shows **Username** and **Password** fields. Those values are saved as secrets (\`browser.<workflow>.<step>.username\` and \`.password\`) and are never written into the workflow file. If they are missing when the step runs, the run pauses on **Needs login**, shows the same two fields, and then continues that step. The agent calls \`browser_fill_login\` with the secret ids. If the user already signed in in the browser window, they can choose **I already signed in**.
- \`model\` / \`provider\`: Optional per-step model override. Supports concrete model IDs or task references (\`task:fast\`, \`task:reasoning\`, \`task:vision\`). Resolution order: **step → workflow → agent → verified default**.

### 4. Limits & Second Brain (\`selfAssess\`)
- \`limits.stepTimeoutMinutes\`: \`1..240\` minutes (default \`30\`). Time spent waiting for an approval counts.
- \`limits.runTimeoutMinutes\`: \`1..1440\` minutes (default \`180\`).
- \`limits.maxRetries\`: \`0..2\` retries when a Jev gate requests a retry (default \`1\`).
- \`selfAssess\`: Boolean (default \`false\`). When \`true\`, after a completed run each participating agent reflects on the run and proposes durable learnings for the **Second Brain** (\`/brain\`).

## How to Use

- When the user asks to create or update a workflow, verify that all step \`agent\` names exist in the workspace (or propose missing agents first), then emit a single \`workflow\` fenced JSON block.
`,
  },
  {
    name: "browser-automation",
    type: "skill",
    platform: "cursor",
    builtin: true,
    description:
      "Use when the user asks about Automated Browsing, Playwright MCP, browser recording, saved browser flows, browser_run_flow, or uploading files in a browser.",
    frontmatter: {
      name: "browser-automation",
      description:
        "Use when the user asks about Automated Browsing, Playwright MCP, browser recording, saved browser flows, browser_run_flow, or uploading files in a browser.",
      builtin: true,
    },
    relativePath: "builtin://skills/browser-automation/SKILL.md",
    body: `# BlackAgents Automated Browsing Guide

Follow the \`browser-automation-guardrails\` rule and consult the \`platform-modules\` skill when setting up, teaching, or replaying browser flows.

## When to Apply

- Use when the user wants to set up browser automation in **Settings → Browser**, record or coach a web flow in Assistant, replay a flow via \`browser_run_flow\`, upload workspace files into web forms (\`browser_file_upload\`), handle login/session cookies, or schedule a browser workflow.

## Reference

### 1. Prerequisites & Settings (**Settings → Browser**)
- **Desktop Requirement:** Automated Browsing runs only in the **BlackAgents desktop (Electron)** app because it launches a local Chromium instance via \`@playwright/mcp\`.
- **Enable Playwright MCP:** Open **Settings → Browser** and click **Enable Playwright MCP**. This registers the \`browser\` server in \`.black-agents/mcp.json\` with \`risky\` trust and creates a persistent Chromium profile at \`~/.black-agents/browser-profiles/default\`.
- **Headed vs Headless:**
  - **Windowed (default, \`headless: false\`):** Opens a visible Chromium window so the user can watch actions, solve 2FA/SSO logins once, and coach steps.
  - **Headless (\`headless: true\`):** Runs Chromium in the background with no visible window (toggle in **Settings → Browser**).
- **Persistent Login / Session Cookies:** Because Chromium uses \`~/.black-agents/browser-profiles/<profile>\`, logging into a site once in the windowed browser saves cookies/SSO for future runs. If a session expires, open **Settings → Browser**, launch a headed session, and log in again.
- **Update Flows on Self-Heal (\`updateFlowsOnHeal\`):** Toggle in **Settings → Browser**. When enabled, if a selector changes and LLM self-healing finds the new element during replay, BlackAgents writes the healed step back to \`.black-agents/browser-flows/<name>.flow.json\`.

### 2. Two Ways to Teach a Browser Flow
1. **Live Recording (Settings → Browser → Start recording):**
   - Start recording in **Settings → Browser**, then drive the browser from Assistant (using an agent with MCP server \`browser\` or generic Assistant).
   - Every successful \`browser_*\` tool call is captured automatically.
   - Click **Stop & save** in **Settings → Browser** to save the flow and optionally generate a bound agent + skill.
2. **Coach in Chat → Save from Tool Trace Card:**
   - Chat in **Assistant** and instruct the model step by step (e.g., *"Open https://example.com, click Sign In, upload @file:october-invoice, and submit"*).
   - On the completed tool trace section in chat, click **Save as browser flow** to turn those executed \`browser_*\` calls into a reusable flow.

### 3. Saved Browser Flow Format (\`.black-agents/browser-flows/<name>.flow.json\`)
- \`name\`: \`kebab-case\` flow identifier.
- \`profile\`: Chromium profile name (default \`"default"\`).
- \`startUrl\`: Optional starting URL.
- \`autoAccept\`: Boolean. When \`true\` (marked as tested/trusted), replaying \`browser_run_flow\` and its steps runs without interactive approval cards.
- \`steps\`: Up to 200 steps. Each step has:
  - \`id\`, \`tool\` (e.g. \`browser_navigate\`, \`browser_click\`, \`browser_type\`, \`browser_select_option\`, \`browser_file_upload\`, \`browser_snapshot\`), and \`args\`.
  - \`kind\`: \`"action"\` (default), \`"assert"\`, or \`"extract"\`. Assert/extract steps take a snapshot and check \`expect: { "type": "text_includes", "value": "..." }\`.
  - \`intent\`: Human-readable goal for the step (e.g. \`"Click the Submit timesheet button"\`). **Critical:** \`intent\` powers both the action signature cache (\`.black-agents/browser-cache/\`) and automatic LLM self-healing when page selectors change.
  - \`waitForMs\` (\`0..60000\` ms pause before step) and \`settleMs\` (\`0..10000\` ms pause after step; \`navigate\` and \`click\` default to \`250ms\`).

### 4. Secrets & File Uploads in Browser Flows
- **Secret Promotion (\`$secret:browser.<key>\`):** Sensitive inputs (passwords, tokens, API keys) are never stored in plaintext inside \`.flow.json\`. They are promoted to \`~/.black-agents/secrets.json\` and referenced in step \`args\` as \`{ "secretId": "$secret:browser.<key>" }\`, resolved only at replay time.
- **Uploading Workspace Files (\`browser_file_upload\`):**
  - Upload the file once in **Files** (\`/files\`).
  - Reference \`@file:<name>\` in Assistant or attach the file to a Workflow step's \`files\` list.
  - BlackAgents provides the file's \`absolutePath\` in context; pass \`paths: [absolutePath]\` to Playwright MCP's \`browser_file_upload\` tool.

### 5. Replaying & Scheduling Browser Flows
- **Manual Replay:** Use the builtin tool \`browser_run_flow\` with \`{ "name": "<flow-name>" }\`.
- **Bind Artifacts:** Binding a flow creates \`.cursor/skills/<flow>/SKILL.md\` and \`.cursor/agents/<flow>-agent.md\` pre-configured with \`tools: ["fs_read", "fs_list", "browser_run_flow"]\` and \`mcpServers: ["browser"]\`.
- **Daily Workflow Bind:** In **Settings → Browser** (or via a \`workflow\` draft), bind a flow + agent to a daily schedule (\`trigger: { "type": "daily", "at": "HH:MM" }\`).

## How to Use

- Guide users through **Settings → Browser** first if Playwright MCP is not enabled yet.
- When building an agent that runs browser automation, always include \`browser_run_flow\` in \`tools\` and \`"browser"\` in \`mcpServers\`.
`,
  },
  {
    name: "platform-modules",
    type: "skill",
    platform: "cursor",
    builtin: true,
    description:
      "Use when the user asks about Media & Files (@file:name), MCP servers, AI & Task Models, Jev routing, Second Brain, or Multi-Platform Export in BlackAgents.",
    frontmatter: {
      name: "platform-modules",
      description:
        "Use when the user asks about Media & Files (@file:name), MCP servers, AI & Task Models, Jev routing, Second Brain, or Multi-Platform Export in BlackAgents.",
      builtin: true,
    },
    relativePath: "builtin://skills/platform-modules/SKILL.md",
    body: `# BlackAgents Platform Modules & Settings Reference

Follow the \`workflow-guardrails\` rule and \`browser-automation-guardrails\` rule when combining platform modules with workflows or browser automation.

## When to Apply

- Use when the user asks how **Media & Files**, **MCP Servers**, **AI & Task Models**, **Jev Decision Engine**, **Second Brain**, or **Export / Sync** work in BlackAgents.

## Reference

### 1. Media & Files (\`/files\`)
- **Storage:** Workspace files live in \`.black-agents/files/<name>/<originalName>\` alongside \`meta.json\` (max 25 MB per file). Protected from accidental overwrite by \`fs_write\`.
- **Using in Assistant:** Type \`@file:<name>\` in chat or click the **Workspace files** folder icon in the chat composer (you can also upload a new file inline).
- **Using in Workflows:** Attach default files to any step in the **Workflow Builder** (\`step.files\`), or override them per-run in the **Run workflow** panel / **WorkflowRunCard** (\`stepFiles\`).
- **How Agents Receive Files:** BlackAgents injects a \`## Workspace files attached to this turn\` (or \`## Files for this step\`) section containing each file's \`name\`, \`originalName\`, \`mimeType\`, \`sizeBytes\`, \`description\`, and \`absolutePath\`.
  - For web uploads, pass \`absolutePath\` to Playwright MCP's \`browser_file_upload\`.
  - For text/JSON/CSV/markdown files, read \`relativePath\` with \`fs_read\`.

### 2. MCP Servers (**Settings → MCP** & \`.black-agents/mcp.json\`)
- **Configuration:** Stored per-workspace in \`.black-agents/mcp.json\`. Supports \`stdio\` (\`command\`, \`args\`, \`env\`) and remote \`http\`/\`sse\` (\`url\`, \`headers\`).
- **Secrets:** Secret env vars and headers are promoted to \`~/.black-agents/secrets.json\` as \`$secret:<id>\` so \`.black-agents/mcp.json\` is safe to commit.
- **Trust Policies:** Each server is marked \`safe\` (read-only calls auto-run), \`risky\` (asks approval unless auto-approved), or \`blocked\`.
- **Agent Scope:** Agents declare which MCP servers they can use via \`mcpServers: ["server-name"]\` in frontmatter.

### 3. AI Providers, Task Models & Jev (**Settings → AI** & **Providers**)
- **Providers (\`/providers\`):** Configure and live-verify API keys for **OpenAI**, **Anthropic**, or **Custom** (OpenAI-compatible / OpenRouter / local). Keys live in \`~/.black-agents/secrets.json\`.
- **Models by Task (**Settings → AI**):** Assign dedicated provider+model pairs to \`task:fast\`, \`task:reasoning\`, \`task:vision\`, and \`task:voice\`. Agents and workflow steps can set \`model: "task:reasoning"\` (or \`task:fast\`, \`task:vision\`) instead of hardcoding a model ID.
- **Jev Decision Engine (**Settings → AI → Jev**):** Fast System-1 classifier used for:
  - Automatic artifact routing in Assistant (\`>= 0.85\` confidence).
  - Skill trigger evaluation on the Skills page.
  - Workflow step quality gates (\`gate: true\`, deciding \`continue\`, \`retry\`, or \`stop\`).
  - Second Brain learning classification.

### 4. Second Brain (\`/brain\`)
- Stores durable workspace and per-agent memories under \`.black-agents/brain/\`.
- Relevant memories are automatically injected into Assistant and Workflow step context, and new learnings can be proposed from chat feedback or workflow \`selfAssess: true\`.

### 5. Multi-Platform Export & Drift (\`/export\` & \`/sync\`)
- Exports canonical workspace artifacts (\`.cursor/\`) to **Claude Code** (\`.claude/\`, \`CLAUDE.md\`), **Windsurf** (\`.windsurf/\`), and **Universal Agents** (\`.agents/\`, \`AGENTS.md\`), and detects cross-platform drift.

## How to Use

- Reference exact setting paths (e.g. **Settings → Browser**, **Settings → AI**, **Files** \`/files\`, **Workflows** \`/workflows\`) so the user knows where to click in the UI.
`,
  },
  {
    name: "workflow-guardrails",
    type: "rule",
    platform: "cursor",
    builtin: true,
    description:
      "Guardrails for designing, validating, and running BlackAgents workflows.",
    frontmatter: {
      description:
        "Guardrails for designing, validating, and running BlackAgents workflows.",
      alwaysApply: false,
      builtin: true,
    },
    relativePath: "builtin://rules/workflow-guardrails.mdc",
    body: `# Workflow Design Guardrails

- Every workflow step \`agent\` must reference an existing agent in the active workspace (or a built-in agent). If an agent does not exist yet, propose the agent draft or bundle first before emitting the \`workflow\` block.
- Keep step \`id\` values unique and in \`kebab-case\` (1 to 10 steps per workflow).
- Choose \`input\` deliberately: \`"previous"\` for linear pipelines, \`"task"\` for independent steps that only need the initial prompt, and \`"all"\` for final synthesis/review steps.
- Bind workspace files via step \`files: ["handle-name"]\` (from **Media & Files**) rather than hardcoding local filesystem paths in instructions.
- When a step replays a browser flow or uses Playwright MCP, include \`"browser_run_flow"\` in \`tools\` and \`"browser"\` in \`mcpServers\`.
- Enable \`gate: true\` only on steps where Jev should verify output quality and potentially trigger a retry or early stop.
- Only set step \`model\` and \`provider\` when the user asks for a specific model or task tier (\`task:fast\`, \`task:reasoning\`, \`task:vision\`).

Related rules: browser-automation-guardrails
See also: workflows-guide skill, platform-modules skill
`,
  },
  {
    name: "browser-automation-guardrails",
    type: "rule",
    platform: "cursor",
    builtin: true,
    description:
      "Guardrails for teaching, saving, and replaying Automated Browsing flows in BlackAgents.",
    frontmatter: {
      description:
        "Guardrails for teaching, saving, and replaying Automated Browsing flows in BlackAgents.",
      alwaysApply: false,
      builtin: true,
    },
    relativePath: "builtin://rules/browser-automation-guardrails.mdc",
    body: `# Browser Automation Guardrails

- Automated Browsing requires the **BlackAgents desktop app** with **Settings → Browser → Enable Playwright MCP** turned on.
- Never invent, guess, or hardcode user passwords, API keys, or 2FA codes in prompts or flow steps. Use persistent Chromium profile login (\`~/.black-agents/browser-profiles/\`) or \`$secret:browser.<key>\` references.
- Always prefer calling \`browser_run_flow\` to replay a saved flow over ad-hoc clicking when a matching flow exists.
- When coaching a new browser flow with \`browser_*\` tools, take a \`browser_snapshot\` after navigation or page transitions before clicking or typing.
- When uploading a file in a browser form, use a file from **Media & Files** (\`@file:<name>\`) and pass its \`absolutePath\` to \`browser_file_upload\`.
- Give saved flow steps a clear natural-language \`intent\` so action caching and LLM self-healing can recover if page selectors change.

Related rules: workflow-guardrails
See also: browser-automation skill, platform-modules skill
`,
  },
]

const BUILTIN_KEYS = new Set(
  BUILTIN_ARTIFACTS.map((a) => `${a.type}:${a.name}`)
)

export function isBuiltinArtifact(
  artifact: Pick<Artifact, "type" | "name"> & { builtin?: boolean }
): boolean {
  return artifact.builtin === true || BUILTIN_KEYS.has(`${artifact.type}:${artifact.name}`)
}

export function findBuiltinArtifact(
  type: ArtifactType,
  name: string
): Artifact | null {
  return BUILTIN_ARTIFACTS.find((a) => a.type === type && a.name === name) ?? null
}

/**
 * Merge workspace artifacts with BlackAgents built-in artifacts.
 * Workspace artifacts with the same `type:name` override built-in ones.
 */
export function withBuiltinArtifacts(
  workspaceArtifacts: readonly Artifact[]
): Artifact[] {
  const seen = new Set(workspaceArtifacts.map((a) => `${a.type}:${a.name}`))
  const merged = [...workspaceArtifacts]
  for (const builtin of BUILTIN_ARTIFACTS) {
    if (!seen.has(`${builtin.type}:${builtin.name}`)) {
      merged.push(builtin)
    }
  }
  return merged
}

const WORKFLOW_TOPIC_RE =
  /\b(workflows?|multi-step|pipeline|step\s+gate|step\s+input|daily\s+trigger|interval\s+trigger|schedule\s+a?\s*run|handoffs?|self-?assess|workflow\s+builder)\b/i

const BROWSER_TOPIC_RE =
  /\b(browser\s+flows?|browser\s+automation|automated\s+browsing|playwright|browser_run_flow|browser_file_upload|browser_click|browser_navigate|browser_snapshot|record(?:ing)?\s+a?\s*flow|headless|self-?heal(?:ing)?|web\s+automation|browser\s+profile)\b/i

const PLATFORM_TOPIC_RE =
  /\b(media\s*(?:&|and)\s*files|workspace\s+files|@file:|mcp\s+servers?|mcp\.json|second\s+brain|task\s+models?|task:(?:fast|reasoning|vision|voice)|jev\b|settings\s*->|drift|export\s+to\s+(?:claude|windsurf|cursor))\b/i

/**
 * Detect when a user message in Assistant asks about BlackAgents Workflows,
 * Automated Browsing, or Platform Modules (Media & Files, MCP, Settings, Brain),
 * and return the matching built-in Skill artifacts present in `all`.
 * Linked rules (`workflow-guardrails`, `browser-automation-guardrails`) are
 * then automatically pulled in via `linkedArtifacts()`.
 */
export function matchBuiltinTopicArtifacts(
  message: string,
  all: readonly Artifact[]
): Artifact[] {
  if (!message.trim()) return []
  const matchedNames: string[] = []
  if (WORKFLOW_TOPIC_RE.test(message)) {
    matchedNames.push("workflows-guide")
  }
  if (BROWSER_TOPIC_RE.test(message)) {
    matchedNames.push("browser-automation")
  }
  if (PLATFORM_TOPIC_RE.test(message)) {
    matchedNames.push("platform-modules")
  }
  if (matchedNames.length === 0) return []

  const out: Artifact[] = []
  for (const name of matchedNames) {
    const found = all.find(
      (a) => a.type === "skill" && a.name === name && isBuiltinArtifact(a)
    )
    if (found && !out.includes(found)) {
      out.push(found)
    }
  }
  return out
}
