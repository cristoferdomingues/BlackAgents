---
type: Reference
title: GitHub Pages
description: the public landing page
tags:
  - blackagents
  - devops
  - github-pages
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/08%20-%20DevOps%20%26%20Infrastructure/GitHub%20Pages.md
    title: GitHub Pages
    last_modified: '2026-10-08T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:41Z'
---

# GitHub Pages

> [!abstract] One-liner
> The public site is a static page in the repo root. It is not the Next.js app.

**URL:** https://cristoferdomingues.github.io/BlackAgents/

**Source:** branch `main`, folder `/` (the repository root). The repo homepage is this URL.

## Files

| File | Role |
|------|------|
| `index.html` | The page. Dark violet layout, feature list, download button |
| `pages.css` | Styles. Colors match the app (`#0d0d12` background, violet `#a78bfa`) |
| `public/images/black-agents-icon-transparent.png` | Icon in the header and favicon |
| `public/images/black-agents-logo.png` | Social preview image |

The download button goes to https://github.com/cristoferdomingues/BlackAgents/releases/latest so it does not name a version that will go stale.

A push to `main` publishes the site. Pages does not run the Next.js build. There is no separate Pages workflow.

> [!note] Why the page is not the README
> GitHub Pages on `/` would otherwise render the README through Jekyll. `index.html` at the root is the page people get instead.

## Related

- [Releases](./releases.md) — where the download button sends people
- [DevOps Overview](./devops-overview.md)
