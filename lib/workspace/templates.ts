import type { WorkspaceTemplate } from "@/lib/artifacts/schemas"

export interface TemplateArtifact {
  relativePath: string
  content: string
}

export interface WorkspaceTemplateDefinition {
  id: WorkspaceTemplate
  name: string
  description: string
  badge: string
  artifacts: TemplateArtifact[]
}

export const WORKSPACE_TEMPLATES: Record<
  WorkspaceTemplate,
  WorkspaceTemplateDefinition
> = {
  blank: {
    id: "blank",
    name: "Blank Workspace",
    description:
      "A clean slate with the standard directory layout ready for your custom agents, rules, and skills.",
    badge: "Clean slate",
    artifacts: [
      {
        relativePath: "README.md",
        content: `# AI Agent Workspace

Welcome to your BlackAgents workspace!

Use the navigation in BlackAgents to create your first:
- **Agent**: Single-responsibility worker with a persona and workflow.
- **Rule**: Declarative guardrail or standard.
- **Skill**: Reference package with instructions and domain knowledge.
- **Command**: Orchestration workflow sequencing multiple agents.

Browser automation (desktop app): open **Settings → Browser**, enable Playwright MCP,
record or coach a flow, then bind a daily workflow.
`,
      },
      {
        relativePath: ".black-agents/artifacts/agents/time-registrar.md",
        content: `---
name: time-registrar
description: Replays a saved browser flow to register time on a company site (desktop only).
tools:
  - fs_list
  - fs_read
  - browser_run_flow
mcpServers:
  - browser
---

You register work time in the company web app using a **saved browser flow**.

## Workflow

1. Confirm the user named a flow (default: \`time-registration\`) or ask which flow to run.
2. Call \`browser_run_flow\` with that name.
3. If the tool reports an expired session or login error, stop and tell the user to re-login via **Settings → Browser** (persistent profile under \`~/.black-agents/browser-profiles/\`).
4. Summarize what succeeded.

Never invent credentials. Prefer the saved flow over ad-hoc clicking unless the user is coaching a new path in chat.
`,
      },
      {
        relativePath: ".black-agents/artifacts/skills/time-registration/SKILL.md",
        content: `---
name: time-registration
description: How to teach and replay a company timesheet browser flow in BlackAgents.
---

## Teach the flow

1. Open the **BlackAgents desktop** app.
2. **Settings → Browser** → Enable Playwright MCP → Start recording.
3. In **Assistant**, pick an agent with the \`browser\` MCP server (or the generic assistant after setup) and coach the clicks, or drive the headed Chromium window via browser tools.
4. Stop recording and save as \`time-registration\` (creates skill/agent bindings).

Alternatively, coach in chat without recording, then use **Save as browser flow** on the tool trace card.

## Replay

- Manual: chat with **time-registrar** and say "run time-registration".
- Scheduled: **Settings → Browser → Daily bind** (or a workflow with a daily trigger). The desktop app must be open.

## Auth failures

If SSO/cookies expired, open Settings → Browser, start a headed session, log in once, then rerun.
`,
      },
      {
        relativePath: ".black-agents/workflows/time-registration-daily.workflow.json",
        content: `${JSON.stringify(
          {
            name: "time-registration-daily",
            description: "Daily time registration via saved browser flow (desktop app must be open).",
            task: "Run the browser flow time-registration to clock in / register today's time.",
            trigger: { type: "daily", at: "09:05" },
            steps: [
              {
                id: "run-flow",
                agent: "time-registrar",
                instructions:
                  'Run browser_run_flow with name "time-registration". If auth fails, stop and ask the user to re-login in Settings → Browser.',
                input: "task",
                tools: ["fs_list", "fs_read", "browser_run_flow"],
                mcpServers: ["browser"],
                allowWrites: false,
                maxTurns: 8,
                gate: false,
              },
            ],
            limits: {
              stepTimeoutMinutes: 15,
              runTimeoutMinutes: 30,
              maxRetries: 0,
            },
            selfAssess: false,
          },
          null,
          2
        )}\n`,
      },
    ],
  },
  crypto: {
    id: "crypto",
    name: "Crypto Assets Hub",
    description:
      "Starter workspace for managing crypto portfolios, DeFi protocols, on-chain risk, and rebalancing.",
    badge: "DeFi & Web3",
    artifacts: [
      {
        relativePath: ".black-agents/artifacts/agents/portfolio-rebalancer.md",
        content: `---
name: portfolio-rebalancer
description: Advises on crypto portfolio rebalancing, risk-adjusted allocations, and DCA strategies.
---

You are the portfolio-rebalancer agent. You analyze crypto portfolio allocations against target weighting models and recommend disciplined rebalancing and DCA actions.

## Input

- Current holdings and balances (assets, quantities, current prices).
- Target allocation model (e.g. 50% BTC, 30% ETH, 15% Large-cap L1/DeFi, 5% Cash/Stables).
- New capital inflow amount, if applicable.

## Workflow

1. Read the \`risk-management\` rule for allocation limits and slippage boundaries.
2. Consult the \`defi-lending-protocols\` skill for staking or yield opportunities on held assets.
3. Calculate current percentage weightings per asset and deviation from target percentages.
4. Prioritize rebalancing via new capital allocation (DCA) to minimize taxable swap events.
5. Output clear, step-by-step rebalancing recommendations with rationale.

## Output

- Allocation breakdown table (Current % vs Target % vs Deviation).
- Recommended actions (DCA buys, swaps, or staking deposits).
- Risk assessment summary.

## Error handling

- If an asset ticker is unrecognized, request clarification before calculating.
- If a proposed allocation violates the \`risk-management\` rule, reject it and explain the risk boundary.
`,
      },
      {
        relativePath: ".black-agents/artifacts/rules/risk-management.md",
        content: `---
description: Non-negotiable risk rules for crypto asset management, sizing, and security.
alwaysApply: true
---

- Never allocate more than 40% of total portfolio value to any single non-BTC/ETH asset.
- Never allocate more than 5% to speculative micro-caps or newly launched tokens.
- Maintain a minimum stablecoin/cash buffer of 10% to capitalize on market drawdowns.
- Enforce a maximum slippage tolerance of 0.5% on all DEX swap recommendations.
- Security Hygiene: Never request, record, or output private keys, seed phrases, or wallet signatures. All execution instructions are advisory.

See also: \`defi-lending-protocols\` skill.
`,
      },
      {
        relativePath: ".black-agents/artifacts/skills/defi-lending-protocols/SKILL.md",
        content: `---
name: defi-lending-protocols
description: Reference guide for decentralized lending markets, yield mechanics, and liquidation safety.
---

Reference guide for major decentralized finance lending markets (Aave, Morpho, Compound).

## Health Factor & Liquidation Risk
- Always maintain a Health Factor of >= 1.8 on active borrow positions.
- Monitor collateral volatility: high-beta assets require wider collateralization buffers.

## Protocol Characteristics
- **Aave**: Multi-chain, pooled liquidity, variable/stable borrow rates. Ideal for conservative supply APY.
- **Morpho**: Peer-to-peer matching optimization layer with lower spread.

## Related rules
- Follow the \`risk-management\` rule on all position sizes.
`,
      },
      {
        relativePath: ".black-agents/artifacts/commands/weekly-portfolio-review.md",
        content: `---
name: weekly-portfolio-review
description: Sequence a comprehensive weekly crypto asset audit and rebalancing review.
---

Sequence a comprehensive weekly crypto asset audit and rebalancing review.

## Workflow

1. Gather current asset valuations and yield balances across wallets and protocols.
2. Invoke the **portfolio-rebalancer** agent to evaluate drift from target allocation.
3. Check the \`risk-management\` rule to ensure no asset exceeds maximum concentration limits.
4. Produce a prioritized action plan for the upcoming week.
`,
      },
      {
        relativePath: ".black-agents/mcp.json",
        content: JSON.stringify(
          {
            mcpServers: {
              "crypto-market-data": {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-everything"],
                env: {},
              },
            },
          },
          null,
          2
        ),
      },
    ],
  },
  software: {
    id: "software",
    name: "Software Engineering",
    description:
      "Engineering workspace equipped with a developer agent, strict TypeScript rules, and testing patterns.",
    badge: "Engineering",
    artifacts: [
      {
        relativePath: ".black-agents/artifacts/agents/feature-developer.md",
        content: `---
name: feature-developer
description: Implements end-to-end features conforming to project architecture, typing, and tests.
---

You are a senior full-stack engineer implementing features and fixes.

## Input

- The user request or issue description.
- Relevant existing code files and architectural conventions.

## Workflow

1. Read the \`typescript-strict\` rule for coding conventions.
2. Consult the \`testing-patterns\` skill before finalizing the implementation.
3. Implement minimal, focused changes without unnecessary dependencies.
4. Verify by running unit tests and type checks.

## Output

- Well-typed, working code changes with passing tests.

## Error handling

- Surface ambiguities early rather than making assumptions.
`,
      },
      {
        relativePath: ".black-agents/artifacts/rules/typescript-strict.md",
        content: `---
description: TypeScript strictness conventions.
alwaysApply: true
---

- TypeScript runs in strict mode.
- Avoid \`any\` — use generics, discriminated unions, and \`unknown\` with narrowing.
- Give exported functions explicit return types.
- Never silence the compiler with \`@ts-ignore\`; resolve the type error instead.
`,
      },
      {
        relativePath: ".black-agents/artifacts/skills/testing-patterns/SKILL.md",
        content: `---
name: testing-patterns
description: Testing conventions, fixtures, and assertion patterns for unit and integration suites.
---

Conventions for writing clean, reliable automated tests.

## Rules
- Test observable behavior, not internal implementation details.
- Use isolated temporary directories for filesystem operations.
- Cover happy path, edge cases, and expected errors.
`,
      },
    ],
  },
}
