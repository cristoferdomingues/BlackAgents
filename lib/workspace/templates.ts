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
`,
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
        relativePath: ".cursor/agents/portfolio-rebalancer.md",
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
        relativePath: ".cursor/rules/risk-management.mdc",
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
        relativePath: ".cursor/skills/defi-lending-protocols/SKILL.md",
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
        relativePath: ".cursor/commands/weekly-portfolio-review.md",
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
        relativePath: ".cursor/agents/feature-developer.md",
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
        relativePath: ".cursor/rules/typescript-strict.mdc",
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
        relativePath: ".cursor/skills/testing-patterns/SKILL.md",
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
