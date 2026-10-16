---
type: Reference
title: DevOps Overview
description: 'local-first shipping: no hosted server'
tags:
  - blackagents
  - devops
  - infrastructure
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/08%20-%20DevOps%20%26%20Infrastructure/DevOps%20Overview.md
    title: DevOps Overview
    last_modified: '2026-10-08T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:42Z'
---

# DevOps Overview

> [!abstract] One-liner
> BlackAgents is **local-first**. There is no hosted app server, database, Docker image, or error tracker. Shipping means GitHub Actions checks, a release pull request, desktop installers on GitHub Releases, and a static site on GitHub Pages.

## What runs where

| Piece | Where | Note |
|-------|-------|------|
| The app | The user's machine | Next.js, in the browser or inside [Electron Desktop](../architecture/electron-desktop.md) |
| App config and keys | `~/.black-agents/` | Never committed. See [Getting Started](../overview/getting-started.md) |
| Workspace files | The opened project folder | Artifacts, workflows, brain |
| Checks | GitHub-hosted `ubuntu-latest` | [CI-CD Pipeline](./ci-cd-pipeline.md) |
| Version bump | Release pull request | [Releases](./releases.md) |
| Installers | GitHub Releases | macOS, Windows, Linux. Not code-signed |
| Public site | GitHub Pages | [GitHub Pages](./github-pages.md) |

## What this project does not have

- No production server to deploy.
- No Docker Compose, no migrations, no Sentry.
- No scheduled GitHub job. The in-app workflow clock runs only while the app is open — see [Future Phases](../roadmap/future-phases.md).
- No automatic in-app update. A new version is a new installer.

## Related

- [CI-CD Pipeline](./ci-cd-pipeline.md)
- [Releases](./releases.md)
- [GitHub Pages](./github-pages.md)
- [Electron Desktop](../architecture/electron-desktop.md)
- [Testing](../overview/testing.md)
