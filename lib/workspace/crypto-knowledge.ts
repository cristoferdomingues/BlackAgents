import type { TemplateArtifact } from "./templates"

/**
 * Starter knowledge for the crypto workspace. Adapted from the official OKF
 * `crypto_bitcoin` bundle (Bitcoin as a public dataset, plus the kit's own
 * metric and risk limits). Seeded files are not human-reviewed.
 */

const GENERATED = `generated:
  by: process:workspace-template
  at: 2026-07-10T23:16:06Z`

export const CRYPTO_KNOWLEDGE: TemplateArtifact[] = [
  {
    relativePath: ".black-agents/knowledge/index.md",
    content: `---
okf_version: "0.2"
---

# Crypto

* [Crypto](crypto/) - Tokens, one portfolio metric, and the risk limits.
`,
  },
  {
    relativePath: ".black-agents/knowledge/log.md",
    content: `# Directory Update Log

## 2026-07-10
* **Creation**: Seeded the crypto starter concepts from the OKF crypto_bitcoin example.
`,
  },
  {
    relativePath: ".black-agents/knowledge/crypto/index.md",
    content: `# Crypto

* [Bitcoin](bitcoin.md) - The asset behind the public Bitcoin blockchain dataset.
* [Ethereum](ethereum.md) - The second core holding in the starter allocation.
* [Allocation drift](portfolio-metrics.md) - How far a holding is from its target weight.
* [Risk limits](risk-thresholds.md) - Concentration, cash buffer, slippage, and borrow safety.
`,
  },
  {
    relativePath: ".black-agents/knowledge/crypto/bitcoin.md",
    content: `---
type: Asset
title: Bitcoin
description: The asset behind the public Bitcoin blockchain dataset.
resource: https://bigquery.googleapis.com/v2/projects/bigquery-public-data/datasets/crypto_bitcoin/tables/blocks
tags:
  - bitcoin
  - crypto
${GENERATED}
sources:
  - id: bitcoin-etl
    resource: https://github.com/blockchain-etl/bitcoin-etl
    title: Bitcoin ETL Export Tool
---

# Definition

Bitcoin is the asset recorded in the public \`crypto_bitcoin\` dataset. That dataset is a full block and transaction history, exported from live nodes and starting at the genesis block in January 2009.

Use this concept when a holding is BTC. For block-level questions, the blocks table can be joined to transactions. Do not treat this file as a live price.

# Limits

Position size still follows [the risk limits](risk-thresholds.md).
`,
  },
  {
    relativePath: ".black-agents/knowledge/crypto/ethereum.md",
    content: `---
type: Asset
title: Ethereum
description: The second core holding in the starter allocation.
tags:
  - ethereum
  - crypto
${GENERATED}
---

# Definition

Ethereum (ETH) is a core holding next to Bitcoin in the starter target: about 30% of the portfolio.

It is not part of the public Bitcoin dataset. Read this file only when a holding is ETH.

# Limits

Position size still follows [the risk limits](risk-thresholds.md).
`,
  },
  {
    relativePath: ".black-agents/knowledge/crypto/portfolio-metrics.md",
    content: `---
type: Metric
title: Allocation drift
description: How far a holding is from its target weight.
tags:
  - portfolio
  - crypto
${GENERATED}
---

# Definition

Allocation drift is the current weight of a holding minus its target weight, in percentage points.

A positive drift means the holding is above target. Prefer new cash (DCA) over a swap when you need to close the gap.

The starter targets are about 50% [Bitcoin](bitcoin.md), 30% [Ethereum](ethereum.md), 15% other large assets, and 5% cash. Any action must stay inside [the risk limits](risk-thresholds.md).
`,
  },
  {
    relativePath: ".black-agents/knowledge/crypto/risk-thresholds.md",
    content: `---
type: Reference
title: Risk limits
description: Concentration, cash buffer, slippage, and borrow safety for this kit.
tags:
  - risk
  - crypto
${GENERATED}
---

# Limits

- At most 40% of the portfolio in any single asset that is not [Bitcoin](bitcoin.md) or [Ethereum](ethereum.md).
- At most 5% in speculative micro-caps or newly launched tokens.
- At least 10% in stablecoins or cash.
- At most 0.5% slippage on a DEX swap recommendation.
- A borrow health factor of at least 1.8.

These are durable limits. They are not a memory note and they are not a trade. Never ask for a private key, a seed phrase, or a wallet signature.
`,
  },
]
