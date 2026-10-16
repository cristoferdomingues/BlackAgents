---
type: Reference
title: Releases
description: 'release pull request, tag, desktop installers'
tags:
  - blackagents
  - devops
  - releases
  - electron
  - github-actions
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/08%20-%20DevOps%20%26%20Infrastructure/Releases.md
    title: Releases
    last_modified: '2026-10-08T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:40Z'
---

# Releases

> [!abstract] One-liner
> User-facing commits on `main` open a release pull request. Merging it tags the version. The tag is what builds the desktop installers.

There is no manual version bump in normal work. Do not edit `package.json` just to release.

## Files

| File | Role |
|------|------|
| `.github/workflows/release-please.yml` | Opens or updates the release pull request |
| `release-please-config.json` | Version rules and extra files |
| `.release-please-manifest.json` | Last released version. `0.1.3` until the next release merges |
| `.github/workflows/release.yml` | On a `v*.*.*` tag: test, build installers, attach them to the GitHub Release |

The release-please action is pinned to commit `5c625bfb5d1ff62eadeeb3772007f7f66fdcf071` (`v4.4.1`).

## 1. Release pull request

**Trigger:** every push to `main`.

The workflow starts with `permissions: {}`. Only the job gets `contents: write` and `pull-requests: write`. The `release-please` concurrency group does not cancel a run that is already going.

### Version rules (still `0.x`)

`bump-minor-pre-major` is on. `bump-patch-for-minor-pre-major` is off. Breaking changes do not jump to `1.0` yet.

| Commit | Example |
|--------|---------|
| `fix:` | 0.1.3 → 0.1.4 |
| `feat:` | 0.1.3 → 0.2.0 |
| `feat!:` or `BREAKING CHANGE:` | 0.1.3 → 0.2.0 |
| `chore:` `docs:` `test:` `ci:` `refactor:` | no release; hidden in the changelog |

`include-component-in-tag` is false, so the tag is `v0.2.0`, not `black-agents-v0.2.0`.

`bootstrap-sha` is `b2f25bc3ca5854dd6b08652ef3cf61aff167ce08` (the landing-page commit). Older history is not part of the changelog.

The release PR title looks like `chore(main): release 0.2.0`. It bumps:

- `package.json` and the root lockfile (the node release type)
- `electron/package.json` version
- `electron/package-lock.json` top version and `packages[""].version`
- `.release-please-manifest.json`
- `CHANGELOG.md`

Both package versions must stay equal. The desktop workflow refuses a tag that does not match both.

### Repo setting this step needs

Settings → Actions → General → Workflow permissions:

- Default stays **Read repository contents**.
- **Allow GitHub Actions to create and approve pull requests** must be on.

That second box is the API flag `can_approve_pull_request_reviews`. If it is off, release-please still creates the release branch and commit, then fails with: `GitHub Actions is not permitted to create or approve pull requests.`

## 2. Tag and installers

Merging the release PR pushes a `chore:` commit to `main`. The next release-please run sees that commit, creates tag `vX.Y.Z`, and opens the GitHub Release.

`release.yml` listens for tags `v*.*.*`.

### Job `check`

Node 22. The tag (without `v`) must equal `package.json` and `electron/package.json`. Then `npm ci`, type-check, lint, and unit/integration tests. E2E is not repeated here; it already ran on the commits that entered `main`.

### Job `build` (three machines, `fail-fast: false`)

| Runner | Installers |
|--------|------------|
| `macos-latest` | `.dmg` and `.zip` (Apple Silicon when the runner is arm64) |
| `windows-latest` | NSIS `.exe` |
| `ubuntu-latest` | `.AppImage` |

Each runner runs `npm ci`, `npm ci --prefix electron`, then `npm run build && npx electron-builder --publish never`.

| Env | Why |
|-----|-----|
| `CSC_IDENTITY_AUTO_DISCOVERY=false` | No Apple or Windows certificate in this workflow. Builds stay unsigned |
| `APPIMAGE_EXTRACT_AND_RUN=1` | The Linux runner has no FUSE, so the AppImage build must extract and run |

Installers are uploaded as artifacts named `desktop-macOS`, `desktop-Windows`, and `desktop-Linux`, kept for 7 days. A missing file fails the job.

### Job `release`

Needs all three builds. Permission `contents: write`. It downloads the artifacts and attaches them with `softprops/action-gh-release@v2`.

- Release name: `BlackAgents vX.Y.Z`
- A tag that contains `-` is a prerelease and is not marked latest
- The body tells people the builds are unsigned and how to open them the first time
- When the workflow runs, installers show up about 5 minutes after the tag

> [!warning] A tag made by GitHub Actions does not start this workflow
> `release-please` creates the tag with the default `GITHUB_TOKEN`. GitHub does not start a new workflow from that token. A tag pushed by a person does start `release.yml` — that is how `v0.1.3` was built.
> Until the release workflow uses a personal access token, or `release.yml` also runs from `workflow_run` after release-please, merging the release PR can create the tag and an empty GitHub Release without installers.

## Local packs

`npm run desktop:pack` builds an installer for the current machine only. It does not publish. Use it to check a change before the GitHub installers exist. See [Electron Desktop](../architecture/electron-desktop.md).

## Related

- [CI-CD Pipeline](./ci-cd-pipeline.md)
- [Electron Desktop](../architecture/electron-desktop.md)
- [GitHub Pages](./github-pages.md)
